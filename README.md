# Task Worktree Launcher

A Nimbalyst extension for multi-repo workspaces. Given a task name and
description, it creates a git worktree for that task in every sibling repo
under the parent workspace folder, optionally copies gitignored files
(`.env`, etc.) and symlinks shared folders (`node_modules`, etc.) into each
worktree, runs a post-create setup script per worktree, and then starts a
single agent session whose working directory is the task's worktree root
(the folder containing all of the repo worktrees as subfolders).

The panel has two tabs:

- **Task** — fetch a task list from a configured source (Jira/Linear/custom
  API) and click "Run" on one to launch it, or fill in a task name/description
  manually.
- **Configuration** — pick a provider (Jira, Linear, or a custom API) and
  store its bearer/refresh token. Tokens are stored via the extension's secret
  storage (system keychain), not in plain settings.

## Usage

1. Open the "Task Worktrees" panel.
2. On the **Configuration** tab, pick a provider and save its base URL/JQL
   (Jira) or path (custom API) plus a bearer token. Add a refresh token +
   refresh URL only if the API needs token refresh on 401s.
3. On the **Task** tab, click "Fetch tasks" to list open/assigned items from
   that provider, then click "Run" on one — its title/description populate
   the worktree flow below automatically. Or skip fetching and fill in a task
   name/description manually.
4. Select which sibling repos to include (auto-detected).
5. Optionally list ignored files to copy and/or folders to symlink.
6. Optionally list `.env` variable names that should get a unique free port
   per worktree — useful for docker compose setups where the same repo's
   containers run in multiple worktrees at once. Only variables already
   present in a copied `.env` are rewritten. In this workspace, the compose
   files read the *repo-root* `.env` (not `apps/api/.env`), so include `.env`
   in "ignored files to copy" and use these var names:
   - `ebplanner-api`: `API_HOST_PORT, CRON_HOST_PORT, FRONTEND_HOST_PORT, MYSQL_HOST_PORT, REDIS_HOST_PORT, LOCALSTACK_HOST_PORT, SQS_ADMIN_HOST_PORT, MYSQL_EXPORTER_HOST_PORT, MAILPIT_SMTP_HOST_PORT, MAILPIT_UI_HOST_PORT`
   - `ebplanner-frontend`: `FRONTEND_STANDALONE_HOST_PORT`
7. Optionally set a post-create script (e.g. `npm install`).
8. Click "Create worktrees & start session" (or "Run" on a fetched task).

Worktrees are created at `<workspace-root>/.worktrees/<task-slug>/<repo-name>`
on a new branch named after the task slug. `COMPOSE_PROJECT_NAME` is always
set to `<task-slug>-<repo-name>` in every copied `.env` file, so `docker
compose` containers/networks/volumes from different worktrees of the same
repo don't collide even without listing extra port vars.

## Docker compose requirements (this workspace)

For port/project isolation to actually take effect, `ebplanner-api/docker-compose-dev.yml`
and `ebplanner-frontend/docker-compose.yml` were updated to read their ports and
project name from `${VAR}` substitution (defaults match the original hardcoded
values, so normal non-worktree usage is unaffected) and no longer hardcode
`container_name` per service or pin to a fixed external network — see each
repo's compose file. Repos without this parameterization won't actually get
port isolation even if you list port vars in the panel, since nothing in
their compose YAML would reference the rewritten `.env` values.

## Known limitations

- The extension SDK's session-creation API (`sendPrompt`) has no working
  directory parameter, so the spawned session is started with an explicit
  "cd to `<task-worktree-root>` first" instruction embedded in the prompt
  rather than a real process-level cwd binding.
- Task fetching goes through `host.exec` + `curl` rather than browser `fetch`,
  to sidestep any renderer network-permission/CSP uncertainty — this means
  auth headers and request bodies are passed via shell arguments/temp files,
  not a real HTTP client library. Assumptions baked in per provider:
  - **Jira**: Cloud REST API v3, `Authorization: Bearer <token>` (an OAuth
    bearer token — not the email + API-token Basic-auth scheme some Jira
    setups use instead).
  - **Linear**: GraphQL API, token sent as a raw `Authorization` header (no
    `Bearer ` prefix, per Linear's convention), fetches the viewer's active
    assigned issues only (no per-team/project filtering yet).
  - **Custom API**: `GET <baseURL><path>` with `Authorization: Bearer <token>`
    (or no auth header if no token is set), expects a JSON array (or
    `{ items: [...] }`/`{ tasks: [...] }`) with `id`/`title`/`description`-ish
    fields.
  - **Refresh token**: only attempted on a 401, and only if both a refresh
    token and refresh URL are configured; POSTs `{ refresh_token }`, expects
    `{ access_token, refresh_token? }` back, retries once.
