# Task Worktree Launcher -- Nimbalyst Extension

This is a **Nimbalyst extension** project. Nimbalyst is an extensible, AI-native workspace and code editor. Extensions add custom editors, AI tools, panels, themes, and more.

- **Extension ID**: `com.ebpearls.task-worktree-launcher`
- **Template**: `starter`
- **File patterns**: `*.example`

## Documentation

Use these docs in this order:

1. **Bundled SDK docs in packaged Nimbalyst**
   - Cross-platform runtime path: `path.join(process.resourcesPath, 'extension-sdk-docs')`
   - macOS example: `/Applications/Nimbalyst.app/Contents/Resources/extension-sdk-docs`
   - Windows example: `<Nimbalyst install dir>\\resources\\extension-sdk-docs`
2. **Monorepo source docs** (when developing inside the Nimbalyst repo)
   - `packages/extension-sdk-docs/README.md`
   - `packages/extension-sdk-docs/getting-started.md`
   - `packages/extension-sdk-docs/custom-editors.md`
   - `packages/extension-sdk-docs/ai-tools.md`
   - `packages/extension-sdk-docs/manifest-reference.md`
   - `packages/extension-sdk-docs/api-reference.md`
   - `packages/extension-sdk-docs/examples/`
3. **Hosted docs**
   - `https://docs.nimbalyst.com/extensions`

When examples are more helpful than prose, prefer the example projects in `packages/extension-sdk-docs/examples/` and the built-in extensions in `packages/extensions/`.

## Build and Development Workflow

Extensions are built with Vite and installed into the running Nimbalyst app using MCP tools. **Do not run `npm run build` manually** -- always use the MCP tools so the extension is installed in one step.

| Action | MCP Tool |
| --- | --- |
| Build | `mcp__nimbalyst-extension-dev__extension_build` |
| Install | `mcp__nimbalyst-extension-dev__extension_install` |
| Build + reinstall (hot reload) | `mcp__nimbalyst-extension-dev__extension_reload` |
| Check status | `mcp__nimbalyst-extension-dev__extension_get_status` |
| Uninstall | `mcp__nimbalyst-extension-dev__extension_uninstall` |

**Typical iteration loop:**
1. Edit source files
2. Run `extension_reload` with `extensionId: "com.ebpearls.task-worktree-launcher"` and `path` set to this project root
3. Test in Nimbalyst immediately

**First-time setup:**
1. `npm install` in this directory
2. `extension_build` then `extension_install`
3. When the extension can be exercised with a sample file, create one and open it to test the integration end-to-end

### After Installation

- Tell the user the extension is now installed in Nimbalyst
- Explain that installed extensions are available across all of their Nimbalyst projects, not just this workspace
- When possible, create a representative sample file for the extension and present it to the user for testing immediately after install or reload

### Debugging

- Check extension load status: `extension_get_status` with `extensionId: "com.ebpearls.task-worktree-launcher"`
- Main process logs: `mcp__nimbalyst-extension-dev__get_main_process_logs` (filter by component: "EXTENSION")
- Renderer logs: `mcp__nimbalyst-extension-dev__get_renderer_debug_logs`
- Verify the result visually: `mcp__nimbalyst__capture_editor_screenshot`

### Testing with Playwright

Run Playwright tests against the live running Nimbalyst instance using the `extension_test_run` MCP tool. Tests connect via CDP -- no separate Electron launch needed.

**Inline script (quick check):**
```
extension_test_run({ script: "await expect(page.locator('[data-extension-id=\"com.ebpearls.task-worktree-launcher\"]')).toBeVisible();" })
```

**Test file (persistent tests):**
```
extension_test_run({ testFile: "<project-root>/tests/basics.spec.ts" })
```

**Open a file first:**
```
extension_test_open_file({ filePath: "/path/to/sample.ext", waitForExtension: "com.ebpearls.task-worktree-launcher" })
```

