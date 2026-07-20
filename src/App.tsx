import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { resolveErrorMessage, parseTauriError } from './shared/utils/tauriError';
import './App.css';

interface AppInfo {
  name: string;
  version: string;
  stage: string;
  status: string;
}

/**
 * S0-003 — Safe database status display states. The technical screen shows
 * exactly one of the three terminal labels ("Not configured", "Connected",
 * "Unavailable"); it never displays a host, port, database name, server
 * version, URL, SQLx error, or any diagnostic.
 */
type DbStatus = 'checking' | 'not-configured' | 'connected' | 'unavailable';

const DB_STATUS_LABELS: Record<DbStatus, string> = {
  checking: 'Checking...',
  'not-configured': 'Not configured',
  connected: 'Connected',
  unavailable: 'Unavailable',
};

/**
 * Runtime validation of the resolved `check_db_health` payload. Only an object
 * whose `status` is exactly the string `"CONNECTED"` counts as connected; any
 * malformed or unexpected shape is treated as not connected. Reads only
 * `status`, defensively (a getter/trap may throw), and never surfaces contents.
 */
function isConnectedReport(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    return Reflect.get(value, 'status') === 'CONNECTED';
  } catch {
    return false;
  }
}

function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus>('checking');

  useEffect(() => {
    invoke<AppInfo>('get_app_info')
      .then(info => setAppInfo(info))
      .catch((err: unknown) => {
        // Defensive: never surface raw rejection contents. The parser reduces any
        // unknown value to a known code and resolves it to a safe, fixed message.
        setError(resolveErrorMessage(err));
      });
  }, []);

  useEffect(() => {
    invoke('check_db_health')
      .then((report: unknown) => {
        // Validate the resolved payload at runtime: only a well-formed
        // `{ status: "CONNECTED" }` is treated as connected. Any malformed or
        // unexpected payload is reported as unavailable, never connected.
        setDbStatus(isConnectedReport(report) ? 'connected' : 'unavailable');
      })
      .catch((err: unknown) => {
        // The rejection is reduced to an allowlisted code; only the code drives
        // the display. CONFIGURATION_ERROR means the development database URL
        // is missing or invalid; every other failure renders as unavailable.
        // No property of the rejection is ever rendered.
        setDbStatus(
          parseTauriError(err) === 'CONFIGURATION_ERROR'
            ? 'not-configured'
            : 'unavailable',
        );
      });
  }, []);

  return (
    <main className="container">
      <h1>Stockiha</h1>
      <h2>Slice 0 — Technical Foundation</h2>

      <div className="status-panel">
        <p data-testid="backend-status">
          <strong>Backend Connection Status:</strong>{' '}
          {appInfo ? 'Connected' : error ? 'Error' : 'Connecting...'}
        </p>

        {appInfo && (
          <>
            <p><strong>Application:</strong> {appInfo.name}</p>
            <p><strong>Version:</strong> {appInfo.version}</p>
            <p><strong>Stage:</strong> {appInfo.stage}</p>
            <p><strong>Status:</strong> {appInfo.status}</p>
          </>
        )}

        {error && (
          <p className="error"><strong>Error:</strong> {error}</p>
        )}

        <p data-testid="db-status">
          <strong>Database Status:</strong> {DB_STATUS_LABELS[dbStatus]}
        </p>
      </div>

      <p className="notice">
        Notice: Business modules (inventory, sales, accounting, etc.) are not implemented yet.
      </p>
    </main>
  );
}

export default App;
