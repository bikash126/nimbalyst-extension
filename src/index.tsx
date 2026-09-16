import type { ExtensionContext } from '@nimbalyst/extension-sdk';
import { TaskWorktreeLauncher } from './TaskWorktreeLauncher';
import { setAiService } from './aiService';
import './styles.css';

export function activate(context: ExtensionContext) {
  setAiService(context.services.ai);
  console.log('Task Worktree Launcher extension activated');
}

export function deactivate() {
  setAiService(undefined);
  console.log('Task Worktree Launcher extension deactivated');
}

export const panels = {
  taskWorktreeLauncher: {
    component: TaskWorktreeLauncher,
  },
};
