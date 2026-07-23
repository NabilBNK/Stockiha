/**
 * Slice 1 — cash session open / active view / close. Expected cash and
 * variance are computed and returned by the BACKEND; the UI only displays
 * them (never recomputes). The closed-session summary is read back from the
 * backend after closing.
 */
import { useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { CashSessionDetail } from '../../shared/ipc/dto';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export function CashSessionScreen() {
  const { t } = useI18n();
  const { user, activeCashSession, refreshActiveCashSession, workstationId } = useSession();
  const { selectedWarehouseId } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [openingFloat, setOpeningFloat] = useState('0');
  const [countedAmount, setCountedAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedSummary, setClosedSummary] = useState<CashSessionDetail | null>(null);

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

  async function onClose(event: FormEvent) {
    event.preventDefault();
    if (busy || !token || !activeCashSession || !AMOUNT_RE.test(countedAmount)) return;
    setBusy(true);
    setError(null);
    try {
      const id = await ipc.closeCashSession(token, activeCashSession.id, countedAmount);
      const detail = await ipc.getCashSession(token, id);
      setClosedSummary(detail);
      setCountedAmount('');
      await refreshActiveCashSession();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sk-page">
      <h1>{t('session.title')}</h1>
      {error ? <Banner tone="error" testId="session-error">{error}</Banner> : null}

      {activeCashSession ? (
        <form className="sk-card sk-form" onSubmit={onClose} aria-label={t('session.close')}>
          <Banner tone="success">{t('session.active', { id: activeCashSession.id })}</Banner>
          <p>{t('session.openingFloat')}: {activeCashSession.opening_float}</p>
          <TextField
            label={t('session.counted')}
            value={countedAmount}
            inputMode="decimal"
            onChange={(e) => setCountedAmount(e.target.value)}
            error={countedAmount !== '' && !AMOUNT_RE.test(countedAmount) ? t('errors.validation') : undefined}
            required
          />
          <Button type="submit" variant="danger" loading={busy} disabled={!AMOUNT_RE.test(countedAmount)}>
            {t('session.close')}
          </Button>
        </form>
      ) : (
        <form className="sk-card sk-form" onSubmit={onOpen} aria-label={t('session.open')}>
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

      {closedSummary ? (
        <div className="sk-card" data-testid="closed-summary">
          <h2>{t('session.closedSummary')}</h2>
          <p>{t('session.openingFloat')}: {closedSummary.opening_float}</p>
          <p>{t('session.expected')}: {closedSummary.expected_amount ?? '—'}</p>
          <p>{t('session.counted')}: {closedSummary.counted_amount ?? '—'}</p>
          <p><strong>{t('session.variance')}: {closedSummary.variance_amount ?? '—'}</strong></p>
        </div>
      ) : null}
    </section>
  );
}
