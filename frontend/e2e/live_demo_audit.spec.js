import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  attachAuditListeners,
  clearAuditReport,
  logAudit,
  writeAuditSummary,
} from './utils/auditLogger.js'
import { shouldIgnorePath } from '../src/utils/ignoreFilter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIDEOS_DIR = path.join(__dirname, '../test-results/videos')

function sseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function buildLocalStubSse() {
  return [
    sseEvent({
      type: 'routing',
      target_client: 'LOCAL_STUB',
      selected_provider: 'local',
      selected_model: 'mock-local',
      sensitivity_score: 1,
      detected_secrets: ['sk-12345'],
      requires_rag: false,
    }),
    sseEvent({ type: 'rag', status: 'skipped', hit_count: 0, snippets: [] }),
    sseEvent({
      type: 'token',
      content: '[LOCAL MOCK EXECUTION] Confidential path active for sk-12345.',
    }),
    sseEvent({
      type: 'quality',
      is_valid: true,
      tier1_schema_pass: true,
      tier2_heuristic_pass: true,
      tier3_score: 9,
      feedback: '',
    }),
  ].join('')
}

function buildArchitectureSse() {
  return [
    sseEvent({
      type: 'routing',
      target_client: 'CLOUD_API',
      selected_provider: 'gemini',
      selected_model: 'gemini-3.6-flash',
      sensitivity_score: 0,
      detected_secrets: [],
      requires_rag: false,
    }),
    sseEvent({ type: 'rag', status: 'skipped', hit_count: 0, snippets: [] }),
    sseEvent({ type: 'token', content: 'Architecture overview\n\n' }),
    sseEvent({ type: 'token', content: '```mermaid\n' }),
    sseEvent({
      type: 'token',
      content: 'flowchart LR\n  A[Client] --> B[API]\n  B --> C[DB]\n```\n',
    }),
    sseEvent({
      type: 'quality',
      is_valid: true,
      tier1_schema_pass: true,
      tier2_heuristic_pass: true,
      tier3_score: 10,
      feedback: '',
    }),
  ].join('')
}

function createStore() {
  return {
    workspaces: [],
    threadsByWs: new Map(),
    messagesByThread: new Map(),
  }
}

