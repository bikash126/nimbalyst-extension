import type { PanelHostProps } from '@nimbalyst/extension-sdk';

export type ProviderType = 'jira' | 'linear' | 'custom';

export interface ProviderConfig {
  providerType: ProviderType;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraJql: string;
  customBaseUrl: string;
  customPath: string;
  refreshUrl: string;
}

export interface FetchedTask {
  id: string;
  title: string;
  description: string;
}

interface HttpResult {
  status: number;
  body: string;
}

const SECRET_BEARER_TOKEN = 'bearerToken';
const SECRET_REFRESH_TOKEN = 'refreshToken';

export async function getCredentials(host: PanelHostProps['host']) {
  const bearerToken = await host.storage.getSecret(SECRET_BEARER_TOKEN);
  const refreshToken = await host.storage.getSecret(SECRET_REFRESH_TOKEN);
  return { bearerToken: bearerToken ?? '', refreshToken: refreshToken ?? '' };
}

export async function setCredentials(host: PanelHostProps['host'], bearerToken: string, refreshToken: string) {
  if (bearerToken) await host.storage.setSecret(SECRET_BEARER_TOKEN, bearerToken);
  else await host.storage.deleteSecret(SECRET_BEARER_TOKEN);

  if (refreshToken) await host.storage.setSecret(SECRET_REFRESH_TOKEN, refreshToken);
  else await host.storage.deleteSecret(SECRET_REFRESH_TOKEN);
}

let requestBodyCounter = 0;

async function curlJson(
  host: PanelHostProps['host'],
  url: string,
  options: { method?: string; authHeader?: string; body?: string },
): Promise<HttpResult> {
  const method = options.method ?? 'GET';
  const parts = [`curl -s -w '\\n%{http_code}' -X ${method}`, `-H "Content-Type: application/json"`];
  if (options.authHeader) parts.push(`-H "Authorization: ${options.authHeader}"`);

  let bodyFileAbsPath: string | undefined;
  if (options.body) {
    const relPath = `request-body-${Date.now()}-${requestBodyCounter++}.json`;
    await host.files.write(relPath, options.body);
    bodyFileAbsPath = `${await host.files.getBasePath()}/${relPath}`;
    parts.push(`-d @"${bodyFileAbsPath}"`);
  }
  parts.push(`"${url}"`);
  const result = await host.exec(parts.join(' '), { timeout: 30000 });
  if (bodyFileAbsPath) {
    const relPath = bodyFileAbsPath.split('/').pop() as string;
    await host.files.delete(relPath).catch(() => undefined);
  }
  const output = result.stdout;
  const lastNewline = output.lastIndexOf('\n');
  const status = lastNewline === -1 ? 0 : parseInt(output.slice(lastNewline + 1).trim(), 10);
  const body = lastNewline === -1 ? output : output.slice(0, lastNewline);
  return { status: Number.isNaN(status) ? 0 : status, body };
}

async function tryRefresh(host: PanelHostProps['host'], config: ProviderConfig): Promise<string | null> {
  const { refreshToken } = await getCredentials(host);
  if (!refreshToken || !config.refreshUrl) return null;

  const result = await curlJson(host, config.refreshUrl, {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (result.status < 200 || result.status >= 300) return null;

  try {
    const parsed = JSON.parse(result.body);
    const newAccessToken: string | undefined = parsed.access_token;
    const newRefreshToken: string | undefined = parsed.refresh_token;
    if (!newAccessToken) return null;
    await setCredentials(host, newAccessToken, newRefreshToken ?? refreshToken);
    return newAccessToken;
  } catch {
    return null;
  }
}

async function authedRequest(
  host: PanelHostProps['host'],
  config: ProviderConfig,
  url: string,
  authHeader: string,
  options: { method?: string; body?: string } = {},
): Promise<HttpResult> {
  let result = await curlJson(host, url, { ...options, authHeader });
  if (result.status === 401) {
    const refreshed = await tryRefresh(host, config);
    if (refreshed) {
      const newAuthHeader = authHeader.startsWith('Bearer ') ? `Bearer ${refreshed}` : refreshed;
      result = await curlJson(host, url, { ...options, authHeader: newAuthHeader });
    }
  }
  return result;
}

function extractJiraPlainText(description: unknown): string {
  if (!description || typeof description !== 'object') return '';
  const doc = description as { content?: unknown[] };
  if (!Array.isArray(doc.content)) return '';
  const lines: string[] = [];
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text' && n.text) lines.push(n.text);
      if (Array.isArray(n.content)) walk(n.content);
    }
  };
  walk(doc.content);
  return lines.join(' ');
}

