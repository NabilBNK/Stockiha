/**
 * Slice 1 — real login through the authentication IPC. No fake login, no
 * stored password. On success the opaque token is held in the in-memory
 * session context. Errors resolve to safe localized messages.
 */
import { useState, type FormEvent } from 'react';

import { WORKSTATION_ID } from '../../app/config';
import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { APP_VERSION_MARKER } from '../../shared/version';

export function LoginScreen() {
  const { t } = useI18n();
  const { login } = useSession();
  const errorText = useErrorText();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="sk-centered">
      <form className="sk-card sk-form" onSubmit={onSubmit} aria-label={t('auth.title')}>
        <h1>{t('auth.title')}</h1>
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
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="sk-muted">
          {t('auth.workstation')}: {WORKSTATION_ID}
        </p>
        <Button type="submit" loading={submitting} disabled={!username || !password}>
          {t('auth.submit')}
        </Button>
        {/* WS-K-6 update-testing marker: harmless, visible confirmation of
            which build is actually running, from the sign-in screen itself
            (the setup/dashboard screens already show APP_VERSION_MARKER
            elsewhere, but this is the screen an update lands the operator
            on right after a restart). */}
        <p
          className="sk-muted"
          style={{ fontSize: '0.75rem', marginTop: '4px' }}
          data-testid="login-version-marker"
        >
          [ version = {APP_VERSION_MARKER} ]
        </p>
      </form>
    </div>
  );
}
