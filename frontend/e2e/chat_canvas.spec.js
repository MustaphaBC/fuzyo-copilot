import { expect, test } from '@playwright/test'

function sseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function buildArchitectureSseBody() {
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
    sseEvent({
      type: 'rag',
      status: 'skipped',
      hit_count: 0,
      snippets: [],
    }),
    sseEvent({
      type: 'token',
      content: 'Architecture overview\n\n',
    }),
    sseEvent({
      type: 'token',
      content: '```mermaid\n',
    }),
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

/**
 * Mock chat completions as SSE. Body is a Buffer (Playwright does not
 * reliably stream ReadableStream from route.fulfill). The app still parses
 * multiple data: events and appends token contents in order.
 */
async function mockChatSse(page) {
  await page.route('**/api/v1/chat/completions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: buildArchitectureSseBody(),
    })
  })

  // Avoid hanging when backend is down during Vite-only runs.
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

  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    })
  })
}

async function selectArchitectureAndSend(page, prompt) {
  const phaseSelect = page.locator('#sdlc-phase-select')
  await phaseSelect.selectOption('3')
  await expect(phaseSelect).toHaveValue('3')

  const confidential = page.getByRole('switch', { name: /Confidential/i })
  if ((await confidential.getAttribute('aria-checked')) === 'true') {
    await confidential.click()
  }

  await page.getByPlaceholder('Message Fuzyo…').fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
}

test.describe('Chat SSE + Canvas Mermaid', () => {
  test.beforeEach(async ({ page }) => {
    await mockChatSse(page)
    await page.goto('/')
  })

  test('Architecture phase streams and appends SSE tokens', async ({ page }) => {
    await selectArchitectureAndSend(
      page,
      'Propose a microservices layout with a mermaid flowchart',
    )

    // Multiple token events are appended into one assistant message.
    await expect(page.getByText('Architecture overview')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('[CLOUD]')).toBeVisible()

    const main = page.locator('main')
    await expect(main).toContainText('Architecture overview')
    await expect(main).toContainText('flowchart')
    await expect(main).toContainText('Client')
    await expect(main).toContainText('API')
    await expect(main).toContainText('DB')
  })

  test('Expand Canvas opens interactive dark viewport with zoom controls', async ({ page }) => {
    await selectArchitectureAndSend(
      page,
      'Generate an architecture flowchart for an authentication microservice',
    )

    const expand = page.getByTestId('expand-canvas')
    await expect(expand.first()).toBeVisible({ timeout: 15_000 })
    await expand.first().click()

    const modal = page.getByTestId('artifact-canvas-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('canvas-controls')).toBeVisible()

    const stage = page.getByTestId('artifact-canvas-stage')
    await expect(stage).toBeVisible()

    await page.getByTestId('canvas-zoom-in').click()
    await expect(page.getByTestId('canvas-controls')).toContainText('120%')

    await page.getByTestId('canvas-zoom-out').click()
    await expect(page.getByTestId('canvas-controls')).toContainText('100%')

    await page.getByTestId('canvas-zoom-in').click()
    await page.getByTestId('canvas-reset').click()
    await expect(page.getByTestId('canvas-controls')).toContainText('100%')

    // Drag-pan: pointer events on viewport
    const box = await modal.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40)
      await page.mouse.up()
    }

    await page.getByTestId('canvas-close').click()
    await expect(modal).toHaveCount(0)
  })
})