async function installApiMocks(page, store) {
  // Register catch-all first — Playwright matches routes in reverse registration order.
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const pathname = url.pathname

    if (pathname === '/api/v1/chat/completions') {
      await route.fallback()
      return
    }

    // Workspaces collection
    if (pathname === '/api/v1/workspaces') {
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(store.workspaces),
        })
        return
      }
      if (method === 'POST') {
        const payload = request.postDataJSON() || {}
        const now = new Date().toISOString()
        const ws = {
          id: crypto.randomUUID(),
          name: payload.name || 'Untitled',
          description: payload.description || null,
          tech_stack: payload.tech_stack || ['React', 'FastAPI'],
          custom_instructions: payload.custom_instructions || null,
          created_at: now,
        }
        store.workspaces.push(ws)
        store.threadsByWs.set(ws.id, [])
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(ws),
        })
        return
      }
    }

    if (pathname === '/api/v1/workspaces/create-and-ingest' && method === 'POST') {
      const now = new Date().toISOString()
      const ws = {
        id: crypto.randomUUID(),
        name: 'Playwright E2E Audit',
        description: null,
        tech_stack: ['React', 'FastAPI'],
        custom_instructions: null,
        created_at: now,
      }
      try {
        const postData = request.postData() || ''
        const nameMatch = /name="name"\r?\n\r?\n([^\r\n]+)/.exec(postData)
        if (nameMatch) ws.name = nameMatch[1].trim()
      } catch {
        /* keep default */
      }
      store.workspaces.push(ws)
      store.threadsByWs.set(ws.id, [])
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workspace: ws,
          files_ingested: 0,
          chunks_inserted: 0,
          skipped_ignored: 0,
          sdlc_audit_report: {
            languages: [
              { name: 'TypeScript', pct: 55, color: '#3178c6' },
              { name: 'Python', pct: 45, color: '#3572A5' },
            ],
            frameworks: ['React', 'FastAPI'],
            file_count: 42,
            size_bytes: 128000,
            phases: Array.from({ length: 9 }, (_, i) => ({
              id: i + 1,
              name: `Phase ${i + 1}`,
              status: i < 3 ? 'completed' : i < 5 ? 'in_progress' : 'pending',
              pct: i < 3 ? 80 : i < 5 ? 40 : 0,
              deliverables: i < 3 ? [`src/phase${i + 1}.md`] : [],
            })),
            scores: {
              code_quality: 72,
              rag_readiness: 65,
              security: 58,
              test_completeness: 40,
            },
          },
        }),
      })
      return
    }

    const wsMatch = pathname.match(
      /^\/api\/v1\/workspaces\/([^/]+)(?:\/(analytics|threads|documents)(?:\/([^/]+)(?:\/(messages))?)?)?$/,
    )
    if (wsMatch) {
      const workspaceId = wsMatch[1]
      const resource = wsMatch[2]
      const threadId = wsMatch[3]
      const messages = wsMatch[4]

      if (!resource && method === 'DELETE') {
        store.workspaces = store.workspaces.filter((w) => w.id !== workspaceId)
        store.threadsByWs.delete(workspaceId)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'deleted',
            id: workspaceId,
            purged_chunks: 0,
          }),
        })
        return
      }

      if (!resource && method === 'PUT') {
        const payload = request.postDataJSON() || {}
        const idx = store.workspaces.findIndex((w) => w.id === workspaceId)
        if (idx < 0) {
          await route.fulfill({ status: 404, body: 'not found' })
          return
        }
        store.workspaces[idx] = { ...store.workspaces[idx], ...payload }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(store.workspaces[idx]),
        })
        return
      }

      if (resource === 'analytics' && method === 'GET') {
        const ws = store.workspaces.find((w) => w.id === workspaceId)
        if (!ws) {
          await route.fulfill({ status: 404, body: 'not found' })
          return
        }
        const phaseCompletion = {}
        for (let i = 1; i <= 9; i += 1) phaseCompletion[String(i)] = i <= 3
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            workspace_id: workspaceId,
            name: ws.name,
            chunk_count: 12,
            document_count: 2,
            sdlc_phase_completion: phaseCompletion,
            sdlc_completion_pct: 33,
            tech_stack: ws.tech_stack?.length
              ? ws.tech_stack
              : ['React', 'FastAPI', 'PostgreSQL'],
            documentation_coverage_pct: 40,
            testability_score: 55,
            sdlc_audit_report: {
              languages: [
                { name: 'TypeScript', pct: 55, color: '#3178c6' },
                { name: 'Python', pct: 45, color: '#3572A5' },
              ],
              frameworks: ['React', 'FastAPI'],
              file_count: 42,
              size_bytes: 128000,
              phases: [
                {
                  id: 1,
                  name: 'Expression du besoin',
                  status: 'completed',
                  pct: 90,
                  deliverables: ['README.md'],
                },
                {
                  id: 2,
                  name: 'Analyse fonctionnelle',
                  status: 'completed',
                  pct: 80,
                  deliverables: ['specs/analyse.md'],
                },
                {
                  id: 3,
                  name: 'Architecture',
                  status: 'in_progress',
                  pct: 45,
                  deliverables: ['docs/architecture.md'],
                },
                ...[4, 5, 6, 7, 8, 9].map((id) => ({
                  id,
                  name: `Phase ${id}`,
                  status: 'pending',
                  pct: 0,
                  deliverables: [],
                })),
              ],
              scores: {
                code_quality: 72,
                rag_readiness: 65,
                security: 58,
                test_completeness: 40,
              },
            },
          }),
        })
        return
      }

      if (resource === 'threads' && !threadId && method === 'GET') {
        const list = store.threadsByWs.get(workspaceId) || []
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(list),
        })
        return
      }

      if (resource === 'threads' && !threadId && method === 'POST') {
        const payload = request.postDataJSON() || {}
        const now = new Date().toISOString()
        const thread = {
          id: payload.id || crypto.randomUUID(),
          workspace_id: workspaceId,
          title: payload.title || 'New chat',
          is_pinned: false,
          created_at: now,
          updated_at: now,
        }
        const list = store.threadsByWs.get(workspaceId) || []
        list.unshift(thread)
        store.threadsByWs.set(workspaceId, list)
        store.messagesByThread.set(thread.id, [])
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(thread),
        })
        return
      }

      if (resource === 'threads' && threadId && messages === 'messages') {
        if (method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(store.messagesByThread.get(threadId) || []),
          })
          return
        }
        if (method === 'PUT') {
          const payload = request.postDataJSON() || {}
          const rows = Array.isArray(payload.messages) ? payload.messages : []
          store.messagesByThread.set(threadId, rows)
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(rows),
          })
          return
        }
        if (method === 'DELETE') {
          store.messagesByThread.set(threadId, [])
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'deleted', purged: 0 }),
          })
          return
        }
      }

      if (resource === 'documents' && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ filename: 'doc.md', chunks_inserted: 1 }),
        })
        return
      }
    }

    const threadPatch = pathname.match(/^\/api\/v1\/threads\/([^/]+)$/)
    if (threadPatch) {
      const threadId = threadPatch[1]
      if (method === 'PATCH') {
        const payload = request.postDataJSON() || {}
        for (const [, list] of store.threadsByWs) {
          const t = list.find((x) => x.id === threadId)
          if (t) {
            if (payload.title) t.title = payload.title
            if (typeof payload.is_pinned === 'boolean') t.is_pinned = payload.is_pinned
            t.updated_at = new Date().toISOString()
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(t),
            })
            return
          }
        }
        await route.fulfill({ status: 404, body: 'not found' })
        return
      }
      if (method === 'DELETE') {
        for (const [wsId, list] of store.threadsByWs) {
          store.threadsByWs.set(
            wsId,
            list.filter((t) => t.id !== threadId),
          )
        }
        store.messagesByThread.delete(threadId)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'deleted', thread_id: threadId }),
        })
        return
      }
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: `Mock miss ${method} ${pathname}` }),
    })
  })

  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    })
  })

  await page.route('**/api/v1/chat/completions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    let body = {}
    try {
      body = route.request().postDataJSON() || {}
    } catch {
      body = {}
    }
    const prompt = String(body.prompt || '')
    if (/deploy(?:\s+to)?\s+production/i.test(prompt)) {
      const sse = [
        sseEvent({
          type: 'admin_restricted',
          tool: 'deploy_to_production',
          message:
            'This action (`deploy_to_production`) requires an Admin role. Your request was blocked before model or tool execution.',
        }),
        sseEvent({
          type: 'token',
          content:
            'This action (`deploy_to_production`) requires an Admin role. Your request was blocked before model or tool execution.',
        }),
        sseEvent({
          type: 'quality',
          is_valid: true,
          tier1_schema_pass: true,
          tier2_heuristic_pass: true,
          tier3_score: 1,
          feedback: 'admin_restricted',
        }),
      ].join('')
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: sse,
      })
      return
    }
    if (prompt.includes('STOP_TEST')) {
      // Keep request pending so Stop Generating is visible; abort cancels this handler.
      await new Promise((resolve) => setTimeout(resolve, 8000))
    }
    const sse = body.force_confidential
      ? buildLocalStubSse()
      : buildArchitectureSse()
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: sse,
    })
  })
}

