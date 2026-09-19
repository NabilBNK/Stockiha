import { useEffect, useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n } from '../../shared/i18n';
import {
  getCashSessionPolicy,
  saveCashSessionPolicy,
} from '../../shared/ipc/cashSessionGateway';

interface Props {
  sessionToken: string;
}

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export function CashPolicySettingsScreen({ sessionToken }: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCashSessionPolicy(sessionToken)
      .then((policy) => {
        if (!cancelled) {
          setThreshold(policy.material_variance_threshold);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [errorText, sessionToken]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!AMOUNT_RE.test(threshold)) {
      setError(errorText({ code: 'VALIDATION_ERROR', message: 'Invalid threshold' }));
      return;
    }
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const updated = await saveCashSessionPolicy(sessionToken, threshold);
      setThreshold(updated.material_variance_threshold);
      setFeedback(t('cashPolicy.saved'));
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sk-page sk-settings-page" aria-labelledby="cash-policy-settings-title">
      <div className="sk-settings-card">
        <div className="sk-settings-card__header">
          <div className="sk-settings-card__title-group">
            <h2 id="cash-policy-settings-title" className="sk-settings-card__title">
              {t('cashPolicy.title')}
            </h2>
            <p className="sk-settings-card__desc">{t('cashPolicy.help')}</p>
          </div>
        </div>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <form className="sk-form" onSubmit={onSave}>
          <TextField
            label={t('cashPolicy.threshold')}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            data-testid="cash-tolerance-input"
            inputMode="decimal"
            required
          />
          <Button
            type="submit"
            disabled={busy || !AMOUNT_RE.test(threshold)}
            loading={busy}
            data-testid="cash-tolerance-save"
          >
            {t('common.save')}
          </Button>
        </form>
      </div>
    </section>
  );
}
