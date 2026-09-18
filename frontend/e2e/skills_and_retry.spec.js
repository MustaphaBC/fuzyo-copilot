import { expect, test } from '@playwright/test'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

function sseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function detectSkillFromPrompt(prompt) {
  const m = /^\s*\/(plan|analyze|review|debug)(?:\s|$)/i.exec(prompt)
  return m ? m[1].toLowerCase() : 'none'
}

function baseEvents(skillMode = null, ragQuery = null) {
  const ragPayload = {
    type: 'rag',
    status: 'skipped',
    hit_count: 0,
    query: ragQuery ?? 'test prompt',
    snippets: [],
  }
  const events = [
    sseEvent({
      type: 'routing',
      target_client: 'CLOUD_API',
      selected_provider: 'groq',
      selected_model: 'openai/gpt-oss-120b',
      sensitivity_score: 0.1,
      detected_secrets: [],
      requires_rag: false,
    }),
    sseEvent(ragPayload),
  ]
  if (skillMode && skillMode !== 'none') {
    events.push(sseEvent({ type: 'skill', mode: skillMode }))
  }
  return events
}

function buildSkillSse(skill, prompt) {
  const cleaned = String(prompt || '')
    .replace(/^\s*\/(plan|analyze|review|debug)(?:\s+|\s*\n+\s*)?/i, '')
    .trim()
  const hints = {
    plan: 'planning roadmap: ',
    analyze: 'gap analysis: ',
    review: 'code review: ',
    debug: 'error debug: ',
  }
  const hint = hints[skill] || ''
  const ragQuery = hint ? `${hint}${cleaned || prompt}` : cleaned || prompt || 'test prompt'

  const bodies = {
    plan: '## Roadmap\n- Milestone 1\n',
    analyze: '## Summary\n- Gap noted\n',
    review: '## Issues\n| ID | Finding |\n| --- | --- |\n| 1 | n/a |\n',
    debug: '## Root cause\nAttributeError from None\n',
    none: 'Clean assistant reply\n',
  }
  const token = bodies[skill] || bodies.none

  return [
    ...baseEvents(skill === 'none' ? null : skill, ragQuery),
    sseEvent({ type: 'token', content: token }),
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

function buildRetrySequenceSse(numRetries = 2) {
  const events = [
    ...baseEvents(),
    sseEvent({ type: 'token', content: 'def foo(): pass  # TODO implement' }),
    sseEvent({
      type: 'quality',
      is_valid: false,
      tier1_schema_pass: true,
      tier2_heuristic_pass: false,
      tier3_score: 4,
      feedback: 'TODO placeholder detected.',
    }),
  ]

  for (let i = 0; i < numRetries; i += 1) {
    const attempt = i + 2
    const passes = attempt >= 3 || (numRetries === 1 && attempt === 2)
    events.push(
      sseEvent({
        type: 'retry',
        attempt,
        reason: 'TODO placeholder detected.',
        attempt_score: 4,
      }),
      sseEvent({ type: 'token', content: `Retry ${attempt} content` }),
      sseEvent({
        type: 'quality',
        is_valid: passes,
        tier1_schema_pass: true,
        tier2_heuristic_pass: passes,
        tier3_score: passes ? 8 : 4,
        feedback: passes ? '' : 'Still failing.',
      }),
    )
  }
  return events.join('')
}

/** Chunked SSE so React can paint the retry badge between events. */
function buildDelayedRetryStream(numRetries = 2) {
  return buildRetrySequenceSse(numRetries)
}

async function installMocks(page) {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    })
  })

  await page.route('**/api/v1/workspaces', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/v1/models/available', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { provider: 'auto', id: 'auto', label: 'Auto (SDLC routing)' },
      ]),
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
    const skill = String(body.skill || 'none')

    if (prompt.includes('FORCE_RETRY') && prompt.includes('single retry')) {
      await route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: buildDelayedRetryStream(1),
      })
      return
    }
    if (prompt.includes('FORCE_RETRY')) {
      await route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: buildDelayedRetryStream(2),
      })
      return
    }

    const activeSkill = skill !== 'none' ? skill : detectSkillFromPrompt(prompt)
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSkillSse(activeSkill, prompt),
    })
  })
}

async function openInspector(page) {
  const drawer = page.getByRole('heading', { name: 'Inspector' })
  if (await drawer.isVisible().catch(() => false)) return
  await page.getByRole('button', { name: 'Open inspector' }).click()
  await expect(drawer).toBeVisible()
}

test.describe('Skill SSE events', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page)
    await page.goto('/')
  })

  test('/plan skill chip emits skill SSE and shows Inspector mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Cowork' }).click()
    await page.getByRole('button', { name: '/plan' }).click()
    await page.getByPlaceholder('Message Fuzyo…').fill('build a backlog for the auth module')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible({
      timeout: 15_000,
    })
    await openInspector(page)
    await expect(page.getByText('Mode', { exact: true })).toBeVisible()
    await expect(page.getByText(/planning roadmap:/i)).toBeVisible()
  })

  test('/debug auto-detection from prompt prefix', async ({ page }) => {
    await page.getByPlaceholder('Message Fuzyo…').fill('/debug AttributeError at line 42')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByRole('heading', { name: 'Root cause' })).toBeVisible({
      timeout: 15_000,
    })
    await openInspector(page)
    await expect(page.getByText(/error debug:/i)).toBeVisible()
  })

  test('/review SSE skill event with structured output', async ({ page }) => {
    await page.getByRole('button', { name: 'Cowork' }).click()
    await page.getByRole('button', { name: '/review' }).click()
    await page.getByPlaceholder('Message Fuzyo…').fill('Review this authentication function')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    })
    await openInspector(page)
    await expect(page.getByText('Mode', { exact: true })).toBeVisible()
  })
})

test.describe('Gatekeeper retry loop', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page)
    await page.goto('/')
  })

  test('Retry badge appears during retry and clears on resolution', async ({ page }) => {
    await page.getByPlaceholder('Message Fuzyo…').fill('FORCE_RETRY please write a function')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByTestId('retry-badge')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Retry 3 content').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('retry-badge')).toHaveCount(0)
  })

  test('Retry badge shows correct score', async ({ page }) => {
    await page.getByPlaceholder('Message Fuzyo…').fill('FORCE_RETRY single retry')
    await page.getByRole('button', { name: 'Send' }).click()

    const badge = page.getByTestId('retry-badge')
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toContainText('4/10')
    await expect(page.getByText('Retry 2 content').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('retry-badge')).toHaveCount(0, { timeout: 15_000 })
  })

  test('Inspector Retry section populated', async ({ page }) => {
    await page.getByPlaceholder('Message Fuzyo…').fill('FORCE_RETRY check inspector')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByText(/Retry \d content/).first()).toBeVisible({ timeout: 20_000 })
    await openInspector(page)
    await expect(page.getByText('Attempt', { exact: true })).toBeVisible()
    await expect(page.getByText('Score', { exact: true })).toBeVisible()
    // Last retry SSE in a 2-retry sequence is attempt 3 (meta keeps latest)
    await expect(page.getByText('3', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('TODO placeholder')).toBeVisible()
  })

  test('No retry badge on clean response', async ({ page }) => {
    await page.getByPlaceholder('Message Fuzyo…').fill('A normal clean prompt')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByText('Clean assistant reply').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('retry-badge')).toHaveCount(0)
  })
})
