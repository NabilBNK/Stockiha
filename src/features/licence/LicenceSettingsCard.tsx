/**
 * WS-K-7 — the licence card (plan §7.4). Rendered first in the Settings
 * view, `id="licence-card"` / `data-testid="licence-card"` so the banner's
 * action button can navigate here and scroll it into view.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { formatDisplayDate } from '../../shared/utils/formatters';
import { useLicence } from '../../shared/licence/LicenceContext';
import { LICENCE_STATUS_LABEL_KEYS } from '../../shared/licence/licenceCopy';
import {
  activateLicence,
  getLicenceStatus,
  refreshLicenceStatus,
  removeLicence,
} from '../../shared/ipc/licenceGateway';
import type { LicenceStatus } from '../../shared/ipc/licenceDto';

export function LicenceSettingsCard({ sessionToken }: { sessionToken: string }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { refresh: refreshContext } = useLicence();

  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [formBanner, setFormBanner] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getLicenceStatus();
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCheckAgain() {
    setLoading(true);
    try {
      const next = await refreshLicenceStatus();
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
    void refreshContext();
  }

  async function handleActivate(event: FormEvent) {
    event.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFormBanner(null);
    try {
      const next = await activateLicence(sessionToken, trimmed);
      setStatus(next);
      setKeyInput('');
      setFormBanner({ tone: 'success', text: t('licence.activated') });
      void refreshContext();
    } catch (err) {
      // The pasted key is kept so the operator can fix it, per plan §7.4.
      setFormBanner({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      const next = await removeLicence(sessionToken);
      setStatus(next);
      void refreshContext();
    } catch (err) {
      setFormBanner({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  }

  function handleCopy() {
    if (!status?.machine_code) return;
    void navigator.clipboard.writeText(status.machine_code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section
      className="sk-page sk-settings-page"
      id="licence-card"
      data-testid="licence-card"
      aria-labelledby="licence-card-title"
    >
      <div className="sk-settings-card">
        <div className="sk-settings-card__header">
          <div className="sk-settings-card__title-group">
            <h2 id="licence-card-title" className="sk-settings-card__title">{t('licence.title')}</h2>
          </div>
        </div>

      {loading ? <Spinner /> : null}

      {!loading && !status ? (
        <>
          <Banner tone="error" testId="licence-status-unavailable">
            {t('licence.statusUnavailable')}
          </Banner>
          <Button type="button" onClick={() => void handleCheckAgain()}>
            {t('common.retry')}
          </Button>
        </>
      ) : null}

      {!loading && status ? (
        <>
          {formBanner ? (
            <Banner tone={formBanner.tone} testId="licence-card-banner">
              {formBanner.text}
            </Banner>
          ) : null}

          <p data-testid="licence-status-label">
            <strong>{t(LICENCE_STATUS_LABEL_KEYS[status.status])}</strong>
          </p>
          {status.licence && status.licence.expires_on === null ? <p>{t('licence.permanent')}</p> : null}
          {status.days_left != null && status.licence?.expires_on ? (
            <p>
              {t('licence.expiresOn', { date: formatDisplayDate(status.licence.expires_on, locale) })}
              {' — '}
              {t('licence.daysLeft', { days: status.days_left })}
            </p>
          ) : null}
          {status.status === 'GRACE' && status.grace_days_left != null ? (
            <p>{t('licence.graceDaysLeft', { days: status.grace_days_left })}</p>
          ) : null}

          <div className="sk-field">
            <p className="sk-field__label">{t('licence.machineCode')}</p>
            <code
              data-testid="licence-machine-code"
              style={{ fontFamily: 'monospace', display: 'block' }}
            >
              {status.machine_code ?? '—'}
            </code>
            <Button
              type="button"
              variant="secondary"
              data-testid="licence-copy-code"
              onClick={handleCopy}
              disabled={!status.machine_code}
            >
              {copied ? t('licence.copied') : t('licence.copy')}
            </Button>
            <p className="sk-muted">{t('licence.machineCodeHelp')}</p>
          </div>

          {status.licence ? (
            <div data-testid="licence-installed-details">
              <p>
                <strong>{t('licence.licenceNumber')}:</strong> {status.licence.licence_id}
              </p>
              <p>
                <strong>{t('licence.licensee')}:</strong> {status.licence.licensee}
              </p>
              <p>
                <strong>{t('licence.issuedOn')}:</strong> {formatDisplayDate(status.licence.issued_on, locale)}
              </p>
              <p>
                {status.licence.expires_on
                  ? t('licence.expiresOn', { date: formatDisplayDate(status.licence.expires_on, locale) })
                  : t('licence.permanent')}
              </p>
            </div>
          ) : null}

          <form className="sk-form" onSubmit={(e) => void handleActivate(e)}>
            <label className="sk-field__label" htmlFor="licence-key-input">
              {t('licence.keyLabel')}
            </label>
            <textarea
              id="licence-key-input"
              data-testid="licence-key-input"
              className="sk-field__input"
              style={{ fontFamily: 'monospace' }}
              rows={4}
              placeholder={'STKL1.…'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <Button
              type="submit"
              data-testid="licence-activate"
              loading={busy}
              disabled={!keyInput.trim() || busy}
            >
              {t('licence.activate')}
            </Button>
          </form>

          <Button
            type="button"
            variant="secondary"
            data-testid="licence-refresh"
            onClick={() => void handleCheckAgain()}
          >
            {t('licence.checkAgain')}
          </Button>

          {status.licence ? (
            <Button
              type="button"
              variant="danger"
              data-testid="licence-remove"
              onClick={() => setConfirmingRemove(true)}
            >
              {t('licence.remove')}
            </Button>
          ) : null}
        </>
      ) : null}

      {confirmingRemove ? (
        <ConfirmDialog
          title={t('licence.remove')}
          body={t('licence.removeConfirm')}
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void handleRemove()}
          onCancel={() => setConfirmingRemove(false)}
          confirmVariant="danger"
          busy={busy}
        />
      ) : null}
      </div>
    </section>
  );
}
