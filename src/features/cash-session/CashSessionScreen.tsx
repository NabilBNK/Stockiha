import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { CashSessionDetail, PendingVarianceSessionDto } from '../../shared/ipc/dto';
import { DenominationCountModal } from '../sales/DenominationCountModal';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export function CashSessionScreen() {
  const { t } = useI18n();
  const { user, activeCashSession, refreshActiveCashSession, workstationId } = useSession();
  const { selectedWarehouseId } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [openingFloat, setOpeningFloat] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedSummary, setClosedSummary] = useState<CashSessionDetail | null>(null);
  const [showDenomModal, setShowDenomModal] = useState(false);
  const [pendingVariances, setPendingVariances] = useState<PendingVarianceSessionDto[]>([]);
  const [managerNotes, setManagerNotes] = useState<{ [id: number]: string }>({});

  const loadPendingVariances = useCallback(async () => {
    if (!token) return;
    try {
      const res = await ipc.listPendingVarianceSessions(token);
      setPendingVariances(res);
    } catch {
      // Non-manager roles will receive PERMISSION_DENIED; silently ignore
    }
  }, [token]);

  useEffect(() => {
    loadPendingVariances();
  }, [loadPendingVariances]);

  async function onOpen(event: FormEvent) {
    event.preventDefault();
    if (busy || !token || selectedWarehouseId == null || !AMOUNT_RE.test(openingFloat)) return;
    setBusy(true);
    setError(null);
    setClosedSummary(null);
    try {
      await ipc.openCashSession(token, selectedWarehouseId, workstationId, openingFloat);
      await refreshActiveCashSession();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSuspend() {
    if (busy || !token || !activeCashSession) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.suspendCashSession(token, activeCashSession.id);
      await refreshActiveCashSession();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onResume() {
    if (busy || !token || !activeCashSession) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.resumeCashSession(token, activeCashSession.id);
      await refreshActiveCashSession();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmittedClosing() {
    if (!token || !activeCashSession) return;
    const detail = await ipc.getCashSession(token, activeCashSession.id);
    setClosedSummary(detail);
    await refreshActiveCashSession();
    loadPendingVariances();
  }

  async function handleApproveVariance(sessionId: number) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const note = managerNotes[sessionId] || '';
      await ipc.approveSessionVariance(token, sessionId, note);
      await loadPendingVariances();
      await refreshActiveCashSession();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sk-page" style={{ padding: '24px', color: '#f8fafc' }}>
      <h1>{t('session.title')}</h1>
      {error ? <Banner tone="error" testId="session-error">{error}</Banner> : null}

      {activeCashSession ? (
        <div className="sk-card sk-form" style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '20px' }}>
          <Banner tone={activeCashSession.status === 'SUSPENDED' ? 'warning' : 'success'}>
            {t('session.active', { id: activeCashSession.id })} (Status: {activeCashSession.status || 'OPEN'})
          </Banner>
          <p>{t('session.openingFloat')}: <strong>{activeCashSession.opening_float} DZD</strong></p>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            {activeCashSession.status === 'SUSPENDED' ? (
              <Button type="button" onClick={onResume} loading={busy}>
                Resume Session
              </Button>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={onSuspend} loading={busy}>
                  Suspend Session
                </Button>
                <Button type="button" variant="danger" onClick={() => setShowDenomModal(true)} loading={busy}>
                  Close Session (Count Denominations)
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <form className="sk-card sk-form" onSubmit={onOpen} aria-label={t('session.open')} style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '20px' }}>
          <Banner tone="info">{t('session.none')}</Banner>
          <TextField
            label={t('session.openingFloat')}
            value={openingFloat}
            inputMode="decimal"
            onChange={(e) => setOpeningFloat(e.target.value)}
            error={!AMOUNT_RE.test(openingFloat) ? t('errors.validation') : undefined}
            required
          />
          <Button type="submit" loading={busy} disabled={selectedWarehouseId == null || !AMOUNT_RE.test(openingFloat)}>
            {t('session.open')}
          </Button>
        </form>
      )}

      {showDenomModal && activeCashSession && (
        <DenominationCountModal
          cashSessionId={activeCashSession.id}
          sessionToken={token}
          onClose={() => setShowDenomModal(false)}
          onSubmitted={handleSubmittedClosing}
        />
      )}

      {closedSummary ? (
        <div className="sk-card" data-testid="closed-summary" style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '20px' }}>
          <h2>{t('session.closedSummary')}</h2>
          <p>Status: <strong style={{ color: closedSummary.status === 'PENDING_APPROVAL' ? '#fcd34d' : '#34d399' }}>{closedSummary.status}</strong></p>
          <p>{t('session.openingFloat')}: {closedSummary.opening_float} DZD</p>
          <p>{t('session.expected')}: {closedSummary.expected_amount ?? '—'} DZD</p>
          <p>{t('session.counted')}: {closedSummary.counted_amount ?? '—'} DZD</p>
          <p><strong>{t('session.variance')}: {closedSummary.variance_amount ?? '—'} DZD</strong></p>
        </div>
      ) : null}

      {pendingVariances.length > 0 && (
        <div style={{ marginTop: '24px', backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #78350f' }}>
          <h3 style={{ marginTop: 0, color: '#fcd34d' }}>⏳ Pending Manager Variance Approvals ({pendingVariances.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', backgroundColor: '#0f172a' }}>
                  <th style={{ padding: '10px' }}>Session ID</th>
                  <th style={{ padding: '10px' }}>Workstation</th>
                  <th style={{ padding: '10px' }}>Closed By</th>
                  <th style={{ padding: '10px' }}>Expected</th>
                  <th style={{ padding: '10px' }}>Counted</th>
                  <th style={{ padding: '10px' }}>Variance</th>
                  <th style={{ padding: '10px' }}>Manager Note</th>
                  <th style={{ padding: '10px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingVariances.map((pv) => (
                  <tr key={pv.id} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '10px', fontWeight: 600 }}>#{pv.id}</td>
                    <td style={{ padding: '10px' }}>{pv.workstation_id}</td>
                    <td style={{ padding: '10px' }}>{pv.closed_by_name || '—'}</td>
                    <td style={{ padding: '10px' }}>{pv.expected_amount} DZD</td>
                    <td style={{ padding: '10px' }}>{pv.counted_amount} DZD</td>
                    <td style={{ padding: '10px', fontWeight: 700, color: '#f87171' }}>{pv.variance_amount} DZD</td>
                    <td style={{ padding: '10px' }}>
                      <input
                        type="text"
                        placeholder="Optional note"
                        value={managerNotes[pv.id] || ''}
                        onChange={(e) => setManagerNotes({ ...managerNotes, [pv.id]: e.target.value })}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff', fontSize: '0.85rem' }}
                      />
                    </td>
                    <td style={{ padding: '10px' }}>
                      <button
                        onClick={() => handleApproveVariance(pv.id)}
                        disabled={busy}
                        style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#059669', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
                      >
                        Approve Closing
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
