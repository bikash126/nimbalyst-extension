/**
 * Extension tests -- run via the extension_test_run MCP tool.
 *
 * These tests connect to the running Nimbalyst instance via CDP.
 * Make sure Nimbalyst is running in dev mode (npm run dev).
 *
 * Usage:
 *   extension_test_run({ testFile: "<absolute-path>/tests/basics.spec.ts" })
 */
import { test, expect } from '@nimbalyst/extension-sdk/testing';

test.describe('Task Worktree Launcher', () => {
  test('panel opens and lists repos', async ({ page }) => {
    // Open the panel via its gutter icon/title, then assert the form is visible.
    await expect(page.getByText('Task Worktree Launcher')).toBeVisible({ timeout: 5000 });
  });

  // Add more tests here as you build out the extension
});
