/**
 * Slice 1 — first-run setup. Creates the initial administrator + base data
 * through the guarded `bootstrap_first_admin` IPC (one-time, backend-guarded).
 * Setup completion is determined by backend `get_setup_status`, not local
 * state. A company profile is explicitly deferred (not backed by the backend
 * yet) and surfaced as a note rather than a fake field.
 */
import { useState, type FormEvent } from 'react';

import { WORKSTATION_ID } from '../../app/config';
import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';

export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    workstationId: WORKSTATION_ID,
    warehouseCode: 'WH1',
    warehouseName: '',
    periodCode: String(currentYear),
    periodStartsOn: `${currentYear}-01-01`,
    periodEndsOn: `${currentYear}-12-31`,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: { target: { value: string } }) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await ipc.bootstrapFirstAdmin(form);
      onComplete();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sk-centered">
      <form className="sk-card sk-form sk-form--wide" onSubmit={onSubmit} aria-label={t('setup.title')}>
        <h1>{t('setup.title')}</h1>
        <p className="sk-muted">{t('setup.intro')}</p>
        {error ? (
          <Banner tone="error" testId="setup-error">
            {error}
          </Banner>
        ) : null}
        <div className="sk-form__grid">
          <TextField label={t('setup.username')} required {...field('username')} />
          <TextField label={t('setup.password')} type="password" required {...field('password')} />
          <TextField label={t('setup.displayName')} required {...field('displayName')} />
          <TextField label={t('setup.workstation')} required {...field('workstationId')} />
          <TextField label={t('setup.warehouseCode')} required {...field('warehouseCode')} />
          <TextField label={t('setup.warehouseName')} required {...field('warehouseName')} />
          <TextField label={t('setup.periodCode')} required {...field('periodCode')} />
          <TextField label={t('setup.periodStart')} type="date" required {...field('periodStartsOn')} />
          <TextField label={t('setup.periodEnd')} type="date" required {...field('periodEndsOn')} />
        </div>
        <Banner tone="info">{t('setup.companyDeferred')}</Banner>
        <Button type="submit" loading={submitting}>
          {t('setup.submit')}
        </Button>
      </form>
    </div>
  );
}