async function fetchJiraTasks(host: PanelHostProps['host'], config: ProviderConfig): Promise<FetchedTask[]> {
  const { bearerToken: apiToken } = await getCredentials(host);
  if (!apiToken) throw new Error('No API token configured for Jira');
  if (!config.jiraEmail) throw new Error('No email configured for Jira');
  if (!config.jiraBaseUrl) throw new Error('Jira base URL is not configured');

  const jql = encodeURIComponent(config.jiraJql || 'assignee = currentUser() AND resolution = Unresolved');
  const url = `${config.jiraBaseUrl.replace(/\/$/, '')}/rest/api/3/search?jql=${jql}&fields=summary,description&maxResults=50`;
  // Jira Cloud uses HTTP Basic auth with email:API-token — not a bearer/OAuth token.
  const authHeader = `Basic ${btoa(`${config.jiraEmail}:${apiToken}`)}`;
  const result = await curlJson(host, url, { authHeader });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Jira API returned ${result.status}: ${result.body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(result.body);
  const issues: unknown[] = Array.isArray(parsed.issues) ? parsed.issues : [];
  return issues.map((issue) => {
    const i = issue as { key: string; fields?: { summary?: string; description?: unknown } };
    return {
      id: i.key,
      title: `${i.key}: ${i.fields?.summary ?? ''}`,
      description: extractJiraPlainText(i.fields?.description),
    };
  });
}

async function fetchLinearTasks(host: PanelHostProps['host'], config: ProviderConfig): Promise<FetchedTask[]> {
  const { bearerToken } = await getCredentials(host);
  if (!bearerToken) throw new Error('No token configured for Linear');

  const query = `query { viewer { assignedIssues(filter: { state: { type: { neq: "completed" } } }, first: 50) { nodes { id identifier title description } } } }`;
  const result = await authedRequest(host, config, 'https://api.linear.app/graphql', bearerToken, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Linear API returned ${result.status}: ${result.body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(result.body);
  if (parsed.errors) throw new Error(`Linear API error: ${JSON.stringify(parsed.errors).slice(0, 300)}`);
  const nodes: unknown[] = parsed.data?.viewer?.assignedIssues?.nodes ?? [];
  return nodes.map((issue) => {
    const i = issue as { id: string; identifier: string; title: string; description?: string };
    return { id: i.id, title: `${i.identifier}: ${i.title}`, description: i.description ?? '' };
  });
}

async function fetchCustomTasks(host: PanelHostProps['host'], config: ProviderConfig): Promise<FetchedTask[]> {
  const { bearerToken } = await getCredentials(host);
  if (!config.customBaseUrl) throw new Error('Custom API base URL is not configured');

  const url = `${config.customBaseUrl.replace(/\/$/, '')}${config.customPath || ''}`;
  const authHeader = bearerToken ? `Bearer ${bearerToken}` : '';
  const result = authHeader
    ? await authedRequest(host, config, url, authHeader)
    : await curlJson(host, url, {});
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Custom API returned ${result.status}: ${result.body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(result.body);
  const items: unknown[] = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.tasks ?? []);
  return items.map((item, index) => {
    const i = item as Record<string, unknown>;
    const id = String(i.id ?? i.key ?? index);
    const title = String(i.title ?? i.name ?? i.summary ?? id);
    const description = String(i.description ?? i.body ?? '');
    return { id, title, description };
  });
}

export async function fetchTasks(host: PanelHostProps['host'], config: ProviderConfig): Promise<FetchedTask[]> {
  switch (config.providerType) {
    case 'jira':
      return fetchJiraTasks(host, config);
    case 'linear':
      return fetchLinearTasks(host, config);
    case 'custom':
      return fetchCustomTasks(host, config);
    default:
      throw new Error(`Unknown provider: ${config.providerType}`);
  }
}
