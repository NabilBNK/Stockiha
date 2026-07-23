/**
 * Slice 1 — documents / printing status. Shows the latest posted document's
 * receipt and its generation/print/drawer job states (via {@link ReceiptView},
 * which polls modestly). The latest document id comes from the backend
 * dashboard summary, so this reflects real posted data after a restart.
 */
import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import { ReceiptView } from './ReceiptView';

export function DocumentsScreen() {
  const { t } = useI18n();
  const { user, workstationId } = useSession();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [latestId, setLatestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const summary = await ipc.getDashboardSummary(token, workstationId);
      setLatestId(summary.latest_document_id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, workstationId, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="sk-page">
      <div className="sk-toolbar">
        <h1>{t('jobs.title')}</h1>
        <Button variant="secondary" onClick={() => void load()}>
          {t('jobs.refresh')}
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : latestId == null ? (
        <Banner tone="info">{t('common.none')}</Banner>
      ) : (
        <ReceiptView documentId={latestId} />
      )}
    </section>
  );
}
