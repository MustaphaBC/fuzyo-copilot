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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = path.resolve(__dirname, '..')
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'todo_app_sample')
const HOST_BASE = path.join(FRONTEND_ROOT, 'e2e_test_workspaces')
const PROJECT_DIR = path.join(HOST_BASE, 'TodoMasterApp')
const WS_ID = '22222222-2222-2222-2222-222222222222'

const PHASE_NAMES = [
  'Expression du besoin',
  'Analyse fonctionnelle',
  'Architecture',
  'Gestion de projet / PO',
  'Développement',
  'Tests & QA',
  'Recette',
  'DevOps / CI-CD',
  'Mise en production',
]

function sseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function buildMermaidSse() {
  return [
    sseEvent({
      type: 'routing',
      target_client: 'CLOUD_API',
      selected_provider: 'gemini',
      selected_model: 'gemini-flash',
      sensitivity_score: 0,
      detected_secrets: [],
      requires_rag: false,
    }),
    sseEvent({ type: 'rag', status: 'skipped', hit_count: 0, snippets: [] }),
    sseEvent({ type: 'token', content: 'Architecture for Todo Master App\n\n' }),
    sseEvent({ type: 'token', content: '```mermaid\n' }),
    sseEvent({
      type: 'token',
      content:
        'flowchart LR\n  UI[React Frontend] --> Store[State Store]\n  Store --> LS[LocalStorage]\n```\n',
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

function buildCodeSse() {
  const code = [
    "import { useMemo, useState } from 'react'",
    '',
    'export default function App() {',
    '  const [todos, setTodos] = useState([])',
    '  function clearCompleted() {',
    '    // E2E_CLEAR_COMPLETED_APPLIED',
    '    setTodos((prev) => prev.filter((todo) => !todo.done))',
    '  }',
    '  return <button onClick={clearCompleted}>Clear completed</button>',
    '}',
    '',
  ].join('\n')

  return [
    sseEvent({
      type: 'routing',
      target_client: 'CLOUD_API',
      selected_provider: 'gemini',
      selected_model: 'gemini-flash',
      sensitivity_score: 0,
      detected_secrets: [],
      requires_rag: false,
    }),
    sseEvent({ type: 'rag', status: 'skipped', hit_count: 0, snippets: [] }),
    sseEvent({ type: 'token', content: 'Updated App.jsx with clear-completed filter:\n\n' }),
    sseEvent({ type: 'token', content: '```jsx\n' }),
    sseEvent({ type: 'token', content: `${code}\n` }),
    sseEvent({ type: 'token', content: '```\n' }),
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

function buildAuditReport() {
  return {
    languages: [
      { name: 'JavaScript', pct: 80, color: '#f1e05a' },
      { name: 'Markdown', pct: 20, color: '#083fa1' },
    ],
    frameworks: ['React', 'JavaScript'],
    file_count: 4,
    size_bytes: 4096,
    phases: PHASE_NAMES.map((name, i) => ({
      id: i + 1,
      name,
      status: i < 2 ? 'completed' : i < 4 ? 'in_progress' : 'pending',
      pct: i < 2 ? 80 : i < 4 ? 35 : 0,
      deliverables:
        i === 0
          ? ['docs/phase_1_expression_du_besoin/cdc.md']
          : i === 4
            ? ['src/App.jsx']
            : [],
    })),
    scores: {
      code_quality: 70,
      rag_readiness: 60,
      security: 50,
      test_completeness: 20,
    },
  }
}

function provisionHostTree() {
  fs.mkdirSync(path.join(PROJECT_DIR, 'docs', 'phase_1_expression_du_besoin'), {
    recursive: true,
  })
  fs.mkdirSync(path.join(PROJECT_DIR, 'docs', 'phase_3_architecture'), { recursive: true })
  fs.mkdirSync(path.join(PROJECT_DIR, 'src'), { recursive: true })
  fs.mkdirSync(path.join(PROJECT_DIR, 'tests'), { recursive: true })
  fs.mkdirSync(path.join(PROJECT_DIR, '.fuzyo'), { recursive: true })
  fs.writeFileSync(
    path.join(PROJECT_DIR, '.fuzyo', 'workspace.json'),
    JSON.stringify(
      {
        id: WS_ID,
        name: 'Todo Master App',
        custom_host_path: HOST_BASE,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  )
  for (const rel of ['package.json', 'README.md', 'src/App.jsx', 'src/index.js']) {
    const src = path.join(FIXTURE_DIR, rel)
    const dest = path.join(PROJECT_DIR, rel === 'package.json' || rel === 'README.md' ? rel : rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
  fs.writeFileSync(
    path.join(PROJECT_DIR, 'docs', 'phase_1_expression_du_besoin', 'cdc.md'),
    '# CDC\n\nTodo Master App requirements.\n',
    'utf8',
  )
}

function createStore() {
  return {
    workspaces: [],
    audit: buildAuditReport(),
    chatMode: 'mermaid',
  }
}

async function installMocks(page, store) {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    })
  })

  await page.route('**/api/v1/models/available', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { provider: 'auto', id: 'auto', label: 'Auto (SDLC routing)' },
        { provider: 'gemini', id: 'gemini-flash', label: 'Gemini Flash' },
      ]),
    })
  })

  await page.route('**/api/v1/chat/completions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = store.chatMode === 'code' ? buildCodeSse() : buildMermaidSse()
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body,
    })
  })

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const pathname = url.pathname

    if (pathname.startsWith('/api/v1/chat/')) {
      await route.fallback()
      return
    }

    if (pathname === '/api/v1/workspaces' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(store.workspaces),
      })
      return
    }

    if (pathname === '/api/v1/workspaces/create-and-ingest' && method === 'POST') {
      const now = new Date().toISOString()
      const ws = {
        id: WS_ID,
        name: 'Todo Master App',
        description: null,
        tech_stack: ['React', 'JavaScript'],
        custom_instructions: null,
        owner_id: null,
        created_at: now,
        sdlc_audit_report: store.audit,
      }
      try {
        const postData = request.postData() || ''
        const nameMatch = /name="name"\r?\n\r?\n([^\r\n]+)/.exec(postData)
        if (nameMatch) ws.name = nameMatch[1].trim()
      } catch {
        /* keep */
      }
      store.workspaces = [ws]
      provisionHostTree()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workspace: ws,
          files_ingested: 4,
          chunks_inserted: 8,
          skipped_ignored: 0,
          sdlc_audit_report: store.audit,
        }),
      })
      return
    }

    const analyticsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/analytics$/)
    if (analyticsMatch && method === 'GET') {
      const ws = store.workspaces.find((w) => w.id === analyticsMatch[1]) || store.workspaces[0]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workspace_id: ws?.id || WS_ID,
          name: ws?.name || 'Todo Master App',
          chunk_count: 8,
          document_count: 4,
          sdlc_phase_completion: Object.fromEntries(
            PHASE_NAMES.map((_, i) => [String(i + 1), i < 2]),
          ),
          sdlc_completion_pct: 35,
          tech_stack: ['React', 'JavaScript'],
          documentation_coverage_pct: 40,
          testability_score: 20,
          sdlc_audit_report: store.audit,
          prompt_count: 2,
          thread_count: 1,
          active_sdlc_phase: 3,
        }),
      })
      return
    }

    const treeMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/fs\/tree$/)
    if (treeMatch && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path: '',
          entries: [
            {
              name: 'src',
              path: 'src',
              type: 'dir',
              children: [
                { name: 'App.jsx', path: 'src/App.jsx', type: 'file', size: 100 },
                { name: 'index.js', path: 'src/index.js', type: 'file', size: 80 },
              ],
            },
            { name: 'docs', path: 'docs', type: 'dir', children: [] },
            { name: 'tests', path: 'tests', type: 'dir', children: [] },
          ],
        }),
      })
      return
    }

    const fileMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/fs\/file$/)
    if (fileMatch && method === 'GET') {
      const rel = url.searchParams.get('path') || 'src/App.jsx'
      const disk = path.join(PROJECT_DIR, rel)
      const content = fs.existsSync(disk)
        ? fs.readFileSync(disk, 'utf8')
        : '// missing'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path: rel,
          content,
          encoding: 'utf-8',
          size: content.length,
        }),
      })
      return
    }

    if (fileMatch && method === 'PUT') {
      const payload = request.postDataJSON() || {}
      const rel = String(payload.path || 'src/App.jsx').replace(/\\/g, '/')
      const disk = path.join(PROJECT_DIR, rel)
      fs.mkdirSync(path.dirname(disk), { recursive: true })
      fs.writeFileSync(disk, payload.content || '', 'utf8')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ path: rel, workspace_root: PROJECT_DIR }),
      })
      return
    }

    const applyMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/apply-changes$/)
    if (applyMatch && method === 'POST') {
      const payload = request.postDataJSON() || {}
      const written = []
      for (const file of payload.files || []) {
        let rel = String(file.relative_path || '').replace(/\\/g, '/')
        // Product default path is src/assistant-snippet.jsx; Todo audit targets App.jsx
        if (rel === 'src/assistant-snippet.jsx' || rel.endsWith('/assistant-snippet.jsx')) {
          rel = 'src/App.jsx'
        }
        const disk = path.join(PROJECT_DIR, rel)
        fs.mkdirSync(path.dirname(disk), { recursive: true })
        fs.writeFileSync(disk, file.content || '', 'utf8')
        written.push(rel)
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          written,
          workspace_root: PROJECT_DIR,
          sdlc_audit_report: store.audit,
          ingested: written.length,
        }),
      })
      return
    }

    const dlMatch = pathname.match(
      /^\/api\/v1\/workspaces\/([^/]+)\/deliverables\/(\d+)\/download$/,
    )
    if (dlMatch && method === 'GET') {
      const phase = Number(dlMatch[2])
      const fmt = (url.searchParams.get('format') || 'docx').toLowerCase()
      if (fmt === 'zip' || phase === 5 || phase === 6) {
        await route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="todo_phase_${phase}.zip"`,
          },
          body: Buffer.from('PK\u0003\u0004todo-zip-fixture'),
        })
        return
      }
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="todo_phase_${phase}_CDC.docx"`,
        },
        // Minimal ZIP/OOXML signature
        body: Buffer.from('PK\u0003\u0004docx-fixture'),
      })
      return
    }

    if (pathname.match(/\/threads/) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
      return
    }

    if (pathname.match(/\/threads$/) && method === 'POST') {
      const payload = request.postDataJSON() || {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: payload.id || crypto.randomUUID(),
          title: payload.title || 'New chat',
          workspace_id: WS_ID,
          updated_at: new Date().toISOString(),
        }),
      })
      return
    }

    if (pathname.match(/\/messages$/) && (method === 'GET' || method === 'PUT')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: method === 'GET' ? JSON.stringify([]) : JSON.stringify({ ok: true }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('Fuzyo Copilot - Todo App A-to-Z Simulation', () => {
  const passedSteps = []
  const failedSteps = []
  /** @type {{ workspaces: any[], audit: any, chatMode: string }} */
  let store

  test.beforeAll(() => {
    clearAuditReport()
    logAudit({
      category: 'Setup',
      message: 'Todo App E2E simulation starting (auth via E2E bypass)',
    })
    fs.rmSync(HOST_BASE, { recursive: true, force: true })
    fs.mkdirSync(HOST_BASE, { recursive: true })
  })

  test.afterAll(() => {
    writeAuditSummary({ passedSteps, failedSteps })
    fs.rmSync(HOST_BASE, { recursive: true, force: true })
    logAudit({
      category: 'Cleanup',
      message: `Removed host tree ${HOST_BASE}`,
    })
  })

  test.beforeEach(async ({ page }) => {
    store = createStore()
    await installMocks(page, store)
    attachAuditListeners(page)
    await page.addInitScript(() => {
      localStorage.setItem('fuzyo:ide-explorer-collapsed', '0')
      localStorage.setItem('fuzyo:ide-agent-collapsed', '0')
    })
  })

  test('1. Authentication & session (E2E bypass)', async ({ page }) => {
    try {
      await page.goto('/')
      await expect(page.getByTestId('new-project-button')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByPlaceholder('Message Fuzyo…')).toBeVisible()
      logAudit({
        category: 'Auth',
        message: 'Session established via VITE_E2E_AUTH_BYPASS (signup UI skipped)',
        url: page.url(),
      })
      passedSteps.push('1. Authentication & session')
    } catch (err) {
      failedSteps.push(`1. Authentication: ${err}`)
      throw err
    }
  })

  test('2. Dual-mode workspace creation with custom host path', async ({ page }) => {
    try {
      await page.goto('/')
      await page.getByTestId('new-project-button').click()
      await expect(page.getByTestId('create-workspace-form')).toBeVisible()

      await page.getByTestId('mode-codebase').click()
      await page.locator('#create-ws-name').fill('Todo Master App')
      await page.getByTestId('custom-host-path').fill(HOST_BASE)

      // webkitdirectory inputs require a directory path (not file list)
      await page.locator('input[webkitdirectory]').setInputFiles(FIXTURE_DIR)

      await page.getByRole('button', { name: 'Create & ingest' }).click()

      await expect(page.getByTestId('create-workspace-form')).toHaveCount(0, {
        timeout: 30_000,
      })
      await page.getByTitle('Todo Master App').first().click()
      await expect(page.getByTestId('ide-workspace')).toBeVisible({ timeout: 30_000 })
      expect(fs.existsSync(path.join(PROJECT_DIR, 'src'))).toBeTruthy()
      expect(fs.existsSync(path.join(PROJECT_DIR, 'docs'))).toBeTruthy()
      expect(fs.existsSync(path.join(PROJECT_DIR, 'tests'))).toBeTruthy()
      expect(fs.existsSync(path.join(PROJECT_DIR, '.fuzyo', 'workspace.json'))).toBeTruthy()

      logAudit({
        category: 'Workspace',
        message: `Provisioned host tree at ${PROJECT_DIR}`,
      })
      passedSteps.push('2. Workspace create & host provision')
    } catch (err) {
      failedSteps.push(`2. Workspace: ${err}`)
      throw err
    }
  })

  test('3. SDLC overview & analytics scan verification', async ({ page }) => {
    try {
      store.workspaces = [
        {
          id: WS_ID,
          name: 'Todo Master App',
          description: null,
          tech_stack: ['React', 'JavaScript'],
          custom_instructions: null,
          created_at: new Date().toISOString(),
        },
      ]
      provisionHostTree()

      await page.goto('/')
      await page.getByTestId('global-projects-button').click()
      await page.getByTestId(`projects-picker-item-${WS_ID}`).click()

      await expect(page.getByTestId('tech-stack-bar')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('tech-stack-bar')).toContainText(/React|JavaScript/)
      await expect(page.getByTestId('sdlc-workflow-graph')).toBeVisible()
      await expect(page.getByTestId('sdlc-phase-node-3')).toBeVisible()

      await page.getByTestId('sdlc-phase-node-3').click()
      await expect(page.getByTestId('phase-drawer')).toBeVisible()
      await expect(page.getByTestId('phase-drawer')).toContainText('Architecture')

      logAudit({ category: 'Analytics', message: 'Tech stack + phase 3 drawer verified' })
      passedSteps.push('3. Analytics & phase drawer')
    } catch (err) {
      failedSteps.push(`3. Analytics: ${err}`)
      throw err
    }
  })

  test('4. Dynamic canvas chat & artifact interaction', async ({ page }) => {
    try {
      store.workspaces = [
        {
          id: WS_ID,
          name: 'Todo Master App',
          tech_stack: ['React', 'JavaScript'],
          created_at: new Date().toISOString(),
        },
      ]
      store.chatMode = 'mermaid'
      provisionHostTree()

      await page.goto('/')
      await page.getByTestId('global-projects-button').click()
      await page.getByTestId(`projects-picker-item-${WS_ID}`).click()
      // From analytics, open IDE via palette or project list — use Open IDE in chrome via sidebar project
      await page.evaluate(() => {
        window.dispatchEvent(new Event('fuzyo:noop'))
      })
      // Click project name in Projects section to open IDE
      await page.getByTitle('Todo Master App').first().click()
      await expect(page.getByTestId('ide-workspace')).toBeVisible({ timeout: 20_000 })

      const phaseSelect = page.locator('#sdlc-phase-select')
      await phaseSelect.selectOption('3')

      await page.getByPlaceholder('Message Fuzyo…').fill(
        'Generate a Mermaid architecture diagram for this Todo App showing the React frontend, state store, and LocalStorage layer.',
      )
      await page.getByRole('button', { name: 'Send' }).click()

      await expect(page.getByTestId('dynamic-message-renderer').first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByTestId('expand-canvas').first()).toBeVisible({ timeout: 20_000 })
      // IDE chat may auto-open Canvas + Inspector drawers over the message Expand control
      for (const label of ['Close canvas', 'Close inspector']) {
        const btn = page.getByRole('button', { name: label })
        if (await btn.isVisible().catch(() => false)) {
          await btn.click()
        }
      }
      await page.getByTestId('expand-canvas').first().click({ force: true })

      await expect(page.getByTestId('artifact-canvas-modal')).toBeVisible()
      await page.getByTestId('canvas-zoom-in').click()
      await expect(page.getByTestId('canvas-controls')).toContainText('120%')
      await page.getByTestId('canvas-zoom-out').click()
      await page.getByTestId('canvas-reset').click()
      await expect(page.getByTestId('canvas-controls')).toContainText('100%')
      await page.getByTestId('canvas-close').click()
      await expect(page.getByTestId('artifact-canvas-modal')).toHaveCount(0)

      logAudit({ category: 'Canvas', message: 'Expand/zoom/reset/close verified' })
      passedSteps.push('4. Canvas interactions')
    } catch (err) {
      failedSteps.push(`4. Canvas: ${err}`)
      throw err
    }
  })

  test('5. Deliverables export engine', async ({ page }) => {
    try {
      store.workspaces = [
        {
          id: WS_ID,
          name: 'Todo Master App',
          tech_stack: ['React', 'JavaScript'],
          created_at: new Date().toISOString(),
        },
      ]
      provisionHostTree()

      await page.goto('/')
      await page.getByTestId('global-projects-button').click()
      await page.getByTestId(`projects-picker-item-${WS_ID}`).click()
      await expect(page.getByTestId('sdlc-workflow-graph')).toBeVisible({ timeout: 20_000 })

      await page.getByTestId('sdlc-phase-node-1').click()
      await expect(page.getByTestId('phase-drawer')).toBeVisible()
      const download1Promise = page.waitForEvent('download')
      await page
        .getByTestId('deliverable-download')
        .filter({ hasText: /CDC|\.docx/i })
        .first()
        .click()
      const download1 = await download1Promise
      expect(download1.suggestedFilename()).toMatch(/\.docx$/i)

      await page.getByLabel('Close phase drawer').click()
      await page.getByTestId('sdlc-phase-node-5').click()
      await expect(page.getByTestId('phase-drawer')).toBeVisible()
      const download5Promise = page.waitForEvent('download')
      await page
        .getByTestId('deliverable-download')
        .filter({ hasText: /\.zip/i })
        .first()
        .click()
      const download5 = await download5Promise
      expect(download5.suggestedFilename()).toMatch(/\.zip$/i)

      logAudit({ category: 'Exports', message: 'Phase 1 docx + phase 5 zip downloads ok' })
      passedSteps.push('5. Deliverable exports')
    } catch (err) {
      failedSteps.push(`5. Exports: ${err}`)
      throw err
    }
  })

  test('6. Apply & Sync updates host App.jsx', async ({ page }) => {
    try {
      store.workspaces = [
        {
          id: WS_ID,
          name: 'Todo Master App',
          tech_stack: ['React', 'JavaScript'],
          created_at: new Date().toISOString(),
        },
      ]
      store.chatMode = 'code'
      provisionHostTree()

      await page.goto('/')
      await page.getByTitle('Todo Master App').first().click()
      await expect(page.getByTestId('ide-workspace')).toBeVisible({ timeout: 20_000 })

      await page.locator('#sdlc-phase-select').selectOption('5')
      await page.getByPlaceholder('Message Fuzyo…').fill(
        'Add a filter function to clear completed todos in App.jsx.',
      )
      await page.getByRole('button', { name: 'Send' }).click()

      await expect(page.getByTestId('apply-sync-to-host').first()).toBeVisible({
        timeout: 20_000,
      })
      for (const label of ['Close canvas', 'Close inspector']) {
        const btn = page.getByRole('button', { name: label })
        if (await btn.isVisible().catch(() => false)) {
          await btn.click()
        }
      }
      await page.getByTestId('apply-sync-to-host').first().click({ force: true })

      // IDE mode queues a DiffReview — Accept writes via apply-changes
      await expect(page.getByTestId('diff-review-panel')).toBeVisible({ timeout: 15_000 })
      const applyReq = page.waitForRequest(
        (req) =>
          req.method() === 'POST' && req.url().includes('/apply-changes'),
      )
      await page.getByTestId('diff-accept').click()
      await applyReq
      await expect(page.getByText(/Accepted src\//i).first()).toBeVisible({
        timeout: 15_000,
      })

      const hostApp = path.join(PROJECT_DIR, 'src', 'App.jsx')
      await expect
        .poll(() => (fs.existsSync(hostApp) ? fs.readFileSync(hostApp, 'utf8') : ''), {
          timeout: 10_000,
        })
        .toContain('E2E_CLEAR_COMPLETED_APPLIED')

      logAudit({
        category: 'ApplySync',
        message: `Host file updated: ${hostApp}`,
      })
      passedSteps.push('6. Apply & Sync host write')
    } catch (err) {
      failedSteps.push(`6. Apply sync: ${err}`)
      throw err
    }
  })
})
