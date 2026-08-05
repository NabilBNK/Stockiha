/**
 * Slice 1 — shared, touchscreen-friendly UI primitives. Large touch targets,
 * high contrast, clear success/warning/error/destructive states. All labels
 * are passed in by callers (already localized); these components hardcode no
 * business strings.
 */
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

import { useI18n } from '../i18n';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  variant = 'primary',
  loading = false,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`sk-btn sk-btn--${variant} ${className ?? ''}`.trim()}
    >
      {loading ? <span className="sk-btn__spinner" aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

export function TextField({
  label,
  error,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id ?? `sk-field-${generatedId.replace(/:/g, '')}`;
  return (
    <div className="sk-field">
      <label className="sk-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input id={fieldId} className="sk-field__input" aria-invalid={!!error} {...rest} />
      {error ? (
        <p className="sk-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="sk-spinner" role="status" aria-live="polite">
      <span className="sk-spinner__dot" aria-hidden />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

type BannerTone = 'error' | 'success' | 'warning' | 'info';

export function Banner({
  tone = 'info',
  children,
  testId,
}: {
  tone?: BannerTone;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={`sk-banner sk-banner--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmVariant = 'primary',
  busy = false,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmVariant?: ButtonVariant;
  busy?: boolean;
}) {
  return (
    <div className="sk-modal__backdrop" role="presentation" onClick={onCancel}>
      <div
        className="sk-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sk-modal__title">{title}</h2>
        {body ? <div className="sk-modal__body">{body}</div> : null}
        <div className="sk-modal__actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
