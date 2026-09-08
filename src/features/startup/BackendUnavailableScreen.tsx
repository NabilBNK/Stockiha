/**
 * WS-K-1 — the startup/retry gate's "backend unavailable" screen.
 *
 * Extracted out of `AppRouter`'s `'unavailable'` branch now that it needs to
 * distinguish up to ten states (see `backendUnavailableCopy`) instead of a
 * single generic message. `AppRouter` remains the trigger (it decides *when*
 * to show this screen); this component only decides *what* to show.
 *
 * Never renders a stack trace, a connection string, or a SQLSTATE code in the
 * primary message. The collapsible technical-detail section shows the
 * backend's own `code`/`detail` verbatim — already guaranteed credential-free
 * by construction on the Rust side (`db::DbDiagnostic`'s `detail` is built
 * only from fixed sentences, the non-secret `ConnectionTarget`, and pool
 * counters) — never the password, connection string, or config file path.
 */
import { Button } from '../../shared/components';
import { useI18n, type MessageKey } from '../../shared/i18n';
import type { DbDiagnostic } from '../../shared/ipc/gateway';
import { resolveBackendUnavailableStateKey } from './backendUnavailableCopy';

export function BackendUnavailableScreen({
  diagnostic,
  onRetry,
}: {
  diagnostic: DbDiagnostic | null;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const stateKey = resolveBackendUnavailableStateKey(diagnostic);

  // 'generic' predates the per-state keys and keeps the original flat
  // names (`backend.unavailable.title`/`.body`) rather than
  // `backend.unavailable.generic.title` — every other state follows the
  // `backend.unavailable.<state>.title`/`.body` pattern.
  const titleKey = (
    stateKey === 'generic' ? 'backend.unavailable.title' : `backend.unavailable.${stateKey}.title`
  ) as MessageKey;
  const bodyKey = (
    stateKey === 'generic' ? 'backend.unavailable.body' : `backend.unavailable.${stateKey}.body`
  ) as MessageKey;

  return (
    <div className="sk-centered">
      <div className="sk-card" role="alert" data-testid="backend-unavailable">
        <h1>{t(titleKey)}</h1>
        <p>{t(bodyKey)}</p>
        {diagnostic ? (
          <details className="sk-muted" data-testid="backend-unavailable-details">
            <summary>{t('backend.unavailable.technicalDetails')}</summary>
            <p data-testid="backend-unavailable-reason">
              <code>{diagnostic.code}</code> — {diagnostic.detail}
            </p>
          </details>
        ) : null}
        <Button onClick={onRetry}>{t('common.retry')}</Button>
      </div>
    </div>
  );
}
