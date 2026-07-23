/**
 * Slice 1 — typed error boundary. Catches render-time exceptions anywhere in
 * the tree and shows a fixed, localized fallback — never a raw stack trace,
 * message, or component detail. The thrown value is deliberately not
 * rendered.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { MESSAGES, DEFAULT_LOCALE } from '../i18n/locales';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally swallow the error contents. A production build would send
    // a redacted signal to a local log sink; it must never surface raw
    // details to the UI. `_error`/`_info` are intentionally unused.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // The boundary can render before/around the i18n provider, so it reads
      // the default-locale table directly rather than via the hook.
      const table = MESSAGES[DEFAULT_LOCALE];
      return (
        <div className="sk-boundary" role="alert">
          <h1>{table['boundary.title']}</h1>
          <p>{table['boundary.body']}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
