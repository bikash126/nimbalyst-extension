import { useEffect, useMemo, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { sendSessionPrompt } from './aiService';
import { ConfigurationTab, loadProviderConfig } from './ConfigurationTab';
import { fetchTasks, type FetchedTask } from './providers';
import { MarkdownTextarea } from './MarkdownTextarea';
import { BranchCombobox } from './BranchCombobox';

interface RepoStatus {
  name: string;
  selected: boolean;
  baseBranch: string;
  availableBranches: string[];
  state: 'idle' | 'running' | 'done' | 'error';
  log: string[];
}

const STORAGE_KEY_ENV_FILES = 'envFiles';
const STORAGE_KEY_SYMLINK_FOLDERS = 'symlinkFolders';
const STORAGE_KEY_SYMLINKS_ENABLED = 'symlinksEnabled';
const STORAGE_KEY_SCRIPT = 'postCreateScript';
const STORAGE_KEY_PORT_VARS = 'portEnvVars';
const STORAGE_KEY_BASE_BRANCHES = 'baseBranches';
const STORAGE_KEY_WORKTREE_BASE = 'worktreeBase';
const STORAGE_KEY_AGENT_PROVIDER = 'agentProvider';

type AgentProvider = 'claude-code' | 'claude' | 'openai';

const AGENT_PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code (default)' },
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'Codex / OpenAI' },
];

const PORT_RANGE_MIN = 20000;
const PORT_RANGE_MAX = 59000;

async function findFreePort(host: PanelHostProps['host'], usedPorts: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = PORT_RANGE_MIN + Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN));
    if (usedPorts.has(port)) continue;
    // eslint-disable-next-line no-await-in-loop
    const probe = await host.exec(`nc -z 127.0.0.1 ${port}`);
    if (probe.exitCode !== 0) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error('Could not find a free port after 50 attempts');
}

