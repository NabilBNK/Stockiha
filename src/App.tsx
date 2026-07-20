import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

interface AppInfo {
  name: string;
  version: string;
  stage: string;
  status: string;
}

function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AppInfo>('get_app_info')
      .then(info => setAppInfo(info))
      .catch(() => {
        setError('Unable to connect to the Stockiha backend.');
      });
  }, []);

  return (
    <main className="container">
      <h1>Stockiha</h1>
      <h2>Slice 0 — Technical Foundation</h2>

      <div className="status-panel">
        <p>
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
      </div>

      <p className="notice">
        Notice: Business modules (inventory, sales, accounting, etc.) are not implemented yet.
      </p>
    </main>
  );
}

export default App;