async function clickNewChat(page) {
  await page.getByTestId('new-chat-button').click()
}

async function closeSideDrawers(page) {
  const closeInspector = page.getByRole('button', { name: 'Close inspector' })
  if (await closeInspector.isVisible().catch(() => false)) {
    await closeInspector.click()
  }
  const closeCanvas = page.getByRole('button', { name: 'Close canvas' })
  if (await closeCanvas.isVisible().catch(() => false)) {
    await closeCanvas.click()
  }
}

async function setConfidential(page, on) {
  await closeSideDrawers(page)
  const confidential = page.getByRole('switch', { name: /Confidential/i })
  const checked = (await confidential.getAttribute('aria-checked')) === 'true'
  if (checked !== on) {
    await confidential.click()
  }
  await expect(confidential).toHaveAttribute('aria-checked', on ? 'true' : 'false')
}

test.describe.configure({ mode: 'serial' })

test('ignoreFilter drops node_modules, .git, .venv, dist, __pycache__, .env', () => {
  expect(shouldIgnorePath('src/app.js')).toBe(false)
  expect(shouldIgnorePath('node_modules/left-pad/index.js')).toBe(true)
  expect(shouldIgnorePath('.git/config')).toBe(true)
  expect(shouldIgnorePath('backend/.venv/lib/site.py')).toBe(true)
  expect(shouldIgnorePath('frontend/dist/bundle.js')).toBe(true)
  expect(shouldIgnorePath('pkg/__pycache__/x.pyc')).toBe(true)
  expect(shouldIgnorePath('.env')).toBe(true)
  expect(shouldIgnorePath('.env.local')).toBe(true)
})

