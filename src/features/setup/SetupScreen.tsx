/**
 * First-run setup creates the initial administrator and base data, then offers
 * the one-time opening-state decision. Opening state is optional: the first
 * administrator may enter it now, defer it, or explicitly decline it.
 */
import { useState, type FormEvent } from 'react';

import { WORKSTATION_ID } from '../../app/config';
import { Banner, Button, TextField } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import {
  getOpeningStateOnboardingStatus,
  setOpeningStateOnboardingChoice,
} from '../../shared/ipc/openingStateLifecycleGateway';
import { OpeningStateScreen } from '../onboarding/OpeningStateScreen';

type SetupStep = 'account' | 'opening-choice' | 'opening-entry';

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    choiceTitle: 'Optional opening state',
    choiceBody:
      'Opening state records what the business owns and owes on the day Stockiha starts. It is normally completed once and is restricted to the first administrator.',
    now: 'Enter opening state now',
    later: 'Do it later',
    decline: 'Do not use opening state',
    laterHelp:
      'You can continue using Stockiha and complete it later from the restricted Settings area.',
    declineHelp:
      'Choose this when the business will start without importing existing balances.',
    entryTitle: 'Complete the one-time opening state',
    entryBody:
      'Approve the balanced package, then finish setup. You may also postpone it without blocking the application.',
    finish: 'Finish setup',
    incomplete:
      'Approve the opening-state package first, or choose “Do it later” to continue without it.',
  },
  fr: {
    choiceTitle: 'Situation initiale facultative',
    choiceBody:
      'La situation initiale enregistre ce que l’entreprise possède et doit au démarrage de Stockiha. Elle est normalement complétée une seule fois et réservée au premier administrateur.',
    now: 'Saisir la situation initiale maintenant',
    later: 'Le faire plus tard',
    decline: 'Ne pas utiliser la situation initiale',
    laterHelp:
      'Vous pouvez continuer à utiliser Stockiha et la compléter plus tard depuis la zone Paramètres restreinte.',
    declineHelp:
      'Choisissez cette option si l’entreprise démarre sans importer ses soldes existants.',
    entryTitle: 'Compléter la situation initiale unique',
    entryBody:
      'Approuvez le dossier équilibré, puis terminez la configuration. Vous pouvez aussi le reporter sans bloquer l’application.',
    finish: 'Terminer la configuration',
    incomplete:
      'Approuvez d’abord la situation initiale ou choisissez « Le faire plus tard » pour continuer.',
  },
  ar: {
    choiceTitle: 'الوضعية الافتتاحية اختيارية',
    choiceBody:
      'تسجل الوضعية الافتتاحية ما تملكه المؤسسة وما عليها يوم بدء Stockiha. تُنجز عادة مرة واحدة وتبقى خاصة بالمسؤول الأول.',
    now: 'إدخال الوضعية الافتتاحية الآن',
    later: 'إكمالها لاحقاً',
    decline: 'عدم استعمال الوضعية الافتتاحية',
    laterHelp:
      'يمكنك متابعة استعمال Stockiha وإكمالها لاحقاً من قسم الإعدادات المقيّد.',
    declineHelp:
      'اختر هذا إذا كانت المؤسسة ستبدأ دون إدخال الأرصدة الحالية.',
    entryTitle: 'إكمال الوضعية الافتتاحية لمرة واحدة',
    entryBody:
      'وافق على الملف المتوازن ثم أنهِ الإعداد. يمكنك أيضاً تأجيله دون تعطيل التطبيق.',
    finish: 'إنهاء الإعداد',
    incomplete:
      'وافق على ملف الوضعية الافتتاحية أولاً، أو اختر إكمالها لاحقاً للمتابعة.',
  },
};

export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const { t, locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const { login } = useSession();

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
  const [step, setStep] = useState<SetupStep>('account');
  const [setupSessionToken, setSetupSessionToken] = useState<string | null>(null);
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
      const token = await login(form.username, form.password);
      setSetupSessionToken(token);
      setStep('opening-choice');
    } catch (err) {
      // Setup is one-time. A stale setup screen (or a concurrent first-admin
      // attempt) can reach bootstrap after another process has initialized the
      // database; route to the normal sign-in flow instead of showing a raw
      // precondition error.
      if (codeForError(err) === 'PRECONDITION_FAILED') {
        try {
          const status = await ipc.getSetupStatus();
          if (status.initialized) {
            onComplete();
            return;
          }
        } catch {
          // Preserve the original safe error if the status refresh fails.
        }
      }
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseOpeningState(choice: 'DEFERRED' | 'DECLINED') {
    if (!setupSessionToken || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await setOpeningStateOnboardingChoice(setupSessionToken, { choice });
      onComplete();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function finishOpeningState() {
    if (!setupSessionToken || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const status = await getOpeningStateOnboardingStatus(setupSessionToken);
      if (status.status !== 'COMPLETED') {
        setError(text.incomplete);
        return;
      }
      onComplete();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'opening-choice') {
    return (
      <div className="sk-centered">
        <section className="sk-card sk-form sk-form--wide" aria-labelledby="opening-choice-title">
          <h1 id="opening-choice-title">{text.choiceTitle}</h1>
          <p>{text.choiceBody}</p>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <div className="sk-stack">
            <Button type="button" onClick={() => setStep('opening-entry')}>
              {text.now}
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={submitting}
              onClick={() => void chooseOpeningState('DEFERRED')}
            >
              {text.later}
            </Button>
            <small className="sk-field-help">{text.laterHelp}</small>
            <Button
              type="button"
              variant="secondary"
              loading={submitting}
              onClick={() => void chooseOpeningState('DECLINED')}
            >
              {text.decline}
            </Button>
            <small className="sk-field-help">{text.declineHelp}</small>
          </div>
        </section>
      </div>
    );
  }

  if (step === 'opening-entry' && setupSessionToken) {
    return (
      <div className="sk-stack">
        <section className="sk-card">
          <h1>{text.entryTitle}</h1>
          <p>{text.entryBody}</p>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <div className="sk-actions">
            <Button
              type="button"
              loading={submitting}
              onClick={() => void finishOpeningState()}
            >
              {text.finish}
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={submitting}
              onClick={() => void chooseOpeningState('DEFERRED')}
            >
              {text.later}
            </Button>
          </div>
        </section>
        <OpeningStateScreen sessionToken={setupSessionToken} />
      </div>
    );
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
