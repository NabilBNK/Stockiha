/**
 * Slice 1 — application root. Composes the global providers and hands off to
 * the router:
 *   ErrorBoundary → I18nProvider → SessionProvider → AppRouter.
 *
 * The ErrorBoundary is outermost (it reads the default-locale table directly,
 * so it works even if a provider throws). No business logic lives here.
 */
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { I18nProvider } from './shared/i18n';
import { SessionProvider } from './shared/session/SessionContext';
import { AppRouter } from './app/AppRouter';
import './App.css';
import './styles/global.css';

function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <SessionProvider>
          <AppRouter />
        </SessionProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}

export default App;