test.describe('Live demo UI audit', () => {
  /** @type {string[]} */
  const passedSteps = []
  /** @type {string[]} */
  const failedSteps = []
  const store = createStore()

  test.beforeAll(() => {
    clearAuditReport()
  })

  test.afterAll(() => {
    writeAuditSummary({ passedSteps, failedSteps })
    // Mirror latest webm into test-results/videos/ for the briefing path.
    try {
      const resultsRoot = path.join(__dirname, '../test-results')
      fs.mkdirSync(VIDEOS_DIR, { recursive: true })
      const webms = []
      for (const entry of fs.readdirSync(resultsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(resultsRoot, entry.name, 'video.webm')
        if (fs.existsSync(candidate)) webms.push(candidate)
      }
      const latest = webms.sort(
        (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
      )[0]
      if (latest) {
        fs.copyFileSync(latest, path.join(VIDEOS_DIR, 'live_demo_audit.webm'))
      }
    } catch {
      /* soft */
    }
  })

  test('MVP journey: workspace, theme, privacy, canvas, dashboard, teardown', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    attachAuditListeners(page)
    await installApiMocks(page, store)
    await page.goto('/')
    await expect(page.getByTestId('app-sidebar').first()).toBeVisible({ timeout: 30_000 })

    // --- Workspace create via Projects + ---
    try {
      await page.getByTestId('new-project-button').click()
      await expect(page.getByTestId('create-workspace-form')).toBeVisible({
        timeout: 10_000,
      })
      await page.locator('#create-ws-name').fill('Playwright E2E Audit')
      await page.getByRole('button', { name: 'Create & ingest' }).click()
      await expect(page.getByText('Playwright E2E Audit').first()).toBeVisible({
        timeout: 15_000,
      })
      passedSteps.push('Workspace create + sidebar Projects update')
    } catch (error) {
      failedSteps.push(`Workspace create: ${error.message}`)
      throw error
    }

    // Optional Customize (edit) after create
    await page.getByRole('button', { name: 'Customize' }).click()
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)

    // --- Theme toggle ---
    try {
      const before = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--app-bg')
          .trim(),
      )
      const themeBtn = page.getByRole('button', { name: /Switch to (light|dark) theme/i })
      await themeBtn.click()
      await page.waitForFunction(
        (prev) =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--app-bg')
            .trim() !== prev,
        before,
      )
      const after = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--app-bg')
          .trim(),
      )
      expect(after).not.toBe(before)
      // Restore dark for rest of demo consistency
      await themeBtn.click()
      passedSteps.push('Theme toggle updates --app-bg')
    } catch (error) {
      failedSteps.push(`Theme toggle: ${error.message}`)
      logAudit({
        category: 'Structural / theme',
        message: error.message,
        url: page.url(),
      })
      throw error
    }

    // --- Privacy / LOCAL STUB ---
    try {
      await clickNewChat(page)
      await setConfidential(page, true)
      const waitLocal = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/chat/completions') && res.ok(),
      )
      await page
        .getByPlaceholder('Message Fuzyo…')
        .fill('Here is my sk-12345 key — keep this confidential')
      await page.getByRole('button', { name: 'Send' }).click()
      await waitLocal
      await expect(page.getByText('[LOCAL STUB]')).toBeVisible({ timeout: 15_000 })
      passedSteps.push('Confidential SSE renders [LOCAL STUB]')
    } catch (error) {
      failedSteps.push(`Privacy routing: ${error.message}`)
      throw error
    }

    // --- Architecture Mermaid canvas ---
    try {
      await clickNewChat(page)
      await closeSideDrawers(page)
      await page.locator('#sdlc-phase-select').selectOption('3')
      await setConfidential(page, false)
      const waitArch = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/chat/completions') && res.ok(),
        { timeout: 60_000 },
      )
      await page
        .getByPlaceholder('Message Fuzyo…')
        .fill('Propose a microservices layout with a mermaid flowchart')
      await page.getByRole('button', { name: 'Send' }).click({ force: true })
      await waitArch
      await expect(page.getByText('Architecture overview')).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByRole('heading', { name: 'Canvas' })).toBeVisible({
        timeout: 15_000,
      })
      const mermaidSvg = page.locator(
        'svg.flowchart, svg[aria-roledescription="flowchart-v2"]',
      )
      await expect(mermaidSvg.first()).toBeVisible({ timeout: 15_000 })

      const overflow = await page.evaluate(() => {
        const host =
          document.querySelector('[aria-label="Canvas"], aside, [class*="canvas"]') ||
          document.querySelector('svg.flowchart')?.parentElement
        if (!host) return { ok: false, reason: 'no host' }
        return {
          ok: host.scrollWidth <= host.clientWidth + 2,
          scrollWidth: host.scrollWidth,
          clientWidth: host.clientWidth,
        }
      })
      if (!overflow.ok) {
        logAudit({
          category: 'Layout overflow',
          message: 'Mermaid/canvas host may overflow horizontally',
          url: page.url(),
          details: JSON.stringify(overflow),
        })
      } else {
        logAudit({
          category: 'Layout check',
          message: 'Mermaid/canvas host within client width',
          url: page.url(),
          details: JSON.stringify(overflow),
        })
      }

      await page.getByRole('button', { name: 'Artifacts' }).click()
      await expect(page.getByRole('heading', { name: 'Artifacts' })).toBeVisible({
        timeout: 10_000,
      })
      passedSteps.push('Architecture Mermaid + Artifacts view')
    } catch (error) {
      failedSteps.push(`Architecture canvas: ${error.message}`)
      throw error
    }

    // --- Dashboard analytics ---
    try {
      await page
        .locator('aside')
        .getByRole('button', { name: 'Playwright E2E Audit', exact: true })
        .click()
      await expect(page.getByTestId('project-overview-dashboard')).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByTestId('tech-stack-bar')).toBeVisible()
      await expect(page.getByText('TypeScript').first()).toBeVisible()
      await expect(page.getByTestId('sdlc-workflow-graph')).toBeVisible()
      await page.getByTestId('sdlc-phase-node-1').click()
      await expect(page.getByTestId('phase-drawer')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('README.md')).toBeVisible()
      await page.getByTestId('execute-phase-assistant').click()
      await expect(page.getByPlaceholder('Message Fuzyo…')).toContainText(
        'Assist with SDLC phase 1',
        { timeout: 10_000 },
      )
      passedSteps.push('Overview language bar + phase drawer')
    } catch (error) {
      failedSteps.push(`Dashboard: ${error.message}`)
      throw error
    }

    // --- Admin lock for deploy (E2E user is developer) ---
    try {
      await clickNewChat(page)
      await closeSideDrawers(page)
      await setConfidential(page, false)
      const waitAdmin = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/chat/completions') && res.ok(),
      )
      await page
        .getByPlaceholder('Message Fuzyo…')
        .fill('Please deploy to production tonight')
      await page.getByRole('button', { name: 'Send' }).click({ force: true })
      await waitAdmin
      await expect(page.getByTestId('admin-lock-card')).toBeVisible({
        timeout: 15_000,
      })
      passedSteps.push('AdminLock on deploy to production')
    } catch (error) {
      failedSteps.push(`Admin lock: ${error.message}`)
      throw error
    }

    // --- UX: command palette, sidebar collapse, search, stop generating ---
    try {
      await page.getByTestId('open-command-palette').click()
      await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('command-palette')).toHaveCount(0)

      const sidebar = page.getByTestId('app-sidebar').first()
      await expect(sidebar).toHaveAttribute('data-collapsed', '0')
      await page.getByTestId('sidebar-collapse-toggle').first().click()
      await expect(sidebar).toHaveAttribute('data-collapsed', '1')
      await page.getByTestId('sidebar-collapse-toggle').first().click()
      await expect(sidebar).toHaveAttribute('data-collapsed', '0')

      await page.getByTestId('sidebar-search').fill('New chat')
      await expect(page.getByTestId('sidebar-search')).toHaveValue('New chat')

      await clickNewChat(page)
      await closeSideDrawers(page)
      await page.getByPlaceholder('Message Fuzyo…').fill('STOP_TEST please hold')
      await page.getByRole('button', { name: 'Send' }).click({ force: true })
      await expect(page.getByTestId('stop-generating')).toBeVisible({ timeout: 10_000 })
      await closeSideDrawers(page)
      await page.getByTestId('stop-generating').click({ force: true })
      await expect(page.getByTestId('stop-generating')).toHaveCount(0, { timeout: 10_000 })

      passedSteps.push('Palette, sidebar collapse, search, stop generating')
    } catch (error) {
      failedSteps.push(`UX controls: ${error.message}`)
      throw error
    }

    // --- Teardown delete workspace ---
    try {
      await page
        .locator('aside')
        .getByRole('button', { name: 'Playwright E2E Audit', exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Delete Playwright E2E Audit' })
        .click()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(
        page
          .locator('aside')
          .getByRole('button', { name: 'Playwright E2E Audit', exact: true }),
      ).toHaveCount(0, { timeout: 15_000 })
      passedSteps.push('Workspace delete teardown')
    } catch (error) {
      failedSteps.push(`Teardown: ${error.message}`)
      throw error
    }
  })
})