Tests use the full Playwright API -- locators, assertions, interactions, screenshots. See `tests/` for examples.

## Project Structure

```
manifest.json      # Extension manifest -- declares capabilities, contributions, permissions
package.json       # NPM package with build script
vite.config.ts     # Vite build config (uses @nimbalyst/extension-sdk/vite helper)
tsconfig.json      # TypeScript config
src/
  index.ts         # Entry point -- exports components, activate(), deactivate()
tests/
  basics.spec.ts   # Playwright extension tests (run via extension_test_run)
dist/              # Build output (do not edit)
```

## Manifest (`manifest.json`)

The manifest declares what the extension contributes to Nimbalyst. Key fields:

- **`contributions.customEditors`** -- Register editors for file patterns
- **`contributions.aiTools`** -- List AI tool names (must match the `name` field in your tool definitions)
- **`contributions.newFileMenu`** -- Add entries to File > New menu
- **`contributions.fileIcons`** -- Custom icons for file types
- **`contributions.panels`** -- Sidebar or bottom panels
- **`contributions.commands`** -- Commands with optional keybindings
- **`contributions.themes`** -- Color themes (see [EXTENSION_THEMING.md](../../docs/EXTENSION_THEMING.md); manifest-only theme extensions are supported)
- **`contributions.claudePlugin`** -- Claude Code agent skills and slash commands (see below)
- **`permissions`** -- Request `filesystem`, `ai`, or `network` access

## Claude Agent Skills (`claudePlugin`)

Extensions can bundle **Claude Code skills** -- slash commands and agent context that enhance the AI agent's capabilities within Nimbalyst.

### Directory structure

```
claude-plugin/
  .claude-plugin/
    plugin.json          # Plugin metadata
  commands/
    my-command.md        # Slash command (user types /my-command)
  skills/
    my-skill/
      SKILL.md           # Skill definition (auto-triggered by agent)
```

### Register in manifest.json

```json
{
  "contributions": {
    "claudePlugin": {
      "path": "claude-plugin",
      "displayName": "Task Worktree Launcher",
      "description": "What the plugin provides to the agent",
      "enabledByDefault": true,
      "commands": [
        { "name": "my-command", "description": "What /my-command does" }
      ]
    }
  }
}
```

### plugin.json

```json
{
  "name": "com-developer-my-nimbalyst-extension",
  "version": "1.0.0",
  "description": "Claude Code plugin for Task Worktree Launcher",
  "keywords": []
}
```

### Slash command (`commands/my-command.md`)

```markdown
---
description: Short description shown in command palette
---

# /my-command

Detailed instructions for Claude when the user invokes /my-command.

The user said: $ARGUMENTS
```

### Skill (`skills/my-skill/SKILL.md`)

Skills are automatically loaded when their description matches the task. They provide domain context and tool usage instructions.

```markdown
---
name: my-skill
description: When and why the agent should use this skill (be specific so it triggers correctly)
---

# Skill Name

Instructions for the agent, including which MCP tools to use and in what order.
```

## SDK Reference

The `@nimbalyst/extension-sdk` package provides types and the Vite build helper.
The `@nimbalyst/extension-sdk` package also re-exports the `useEditorLifecycle` hook (provided by the host at runtime -- do not add `@nimbalyst/runtime` to package.json).

Key imports:
```typescript
// Types from SDK
import type {
  EditorHostProps,      // Props for custom editor components
  ExtensionAITool,      // AI tool definition
  AIToolContext,         // Context passed to tool handlers
  ExtensionToolResult,  // Return type for tool handlers
  ExtensionContext,      // Passed to activate()
  PanelHostProps,        // Props for panel components
  ExtensionStorage,      // Workspace and global key-value storage
} from '@nimbalyst/extension-sdk';

import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

// Hook (provided by host at runtime -- do NOT add @nimbalyst/runtime to dependencies)
import { useEditorLifecycle } from '@nimbalyst/extension-sdk';
```