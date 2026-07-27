import { useState, useEffect, useCallback } from 'react';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import type { PrintJobDto } from '../../shared/ipc/dto';

export function PrintQueueScreen() {
  const { user } = useSession();
  const token = user?.token ?? '';

  const [jobs, setJobs] = useState<PrintJobDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    if (!token) return;
    try {
      const list = await ipc.listPrintJobs(token);
      setJobs(list);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load print jobs.');
    }
  }, [token]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleTriggerReprint = async (job: PrintJobDto) => {
    if (!token || !job.document_id) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await ipc.enqueuePrintJob(token, {
        document_id: job.document_id,
        job_type: job.job_type as 'THERMAL_RECEIPT' | 'PDF_INVOICE' | 'DRAWER_PULSE',
        format: job.format as 'ESC_POS_80MM' | 'PDF_A4' | 'PDF_A5',
        printer_name: job.printer_name,
      });
      setSuccessMsg(`Reprint job queued for document ${job.document_number || job.document_id}!`);
      await loadJobs();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to trigger reprint.');
    } finally {
      setBusy(false);
    }
  };

  const handlePulseDrawer = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await ipc.enqueuePrintJob(token, {
        document_id: 1, // System default
        job_type: 'DRAWER_PULSE',
        format: 'ESC_POS_80MM',
      });
      setSuccessMsg('Cash drawer pulse command dispatched!');
      await loadJobs();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to pulse cash drawer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sk-page" style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem' }}>Document Print Queue & History</h1>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            Monitor print jobs, trigger reprints, and pop the register cash drawer.
          </p>
        </div>
        <button
          onClick={handlePulseDrawer}
          disabled={busy}
          style={{ padding: '10px 18px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          ⚡ Pop Cash Drawer
        </button>
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

      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: '0.85rem' }}>
              <th style={{ padding: '12px 16px' }}>Job ID</th>
              <th style={{ padding: '12px 16px' }}>Document #</th>
              <th style={{ padding: '12px 16px' }}>Type</th>
              <th style={{ padding: '12px 16px' }}>Format</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px' }}>Queued At</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No print jobs in queue yet.
                </td>
              </tr>
            ) : (
              jobs.map((j) => (
                <tr key={j.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#94a3b8' }}>#{j.id}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#38bdf8' }}>{j.document_number || 'N/A'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ backgroundColor: j.job_type === 'DRAWER_PULSE' ? '#78350f' : '#1e3a8a', color: j.job_type === 'DRAWER_PULSE' ? '#fef08a' : '#bfdbfe', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                      {j.job_type}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{j.format}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      backgroundColor: j.status === 'COMPLETED' ? '#064e3b' : j.status === 'FAILED' ? '#7f1d1d' : '#713f12',
                      color: j.status === 'COMPLETED' ? '#a7f3d0' : j.status === 'FAILED' ? '#fecaca' : '#fef08a',
                      padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600
                    }}>
                      {j.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>{j.created_at}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {j.document_id && (
                      <button
                        onClick={() => handleTriggerReprint(j)}
                        disabled={busy}
                        style={{ padding: '4px 10px', backgroundColor: '#334155', color: '#f8fafc', border: '1px solid #475569', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        🖨️ Reprint
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
