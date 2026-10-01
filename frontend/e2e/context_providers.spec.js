import { expect, test } from '@playwright/test'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

/** Every key the monolithic `useApp()` value exposed before the context split. */
const LEGACY_APP_KEYS = [
  'workspaces', 'setWorkspaces', 'workspacesLoading', 'refreshWorkspaces', 'deleteWorkspace',
  'activeWorkspace', 'setActiveWorkspace', 'sdlcPhase', 'setSdlcPhase', 'forceConfidential',
  'setForceConfidential', 'skillsMode', 'setSkillsMode', 'viewMode', 'setViewMode',
  'workspaceModal', 'openWorkspaceModal', 'closeWorkspaceModal', 'messages', 'setMessages',
  'threads', 'activeThreadId', 'selectThread', 'resetChat', 'deleteThread', 'toggleThreadPin',
  'artifactLibrary', 'appendArtifact', 'inputMode', 'setInputMode', 'selectedModelKey',
  'setSelectedModelKey', 'apiHealthy', 'appearance', 'resolvedAppearance', 'setAppearance',
  'toggleAppearance', 'density', 'setDensity', 'composerSeed', 'seedComposer',
  'persistThreadMessagesToServer', 'syncThreadMessagesFromServer', 'refreshThreads', 'openFiles',
  'activeFilePath', 'pendingDiff', 'ideTreeCache', 'setIdeTreeCache', 'openIdeFile',
  'closeIdeFile', 'setActiveFile', 'updateIdeFileContent', 'markDirty', 'setPendingDiff',
  'clearPendingDiff', 'openWorkspaceInIde', 'openProject', 'routeTab', 'aiBehavior',
  'setAiBehavior', 'languageFromPath',
]

const LEGACY_STATE_KEYS = new Set([
  'workspaces', 'workspacesLoading', 'activeWorkspace', 'sdlcPhase', 'forceConfidential',
  'skillsMode', 'viewMode', 'workspaceModal', 'messages', 'threads', 'activeThreadId',
  'artifactLibrary', 'inputMode', 'selectedModelKey', 'apiHealthy', 'appearance',
  'resolvedAppearance', 'density', 'composerSeed', 'openFiles', 'activeFilePath', 'pendingDiff',
  'ideTreeCache', 'routeTab', 'aiBehavior',
])

const EXPECTED_KEYS = {
  preferences: [
    'appearance', 'resolvedAppearance', 'setAppearance', 'toggleAppearance', 'density',
    'setDensity', 'apiHealthy',
  ],
  workspace: [
    'workspaces', 'setWorkspaces', 'workspacesLoading', 'refreshWorkspaces', 'deleteWorkspace',
    'activeWorkspace', 'setActiveWorkspace', 'workspaceModal', 'openWorkspaceModal',
    'closeWorkspaceModal', 'viewMode', 'setViewMode', 'routeTab', 'openProject',
    'openWorkspaceInIde', 'ideTreeCache', 'setIdeTreeCache',
  ],
  editor: [
    'openFiles', 'activeFilePath', 'pendingDiff', 'openIdeFile', 'closeIdeFile', 'setActiveFile',
    'updateIdeFileContent', 'markDirty', 'setPendingDiff', 'clearPendingDiff', 'languageFromPath',
    'saveLocalArtifact',
  ],
  controls: [
    'sdlcPhase', 'setSdlcPhase', 'forceConfidential', 'setForceConfidential', 'skillsMode',
    'setSkillsMode', 'inputMode', 'setInputMode', 'selectedModelKey', 'setSelectedModelKey',
    'composerSeed', 'seedComposer', 'aiBehavior', 'setAiBehavior', 'setMessages', 'selectThread',
    'resetChat', 'deleteThread', 'toggleThreadPin', 'appendArtifact',
    'persistThreadMessagesToServer', 'syncThreadMessagesFromServer', 'refreshThreads',
  ],
}
EXPECTED_KEYS.chat = [...EXPECTED_KEYS.controls, 'messages', 'threads', 'activeThreadId', 'artifactLibrary']

function sseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

async function installMocks(page) {
  await page.route('**/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }),
  )
  await page.route('**/api/v1/workspaces', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/v1/models/available', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ provider: 'auto', id: 'auto', label: 'Auto (SDLC routing)' }]),
    }),
  )
  await page.route('**/api/v1/chat/completions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: [
        sseEvent({
          type: 'routing',
          target_client: 'CLOUD_API',
          selected_provider: 'groq',
          selected_model: 'openai/gpt-oss-120b',
          sensitivity_score: 0.1,
          detected_secrets: [],
          requires_rag: false,
        }),
        sseEvent({ type: 'rag', status: 'skipped', hit_count: 0, query: 'q', snippets: [] }),
        sseEvent({ type: 'token', content: 'Context split reply' }),
        sseEvent({
          type: 'quality',
          is_valid: true,
          tier1_schema_pass: true,
          tier2_heuristic_pass: true,
          tier3_score: 10,
          feedback: '',
        }),
      ].join(''),
    })
  })
}

test.describe('Domain context providers', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page)
    await page.goto('/')
    await expect(page.getByPlaceholder('Message Fuzyo…')).toBeVisible()
  })

  test('each hook exposes its interface and useApp keeps the legacy shape', async ({ page }) => {
    const report = await page.evaluate(async () => {
      const probe = await import('/e2e/fixtures/contextProbe.jsx')
      return probe.probeContexts()
    })

    for (const [domain, keys] of Object.entries(EXPECTED_KEYS)) {
      expect(Object.keys(report.types[domain]).sort(), domain).toEqual([...keys].sort())
    }

    const domainKeys = ['preferences', 'workspace', 'editor', 'chat'].flatMap((domain) =>
      Object.keys(report.types[domain]),
    )
    const chatOnly = new Set(EXPECTED_KEYS.chat)
    const ownedTwice = domainKeys.filter(
      (key, index) => domainKeys.indexOf(key) !== index && !chatOnly.has(key),
    )
    expect(ownedTwice, 'keys provided by more than one domain').toEqual([])

    for (const key of LEGACY_APP_KEYS) {
      expect(report.types.app, `useApp().${key}`).toHaveProperty(key)
    }
    for (const key of LEGACY_APP_KEYS) {
      if (LEGACY_STATE_KEYS.has(key)) continue
      expect(report.types.app[key], `useApp().${key}`).toBe('function')
    }
  })

  test('a streamed token only invalidates the chat context', async ({ page }) => {
    const report = await page.evaluate(async () => {
      const probe = await import('/e2e/fixtures/contextProbe.jsx')
      return probe.probeContexts()
    })

    expect(report.stableAcrossToken).toEqual({
      preferences: true,
      workspace: true,
      editor: true,
      controls: true,
      chat: false,
      app: false,
    })
    expect(report.appSeesToken).toBe(true)
  })

  test('shell flows still work through the narrow hooks', async ({ page }) => {
    const html = page.locator('html')
    const wasDark = await html.evaluate((el) => el.classList.contains('dark'))
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Control+d')
    await expect
      .poll(() => html.evaluate((el) => el.classList.contains('dark')))
      .toBe(!wasDark)

    await page.getByPlaceholder('Message Fuzyo…').fill('hello context split')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('Context split reply').first()).toBeVisible({ timeout: 15_000 })

    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Control+Shift+O')
    await expect(page.getByText('Context split reply')).toHaveCount(0)
    await expect(page).toHaveURL(/\/chat\/[^/]+$/)
  })
})
