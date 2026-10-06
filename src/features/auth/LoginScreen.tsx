/**
 * Slice 1 — real login through the authentication IPC. No fake login, no
 * stored password. On success the opaque token is held in the in-memory
 * session context. Errors resolve to safe localized messages.
 */
import { useState, type FormEvent } from 'react';

import { WORKSTATION_ID } from '../../app/config';
import { Banner, Button, TextField } from '../../shared/components';
import { LOCALES, useI18n, type Locale } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { APP_VERSION_MARKER } from '../../shared/version';
import { LicenceBanner } from '../licence/LicenceBanner';
import './login.css';

const LOCALE_LABELS: Record<Locale, string> = { fr: 'FR', ar: 'ع', en: 'EN' };

const BRAND_TEXT = {
  en: {
    tagline: 'INVENTORY & POS CONTROL',
    headline: 'Reliable Retail & Commercial Operations',
    feature1: 'High-speed offline-ready POS checkout',
    feature2: 'Multi-warehouse inventory & WAC cost valuation',
    feature3: 'Immutable ledger journals & balanced accounting',
    feature4: 'Commercial invoices & receipts management',
    subtitle: 'Sign in to access your workstation session',
    hidePassword: 'Hide password',
    showPassword: 'Show password',
  },
  fr: {
    tagline: 'GESTION DE STOCK & POINT DE VENTE',
    headline: 'Opérations commerciales fiables et rapides',
    feature1: 'Encaissement caisse ultra-rapide et autonome',
    feature2: 'Gestion multi-dépôts & valorisation au CUMP',
    feature3: 'Journaux comptables équilibrés et scellés',
    feature4: 'Facturation commerciale & pièces justificatives',
    subtitle: 'Connectez-vous pour accéder à votre session',
    hidePassword: 'Masquer le mot de passe',
    showPassword: 'Afficher le mot de passe',
  },
  ar: {
    tagline: 'مراقبة المخزون ونقاط البيع',
    headline: 'إدارة متكاملة للتجارة والمخازن',
    feature1: 'نقطة بيع فائقة السرعة تعمل دون انقطاع',
    feature2: 'تعدد المستودعات وتقييم المخزون بالتكلفة المتوسطة',
    feature3: 'دفاتر وسجلات محاسبية متوازنة ومحمية',
    feature4: 'فواتير تجارية وسندات قبض نظامية',
    subtitle: 'سجّل الدخول للوصول إلى جلسة العمل الخاصة بك',
    hidePassword: 'إخفاء كلمة المرور',
    showPassword: 'إظهار كلمة المرور',
  },
};

export function LoginScreen() {
  const { t, locale, setLocale } = useI18n();
  const { login } = useSession();
  const errorText = useErrorText();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brand = BRAND_TEXT[locale];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      // On success the session provider re-routes; nothing else to do.
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sk-login-container">
      <div style={{ width: '100%', maxWidth: 920 }}>
        <LicenceBanner variant="login" />

        <div className="sk-login-card">
          {/* Left Brand Showcase Panel */}
          <div className="sk-login-brand">
            <div className="sk-login-brand__header">
              <span className="sk-login-brand__logo" aria-hidden="true">
                S
              </span>
              <div className="sk-login-brand__title-group">
                <span className="sk-login-brand__title">Stockiha</span>
                <span className="sk-login-brand__subtitle">{brand.tagline}</span>
              </div>
            </div>

            <div className="sk-login-brand__body">
              <h2 className="sk-login-brand__heading">{brand.headline}</h2>
              <ul className="sk-login-brand__features">
                <li className="sk-login-brand__feature-item">
                  <span className="sk-login-brand__feature-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span>{brand.feature1}</span>
                </li>
                <li className="sk-login-brand__feature-item">
                  <span className="sk-login-brand__feature-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span>{brand.feature2}</span>
                </li>
                <li className="sk-login-brand__feature-item">
                  <span className="sk-login-brand__feature-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span>{brand.feature3}</span>
                </li>
                <li className="sk-login-brand__feature-item">
                  <span className="sk-login-brand__feature-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span>{brand.feature4}</span>
                </li>
              </ul>
            </div>

            <div className="sk-login-brand__footer">
              <span className="sk-login-brand__badge">
                {t('auth.workstation')}: {WORKSTATION_ID}
              </span>
              <span>v{APP_VERSION_MARKER.replace('WS-R-', '')}</span>
            </div>
          </div>

          {/* Right Login Form Panel */}
          <div className="sk-login-form-panel">
            <div className="sk-login-top-bar">
              <span className="sk-login-top-bar__status">
                {WORKSTATION_ID}
              </span>
              {/* Language Switcher */}
              <div className="sk-lang" role="group" aria-label="Language selector">
                {LOCALES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`sk-lang__btn ${l === locale ? 'sk-lang__btn--active' : ''}`}
                    aria-pressed={l === locale}
                    onClick={() => setLocale(l)}
                  >
                    {LOCALE_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>

            <div className="sk-login-header">
              <h1>{t('auth.title')}</h1>
              <p>{brand.subtitle}</p>
            </div>

            <form className="sk-login-form" onSubmit={onSubmit} aria-label={t('auth.title')}>
              {error ? (
                <Banner tone="error" testId="login-error">
                  {error}
                </Banner>
              ) : null}

              <TextField
                label={t('auth.username')}
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                required
              />

              <div className="sk-field">
                <label className="sk-field__label" htmlFor="login-password">
                  {t('auth.password')}
                </label>
                <div className="sk-password-input-wrap">
                  <input
                    id="login-password"
                    className="sk-field__input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="sk-password-toggle-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? brand.hidePassword : brand.showPassword}
                    title={showPassword ? brand.hidePassword : brand.showPassword}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" y1="2" x2="22" y2="22" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                loading={submitting}
                disabled={!username || !password}
                className="sk-login-submit-btn"
              >
                {t('auth.submit')}
              </Button>

              <div className="sk-login-meta">
                <span className="sk-muted">
                  {t('auth.workstation')}: {WORKSTATION_ID}
                </span>
                <span
                  className="sk-muted"
                  style={{ fontSize: '0.75rem' }}
                  data-testid="login-version-marker"
                >
                  [ version = {APP_VERSION_MARKER} ]
                </span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
