import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import type { ProviderConfig, ProviderType } from './providers';
import { getCredentials, setCredentials } from './providers';

const STORAGE_KEY_PROVIDER_TYPE = 'providerType';
const STORAGE_KEY_JIRA_BASE_URL = 'jiraBaseUrl';
const STORAGE_KEY_JIRA_EMAIL = 'jiraEmail';
const STORAGE_KEY_JIRA_JQL = 'jiraJql';
const STORAGE_KEY_CUSTOM_BASE_URL = 'customBaseUrl';
const STORAGE_KEY_CUSTOM_PATH = 'customPath';
const STORAGE_KEY_REFRESH_URL = 'refreshUrl';

export async function loadProviderConfig(host: PanelHostProps['host']): Promise<ProviderConfig> {
  return {
    providerType: (host.storage.get<ProviderType>(STORAGE_KEY_PROVIDER_TYPE) ?? 'jira'),
    jiraBaseUrl: host.storage.get<string>(STORAGE_KEY_JIRA_BASE_URL) ?? '',
    jiraEmail: host.storage.get<string>(STORAGE_KEY_JIRA_EMAIL) ?? '',
    jiraJql: host.storage.get<string>(STORAGE_KEY_JIRA_JQL) ?? '',
    customBaseUrl: host.storage.get<string>(STORAGE_KEY_CUSTOM_BASE_URL) ?? '',
    customPath: host.storage.get<string>(STORAGE_KEY_CUSTOM_PATH) ?? '',
    refreshUrl: host.storage.get<string>(STORAGE_KEY_REFRESH_URL) ?? '',
  };
}

export function ConfigurationTab({ host }: PanelHostProps) {
  const [providerType, setProviderType] = useState<ProviderType>('jira');
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraJql, setJiraJql] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [refreshUrl, setRefreshUrl] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const config = await loadProviderConfig(host);
      setProviderType(config.providerType);
      setJiraBaseUrl(config.jiraBaseUrl);
      setJiraEmail(config.jiraEmail);
      setJiraJql(config.jiraJql);
      setCustomBaseUrl(config.customBaseUrl);
      setCustomPath(config.customPath);
      setRefreshUrl(config.refreshUrl);

      const creds = await getCredentials(host);
      setBearerToken(creds.bearerToken);
      setRefreshToken(creds.refreshToken);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    await host.storage.set(STORAGE_KEY_PROVIDER_TYPE, providerType);
    await host.storage.set(STORAGE_KEY_JIRA_BASE_URL, jiraBaseUrl);
    await host.storage.set(STORAGE_KEY_JIRA_EMAIL, jiraEmail);
    await host.storage.set(STORAGE_KEY_JIRA_JQL, jiraJql);
    await host.storage.set(STORAGE_KEY_CUSTOM_BASE_URL, customBaseUrl);
    await host.storage.set(STORAGE_KEY_CUSTOM_PATH, customPath);
    await host.storage.set(STORAGE_KEY_REFRESH_URL, refreshUrl);
    await setCredentials(host, bearerToken, refreshToken);
    setSaveStatus('Saved.');
    setTimeout(() => setSaveStatus(null), 2000);
  }

  return (
    <div>
      <h3>Task source configuration</h3>

      <label className="twl-field">
        <span className="twl-field-label">Provider</span>
        <select
          className="twl-select"
          value={providerType}
          onChange={(e) => setProviderType(e.target.value as ProviderType)}
        >
          <option value="jira">Jira</option>
          <option value="linear">Linear</option>
          <option value="custom">Custom API</option>
        </select>
      </label>

      {providerType === 'jira' && (
        <>
          <label className="twl-field">
            <span className="twl-field-label">Jira base URL</span>
            <input
              className="twl-input"
              type="text"
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              placeholder="https://yourorg.atlassian.net"
            />
          </label>
          <label className="twl-field">
            <span className="twl-field-label">Email</span>
            <input
              className="twl-input"
              type="text"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              placeholder="you@yourorg.com"
            />
          </label>
          <label className="twl-field">
            <span className="twl-field-label">JQL query</span>
            <input
              className="twl-input"
              type="text"
              value={jiraJql}
              onChange={(e) => setJiraJql(e.target.value)}
              placeholder="assignee = currentUser() AND resolution = Unresolved"
            />
          </label>
          <small className="twl-muted">Auth uses HTTP Basic (email + API token below) — Jira Cloud's standard scheme, not OAuth.</small>
        </>
      )}

      {providerType === 'linear' && (
        <small className="twl-muted" style={{ display: 'block', marginTop: 12 }}>
          Fetches your active assigned issues from Linear's GraphQL API. The API key below is sent as-is in the
          `Authorization` header (Linear's convention — no "Bearer " prefix).
        </small>
      )}

      {providerType === 'custom' && (
        <>
          <label className="twl-field">
            <span className="twl-field-label">Base URL</span>
            <input
              className="twl-input"
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
            />
          </label>
          <label className="twl-field">
            <span className="twl-field-label">Path</span>
            <input
              className="twl-input"
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="/v1/tasks"
            />
          </label>
          <small className="twl-muted">Expects a JSON array (or {'{ items: [...] }'}) of objects with id/title/description fields.</small>
        </>
      )}

      <fieldset className="twl-fieldset">
        <legend>Credentials (stored in the system keychain)</legend>
        <label className="twl-field" style={{ marginTop: 0 }}>
          <span className="twl-field-label">
            {providerType === 'jira' ? 'API token' : providerType === 'linear' ? 'API key' : 'Bearer / access token'}
          </span>
          <input
            className="twl-input"
            type="password"
            value={bearerToken}
            onChange={(e) => setBearerToken(e.target.value)}
          />
        </label>

        {providerType === 'custom' && (
          <>
            <label className="twl-field">
              <span className="twl-field-label">Refresh token (optional)</span>
              <input
                className="twl-input"
                type="password"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
              />
            </label>
            <label className="twl-field">
              <span className="twl-field-label">Refresh URL (required if using a refresh token)</span>
              <input
                className="twl-input"
                type="text"
                value={refreshUrl}
                onChange={(e) => setRefreshUrl(e.target.value)}
                placeholder="https://api.example.com/oauth/refresh"
              />
            </label>
            <small className="twl-muted">
              On a 401, the extension POSTs {'{ refresh_token }'} to this URL, expects {'{ access_token, refresh_token? }'} back,
              and retries the request once. Jira (API token) and Linear (API key) don't use this — their credentials don't expire this way.
            </small>
          </>
        )}
      </fieldset>

      <button className="twl-button twl-button-primary" onClick={handleSave} style={{ marginTop: 16 }}>
        Save configuration
      </button>
      {saveStatus && <span className="twl-muted" style={{ marginLeft: 8 }}>{saveStatus}</span>}
    </div>
  );
}
