import { expect, test } from '@playwright/test'

/**
 * IDE shell smoke + collapse toggles (E2E auth bypass + mocked FS).
 */
test.describe('IDE workspace shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('fuzyo:ide-explorer-collapsed', '0')
      localStorage.setItem('fuzyo:ide-agent-collapsed', '0')
    })

    await page.route('**/api/v1/workspaces', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: '11111111-1111-1111-1111-111111111111',
              name: 'IdeDemo',
              description: null,
              tech_stack: [],
              custom_instructions: null,
              owner_id: null,
              created_at: new Date().toISOString(),
            },
          ]),
        })
        return
      }
      await route.fallback()
    })

    await page.route('**/api/v1/workspaces/*/fs/tree*', async (route) => {
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
              children: [{ name: 'main.py', path: 'src/main.py', type: 'file', size: 12 }],
            },
            { name: 'tests', path: 'tests', type: 'dir', children: [] },
          ],
        }),
      })
    })

    await page.route('**/api/v1/workspaces/*/fs/file*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            path: 'src/main.py',
            content: 'print("hi")\n',
            encoding: 'utf-8',
            size: 12,
          }),
        })
        return
      }
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ path: 'src/main.py', workspace_root: '/tmp' }),
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

    await page.goto('/')
  })

  test('Open IDE shows three-pane shell', async ({ page }) => {
    await page.getByText('IdeDemo').first().click()
    await expect(page.getByTestId('ide-workspace')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('file-explorer')).toBeVisible()
    await expect(page.getByTestId('ide-chat-panel')).toBeVisible()

    await page.getByText('main.py').click()
    await expect(page.getByTestId('file-editor')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('editor-tab-bar')).toContainText('main.py')
  })

  test('Collapse and expand explorer and agent panes', async ({ page }) => {
    await page.getByText('IdeDemo').first().click()
    await expect(page.getByTestId('ide-workspace')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('collapse-explorer').click()
    await expect(page.getByTestId('explorer-rail')).toBeVisible()
    await expect(page.getByTestId('file-explorer')).toHaveCount(0)

    await page.getByTestId('expand-explorer').click()
    await expect(page.getByTestId('file-explorer')).toBeVisible()

    await page.getByTestId('collapse-agent').click()
    await expect(page.getByTestId('agent-rail')).toBeVisible()
    await expect(page.getByTestId('ide-chat-panel')).toHaveCount(0)

    await page.getByTestId('expand-agent').click()
    await expect(page.getByTestId('ide-chat-panel')).toBeVisible()
    await expect(page.getByTestId('chat-container')).toBeVisible()
  })
})
