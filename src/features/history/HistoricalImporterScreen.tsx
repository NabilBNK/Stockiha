import { useState, useEffect, useCallback } from 'react';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import type { ImportBatchDto, StagedRecordDto, ReplayResultDto } from '../../shared/ipc/dto';

export function HistoricalImporterScreen() {
  const { user } = useSession();
  const token = user?.token ?? '';

  const [batches, setBatches] = useState<ImportBatchDto[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [stagedRecords, setStagedRecords] = useState<StagedRecordDto[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<StagedRecordDto | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResultDto | null>(null);

  const [fileName, setFileName] = useState('');
  const [totalRowsInput, setTotalRowsInput] = useState('50');
  const [correctedJsonText, setCorrectedJsonText] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    if (!token) return;
    try {
      const list = await ipc.listImportBatches(token);
      setBatches(list);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load import batches.');
    }
  }, [token]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const loadStagedRecords = async (batchId: string) => {
    if (!token) return;
    setSelectedBatchId(batchId);
    setReplayResult(null);
    try {
      const records = await ipc.getStagedRecords(token, batchId);
      setStagedRecords(records);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load staged records.');
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !fileName.trim()) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await ipc.createImportBatch(token, {
        file_name: fileName.trim(),
        total_rows: parseInt(totalRowsInput, 10) || 1,
      });
      setSuccessMsg(`Import batch created for file "${fileName.trim()}"!`);
      setFileName('');
      await loadBatches();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to create import batch.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCorrection = async () => {
    if (!token || !selectedRecord) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const parsed = JSON.parse(correctedJsonText);
      await ipc.updateStagedRecord(token, {
        record_id: selectedRecord.id,
        corrected_json: parsed,
      });
      setSuccessMsg(`Record row #${selectedRecord.row_number} updated & validated!`);
      setSelectedRecord(null);
      if (selectedBatchId) await loadStagedRecords(selectedBatchId);
      await loadBatches();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Invalid JSON input or update failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleReplayBatch = async (batchId: string) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await ipc.replayHistoricalBatch(token, batchId);
      setReplayResult(res);
      setSuccessMsg('Sandbox chronological replay completed successfully!');
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to execute sandbox replay.');
    } finally {
      setBusy(false);
    }
  };

  const handleCommitBatch = async (batchId: string) => {
    if (!token) return;
    if (!window.confirm('Are you sure you want to commit and permanently LOCK this historical batch? This action is irreversible.')) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await ipc.commitHistoricalBatch(token, batchId);
      setSuccessMsg(`Batch locked successfully! ${res.message}`);
      await loadBatches();
      if (selectedBatchId === batchId) await loadStagedRecords(batchId);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to commit historical batch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sk-page" style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem' }}>Historical Importer & Sandbox Reconstruction</h1>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            Upload past store records, validate data in sandbox, resolve discrepancies, and commit to ledgers.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ backgroundColor: '#064e3b', color: '#a7f3d0', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {successMsg}
        </div>
      )}

      {/* Import Form */}
      <form
        onSubmit={handleCreateBatch}
        style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '24px' }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>📥 Stage New Historical Batch</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2', minWidth: '240px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '6px' }}>File Name / Document Reference</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="e.g. 2025_inventory_opening.csv or past_sales.xlsx"
              required
              style={{ width: '100%', padding: '10px', backgroundColor: '#0f172a', border: '1px solid #475569', color: '#fff', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: '1', minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '6px' }}>Total Rows</label>
            <input
              type="number"
              value={totalRowsInput}
              onChange={(e) => setTotalRowsInput(e.target.value)}
              min="1"
              required
              style={{ width: '100%', padding: '10px', backgroundColor: '#0f172a', border: '1px solid #475569', color: '#fff', borderRadius: '6px' }}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
          >
            {busy ? 'Staging...' : 'Upload & Stage Batch'}
          </button>
        </div>
      </form>

      {/* Batches Table */}
      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', fontWeight: 600 }}>
          📦 Import Batch Lifecycle History
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '12px 16px' }}>Batch Number</th>
              <th style={{ padding: '12px 16px' }}>File Name</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px' }}>Rows (Total / Valid / Error)</th>
              <th style={{ padding: '12px 16px' }}>Created By</th>
              <th style={{ padding: '12px 16px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                  No historical import batches found.
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{b.batch_number}</td>
                  <td style={{ padding: '12px 16px' }}>{b.file_name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      backgroundColor: b.status === 'LOCKED' ? '#065f46' : b.status === 'NEEDS_REVIEW' ? '#9a3412' : '#1e40af',
                      color: b.status === 'LOCKED' ? '#a7f3d0' : b.status === 'NEEDS_REVIEW' ? '#ffedd5' : '#bfdbfe'
                    }}>
                      {b.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {b.total_rows} / <span style={{ color: '#4ade80' }}>{b.valid_rows}</span> / <span style={{ color: '#f87171' }}>{b.error_rows}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{b.created_by}</td>
                  <td style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => loadStagedRecords(b.id)}
                      style={{ padding: '6px 12px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      View Records
                    </button>
                    <button
                      onClick={() => handleReplayBatch(b.id)}
                      disabled={busy}
                      style={{ padding: '6px 12px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Replay Sandbox
                    </button>
                    {b.status !== 'LOCKED' && (
                      <button
                        onClick={() => handleCommitBatch(b.id)}
                        disabled={busy}
                        style={{ padding: '6px 12px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        🔒 Commit & Lock
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Replay Result Banner */}
      {replayResult && (
        <div style={{ backgroundColor: '#0284c7', color: '#fff', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '1.05rem' }}>⚡ Sandbox Chronological Replay Result</h4>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            Reconstruction Status: <strong>{replayResult.reconstruction_status}</strong> | Records Validated: {replayResult.valid_records}/{replayResult.total_records} | Discrepancies: {replayResult.discrepancies_found}
          </p>
        </div>
      )}

      {/* Staged Records Grid */}
      {selectedBatchId && (
        <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', fontWeight: 600 }}>
            🔍 Staged Records Inspection (Batch ID: {selectedBatchId})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '12px 16px' }}>Row #</th>
                <th style={{ padding: '12px 16px' }}>Entity Type</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Data Content</th>
                <th style={{ padding: '12px 16px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {stagedRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                    No staged records found for this batch.
                  </td>
                </tr>
              ) : (
                stagedRecords.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>#{r.row_number}</td>
                    <td style={{ padding: '12px 16px' }}>{r.entity_type}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        backgroundColor: r.status === 'ERROR' ? '#7f1d1d' : '#064e3b',
                        color: r.status === 'ERROR' ? '#fecaca' : '#a7f3d0'
                      }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.8rem', color: '#cbd5e1' }}>
                      {JSON.stringify(r.corrected_json || r.raw_json)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => {
                          setSelectedRecord(r);
                          setCorrectedJsonText(JSON.stringify(r.corrected_json || r.raw_json, null, 2));
                        }}
                        style={{ padding: '4px 10px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        ✏️ Fix Discrepancy
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Discrepancy Resolution Modal */}
      {selectedRecord && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '8px', border: '1px solid #475569', width: '100%', maxWidth: '500px' }}>
            <h3 style={{ margin: '0 0 16px 0' }}>✏️ Resolve Discrepancy — Row #{selectedRecord.row_number}</h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '12px' }}>
              Edit raw record fields to resolve validation errors before committing.
            </p>
            <textarea
              rows={8}
              value={correctedJsonText}
              onChange={(e) => setCorrectedJsonText(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', padding: '10px', backgroundColor: '#0f172a', border: '1px solid #475569', color: '#38bdf8', borderRadius: '6px', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setSelectedRecord(null)}
                style={{ padding: '8px 16px', backgroundColor: '#475569', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCorrection}
                disabled={busy}
                style={{ padding: '8px 16px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
              >
                Save & Validate
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