async function setEnvVar(host: PanelHostProps['host'], envFilePath: string, varName: string, value: string) {
  const grep = await host.exec(`grep -q "^${varName}=" "${envFilePath}"`);
  if (grep.exitCode === 0) {
    await host.exec(`sed -i '' "s/^${varName}=.*/${varName}=${value}/" "${envFilePath}"`);
  } else {
    await host.exec(`printf '\\n${varName}=${value}\\n' >> "${envFilePath}"`);
  }
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task';
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitTokens(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

async function listSiblingRepos(host: PanelHostProps['host']): Promise<string[]> {
  const result = await host.exec(
    "for d in */; do [ -d \"${d%/}/.git\" ] && echo \"${d%/}\"; done",
    { cwd: host.workspacePath },
  );
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

async function getCurrentBranch(host: PanelHostProps['host'], repoPath: string): Promise<string> {
  const result = await host.exec(`git -C "${repoPath}" rev-parse --abbrev-ref HEAD`);
  const branch = result.stdout.trim();
  return result.exitCode === 0 && branch ? branch : 'main';
}

async function listBranches(host: PanelHostProps['host'], repoPath: string): Promise<string[]> {
  const local = await host.exec(`git -C "${repoPath}" branch --format='%(refname:short)'`);
  const remote = await host.exec(`git -C "${repoPath}" branch -r --format='%(refname:short)'`);
  const localBranches = local.stdout.split('\n').map((b) => b.trim()).filter(Boolean);
  const remoteBranches = remote.stdout
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && !b.includes('->'))
    .map((b) => b.replace(/^[^/]+\//, ''));
  return Array.from(new Set([...localBranches, ...remoteBranches])).sort();
}

export function TaskWorktreeLauncher({ host }: PanelHostProps) {
  const [activeTab, setActiveTab] = useState<'newTask' | 'task' | 'config'>('newTask');
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [fetchedTasks, setFetchedTasks] = useState<FetchedTask[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoStatus[]>([]);
  const [worktreeBase, setWorktreeBase] = useState('');
  const [agentProvider, setAgentProvider] = useState<AgentProvider>('claude-code');
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [envFilesText, setEnvFilesText] = useState('');
  const [symlinksEnabled, setSymlinksEnabled] = useState(false);
  const [symlinkFoldersText, setSymlinkFoldersText] = useState('');
  const [script, setScript] = useState('');
  const [portVarsText, setPortVarsText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const names = await listSiblingRepos(host);
        if (cancelled) return;
        const storedBaseBranches = host.storage.get<Record<string, string>>(STORAGE_KEY_BASE_BRANCHES) ?? {};
        const withBranches = await Promise.all(names.map(async (name) => {
          const repoPath = `${host.workspacePath}/${name}`;
          const [currentBranch, availableBranches] = await Promise.all([
            getCurrentBranch(host, repoPath),
            listBranches(host, repoPath),
          ]);
          const baseBranch = storedBaseBranches[name] ?? currentBranch;
          const branchOptions = availableBranches.includes(baseBranch)
            ? availableBranches
            : [baseBranch, ...availableBranches];
          return { name, selected: true, baseBranch, availableBranches: branchOptions, state: 'idle' as const, log: [] };
        }));
        if (cancelled) return;
        setRepos(withBranches);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    setWorktreeBase(host.storage.get<string>(STORAGE_KEY_WORKTREE_BASE) ?? `${host.workspacePath}/.worktrees`);
    setAgentProvider(host.storage.get<AgentProvider>(STORAGE_KEY_AGENT_PROVIDER) ?? 'claude-code');
    setEnvFilesText(host.storage.get<string>(STORAGE_KEY_ENV_FILES) ?? '.env');
    setSymlinkFoldersText(host.storage.get<string>(STORAGE_KEY_SYMLINK_FOLDERS) ?? 'node_modules');
    setSymlinksEnabled(host.storage.get<boolean>(STORAGE_KEY_SYMLINKS_ENABLED) ?? false);
    setScript(host.storage.get<string>(STORAGE_KEY_SCRIPT) ?? '');
    setPortVarsText(host.storage.get<string>(STORAGE_KEY_PORT_VARS) ?? '');

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const envFiles = useMemo(() => splitLines(envFilesText), [envFilesText]);
  const symlinkFolders = useMemo(() => splitLines(symlinkFoldersText), [symlinkFoldersText]);
  const portVars = useMemo(() => splitTokens(portVarsText), [portVarsText]);
  const selectedRepos = repos.filter((r) => r.selected);
  const canRun = taskName.trim().length > 0 && description.trim().length > 0 && selectedRepos.length > 0 && worktreeBase.trim().length > 0 && !isRunning;

  async function handleFetchTasks() {
    setFetchLoading(true);
    setFetchError(null);
    try {
      const config = await loadProviderConfig(host);
      const tasks = await fetchTasks(host, config);
      setFetchedTasks(tasks);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchLoading(false);
    }
  }

  async function handleBrowseWorktreeBase() {
    setBrowseError(null);
    const script = `POSIX path of (choose folder with prompt "Select folder to save worktrees in" default location (POSIX file "${worktreeBase}"))`;
    const result = await host.exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    if (result.exitCode !== 0) {
      // User cancelled the dialog, or osascript is unavailable (non-macOS) -- not necessarily an error worth surfacing loudly.
      if (!/User canceled/i.test(result.stderr)) {
        setBrowseError('Could not open folder picker (osascript unavailable) — type the path manually instead.');
      }
      return;
    }
    const chosen = result.stdout.trim().replace(/\/$/, '');
    if (chosen) setWorktreeBase(chosen);
  }

  function toggleRepo(name: string) {
    setRepos((prev) => prev.map((r) => (r.name === name ? { ...r, selected: !r.selected } : r)));
  }

  function setBaseBranch(name: string, baseBranch: string) {
    setRepos((prev) => prev.map((r) => (r.name === name ? { ...r, baseBranch } : r)));
  }

  function appendLog(name: string, line: string) {
    setRepos((prev) => prev.map((r) => (r.name === name ? { ...r, log: [...r.log, line] } : r)));
  }

  function setRepoState(name: string, state: RepoStatus['state']) {
    setRepos((prev) => prev.map((r) => (r.name === name ? { ...r, state } : r)));
  }

  async function runForRepo(name: string, taskSlug: string, baseBranch: string, usedPorts: Set<number>): Promise<boolean> {
    const repoPath = `${host.workspacePath}/${name}`;
    const worktreePath = `${worktreeBase}/${taskSlug}/${name}`;
    setRepoState(name, 'running');

    try {
      appendLog(name, `Creating worktree at ${worktreePath} (branch ${taskSlug} off ${baseBranch})`);
      const addResult = await host.exec(
        `git -C "${repoPath}" worktree add "${worktreePath}" -b "${taskSlug}" "${baseBranch}"`,
      );
      if (addResult.exitCode !== 0) {
        appendLog(name, `git worktree add failed: ${addResult.stderr || addResult.stdout}`);
        setRepoState(name, 'error');
        return false;
      }

      const copiedEnvFiles: string[] = [];
      for (const relPath of envFiles) {
        const src = `${repoPath}/${relPath}`;
        const dest = `${worktreePath}/${relPath}`;
        const exists = await host.exec(`test -e "${src}"`);
        if (exists.exitCode !== 0) {
          appendLog(name, `Skipped copy (source missing): ${relPath}`);
          continue;
        }
        const destDir = dest.substring(0, dest.lastIndexOf('/'));
        await host.exec(`mkdir -p "${destDir}" && cp "${src}" "${dest}"`);
        appendLog(name, `Copied ${relPath}`);
        copiedEnvFiles.push(dest);
      }

      for (const envFilePath of copiedEnvFiles) {
        await setEnvVar(host, envFilePath, 'COMPOSE_PROJECT_NAME', `${taskSlug}-${name}`);
        appendLog(name, `Set COMPOSE_PROJECT_NAME in ${envFilePath.split('/').pop()}`);

        for (const varName of portVars) {
          const hasVar = await host.exec(`grep -q "^${varName}=" "${envFilePath}"`);
          if (hasVar.exitCode !== 0) continue;
          // eslint-disable-next-line no-await-in-loop
          const port = await findFreePort(host, usedPorts);
          // eslint-disable-next-line no-await-in-loop
          await setEnvVar(host, envFilePath, varName, String(port));
          appendLog(name, `Set ${varName}=${port} in ${envFilePath.split('/').pop()}`);
        }
      }

      if (symlinksEnabled) {
        for (const relPath of symlinkFolders) {
          const src = `${repoPath}/${relPath}`;
          const dest = `${worktreePath}/${relPath}`;
          const exists = await host.exec(`test -e "${src}"`);
          if (exists.exitCode !== 0) {
            appendLog(name, `Skipped symlink (source missing): ${relPath}`);
            continue;
          }
          const alreadyThere = await host.exec(`test -e "${dest}"`);
          if (alreadyThere.exitCode === 0) {
            appendLog(name, `Skipped symlink (destination exists): ${relPath}`);
            continue;
          }
          const destDir = dest.substring(0, dest.lastIndexOf('/'));
          await host.exec(`mkdir -p "${destDir}" && ln -s "${src}" "${dest}"`);
          appendLog(name, `Symlinked ${relPath}`);
        }
      }

      if (script.trim()) {
        appendLog(name, `Running script: ${script}`);
        const scriptResult = await host.exec(script, { cwd: worktreePath });
        appendLog(name, scriptResult.stdout || scriptResult.stderr || '(no output)');
        if (scriptResult.exitCode !== 0) {
          appendLog(name, `Script exited with code ${scriptResult.exitCode}`);
        }
      }

      setRepoState(name, 'done');
      return true;
    } catch (err) {
      appendLog(name, `Error: ${err instanceof Error ? err.message : String(err)}`);
      setRepoState(name, 'error');
      return false;
    }
  }

  async function handleCreate(overrideName?: string, overrideDescription?: string) {
    const nameToUse = overrideName ?? taskName;
    const descriptionToUse = overrideDescription ?? description;
    const slugToUse = slugify(nameToUse);

    setIsRunning(true);
    await host.storage.set(STORAGE_KEY_ENV_FILES, envFilesText);
    await host.storage.set(STORAGE_KEY_SYMLINK_FOLDERS, symlinkFoldersText);
    await host.storage.set(STORAGE_KEY_SYMLINKS_ENABLED, symlinksEnabled);
    await host.storage.set(STORAGE_KEY_SCRIPT, script);
    await host.storage.set(STORAGE_KEY_PORT_VARS, portVarsText);
    const baseBranches = Object.fromEntries(repos.map((r) => [r.name, r.baseBranch]));
    await host.storage.set(STORAGE_KEY_BASE_BRANCHES, baseBranches);
    await host.storage.set(STORAGE_KEY_WORKTREE_BASE, worktreeBase);
    await host.storage.set(STORAGE_KEY_AGENT_PROVIDER, agentProvider);

    const taskRoot = `${worktreeBase}/${slugToUse}`;
    const usedPorts = new Set<number>();
    const succeededRepoNames: string[] = [];
    for (const repo of selectedRepos) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await runForRepo(repo.name, slugToUse, repo.baseBranch, usedPorts);
      if (ok) succeededRepoNames.push(repo.name);
    }

    if (succeededRepoNames.length > 0) {
      const isInsideWorkspace = taskRoot.startsWith(`${host.workspacePath}/`);
      const taskRootRelative = isInsideWorkspace ? taskRoot.slice(host.workspacePath.length + 1) : null;
      const prompt = [
        `Your working directory for this task is ${taskRoot}. cd there first, then work from that directory only.`,
        `It contains one subfolder per repo worktree: ${succeededRepoNames.join(', ')}.`,
        '',
        'Before starting the task, create a tracker item for it and link it to this session and worktree:',
        `1. Call tracker_create with type: "task", title: ${JSON.stringify(nameToUse)}, description: ${JSON.stringify(descriptionToUse)}, status: "in-progress", linkSession: true.`,
        taskRootRelative
          ? `2. Call tracker_link_file with filePath: ${JSON.stringify(taskRootRelative)} (the worktree root, relative to the workspace).`
          : `2. The worktree root (${taskRoot}) is outside the workspace, so skip tracker_link_file — it only accepts workspace-relative paths.`,
        '',
        `Task: ${nameToUse}`,
        '',
        descriptionToUse,
      ].join('\n');

      const started = await sendSessionPrompt({ prompt, sessionName: nameToUse, provider: agentProvider });
      if (!started) {
        setLoadError('Worktrees are ready, but the AI session API is unavailable; no session was started.');
      }
    }

    setIsRunning(false);
  }

  function runFetchedTask(task: FetchedTask) {
    handleCreate(task.title, task.description || task.title);
  }

  const logBlock = (
    <div className="twl-log-block">
      {repos.filter((r) => r.log.length > 0).map((r) => (
        <div key={r.name} style={{ marginTop: 8 }}>
          <strong>{r.name}</strong>
          <pre>{r.log.join('\n')}</pre>
        </div>
      ))}
    </div>
  );

  return (
    <div className="twl-root">
      <h2>Task Worktree Launcher</h2>

      <div className="twl-tabs">
        <button
          className={`twl-tab${activeTab === 'newTask' ? ' active' : ''}`}
          onClick={() => setActiveTab('newTask')}
        >
          New Task
        </button>
        <button
          className={`twl-tab${activeTab === 'task' ? ' active' : ''}`}
          onClick={() => setActiveTab('task')}
        >
          Task
        </button>
        <button
          className={`twl-tab${activeTab === 'config' ? ' active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          Configuration
        </button>
      </div>

      {activeTab === 'config' && <ConfigurationTab host={host} />}

      {activeTab === 'task' && (
      <>
      {loadError && <div className="twl-error">Failed to list repos: {loadError}</div>}

      <fieldset className="twl-fieldset">
        <legend>Fetch tasks from configured source</legend>
        <button className="twl-button" onClick={handleFetchTasks} disabled={fetchLoading}>
          {fetchLoading ? 'Fetching…' : 'Fetch tasks'}
        </button>
        {fetchError && <div className="twl-error">{fetchError}</div>}
        {fetchedTasks.length > 0 && (
          <ul className="twl-task-list">
            {fetchedTasks.map((task) => (
              <li key={task.id}>
                <span>{task.title}</span>
                <button className="twl-button" onClick={() => runFetchedTask(task)} disabled={isRunning}>Run</button>
              </li>
            ))}
          </ul>
        )}
        <small className="twl-muted" style={{ display: 'block', marginTop: 8 }}>
          "Run" uses the repos/env/symlink/port/script settings from the New Task tab.
        </small>
      </fieldset>

      {logBlock}
      </>
      )}

      {activeTab === 'newTask' && (
      <>
      {loadError && <div className="twl-error">Failed to list repos: {loadError}</div>}

      <label className="twl-field">
        <span className="twl-field-label">Task name</span>
        <input
          className="twl-input"
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="e.g. add-invoice-export"
        />
      </label>
      {taskName && <small className="twl-muted">Branch / folder slug: {slugify(taskName)}</small>}

      <label className="twl-field">
        <span className="twl-field-label">Worktree location (base folder)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="twl-input"
            type="text"
            value={worktreeBase}
            onChange={(e) => setWorktreeBase(e.target.value)}
            disabled={isRunning}
            style={{ flex: 1 }}
          />
          <button className="twl-button" onClick={handleBrowseWorktreeBase} disabled={isRunning} type="button">
            Browse…
          </button>
        </div>
        {browseError && <small className="twl-error" style={{ display: 'block' }}>{browseError}</small>}
        <small className="twl-muted">
          Worktrees will be saved at: {worktreeBase || '(set a folder above)'}/{taskName ? slugify(taskName) : '<task-slug>'}/&lt;repo-name&gt;
        </small>
      </label>

      <label className="twl-field">
        <span className="twl-field-label">Coding agent</span>
        <select
          className="twl-select"
          value={agentProvider}
          onChange={(e) => setAgentProvider(e.target.value as AgentProvider)}
          disabled={isRunning}
        >
          {AGENT_PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <small className="twl-muted">Which agent runs the started session — uses the app-wide default model for that provider.</small>
      </label>

      <div className="twl-field">
        <span className="twl-field-label">Description</span>
        <MarkdownTextarea value={description} onChange={setDescription} rows={4} placeholder="Describe the task (supports markdown)" />
      </div>

      <fieldset className="twl-fieldset">
        <legend>Repos</legend>
        {repos.length === 0 && !loadError && <p className="twl-muted">Detecting sibling repos…</p>}
        {repos.map((r) => (
          <div key={r.name} className="twl-repo-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <input type="checkbox" checked={r.selected} onChange={() => toggleRepo(r.name)} disabled={isRunning} />
              <span>{r.name}{r.state !== 'idle' && ` — ${r.state}`}</span>
            </label>
            <div style={{ width: 200 }}>
              <BranchCombobox
                value={r.baseBranch}
                options={r.availableBranches}
                onChange={(branch) => setBaseBranch(r.name, branch)}
                disabled={isRunning}
              />
            </div>
          </div>
        ))}
        <small className="twl-muted" style={{ display: 'block', marginTop: 4 }}>
          Each worktree's new branch is created off the base branch shown — defaults to that repo's current branch, editable per repo.
        </small>
      </fieldset>

      <label className="twl-field">
        <span className="twl-field-label">Ignored files to copy (one path per line, relative to each repo)</span>
        <textarea
          className="twl-textarea"
          value={envFilesText}
          onChange={(e) => setEnvFilesText(e.target.value)}
          rows={3}
        />
      </label>

      <label className="twl-checkbox-label">
        <input
          type="checkbox"
          checked={symlinksEnabled}
          onChange={(e) => setSymlinksEnabled(e.target.checked)}
        />
        Symlink shared folders instead of copying
      </label>
      {symlinksEnabled && (
        <label className="twl-field">
          <span className="twl-field-label">Folders to symlink (one path per line, relative to each repo)</span>
          <textarea
            className="twl-textarea"
            value={symlinkFoldersText}
            onChange={(e) => setSymlinkFoldersText(e.target.value)}
            rows={3}
          />
        </label>
      )}

      <label className="twl-field">
        <span className="twl-field-label">.env vars to assign a unique free port (comma or newline separated)</span>
        <input
          className="twl-input"
          type="text"
          value={portVarsText}
          onChange={(e) => setPortVarsText(e.target.value)}
          placeholder="API_PORT, WEB_PORT, DB_PORT"
        />
        <small className="twl-muted">Only rewrites vars that already exist in a copied .env file. COMPOSE_PROJECT_NAME is always set per-worktree.</small>
      </label>

      <label className="twl-field">
        <span className="twl-field-label">Post-create script (run in each new worktree)</span>
        <input
          className="twl-input"
          type="text"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="npm install"
        />
      </label>

      <button
        className="twl-button twl-button-primary"
        onClick={() => handleCreate()}
        disabled={!canRun}
        style={{ marginTop: 16 }}
      >
        {isRunning ? 'Creating…' : 'Create worktrees & start session'}
      </button>

      {logBlock}
      </>
      )}
    </div>
  );
}
