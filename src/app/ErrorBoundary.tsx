import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';
import { bootstrapProject } from '../persistence/bootstrap';

interface State {
  error: Error | null;
  recovering: boolean;
  failed: boolean;
}

/**
 * Last line of defence: a crash shows a plain message with "Recover last autosave" and Reload instead of a blank page.
 * Recovering reloads the most recent autosaved project into the app and tries again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, recovering: false, failed: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The app crashed:', error, info.componentStack);
  }

  recover = async () => {
    this.setState({ recovering: true, failed: false });
    try {
      await bootstrapProject();
      this.setState({ error: null, recovering: false });
    } catch {
      this.setState({ recovering: false, failed: true });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center text-slate-800"
      >
        <p className="max-w-md text-base">{t('app.error')}</p>
        <div className="flex gap-2">
          <button
            className="rounded-md bg-sky-700 px-4 py-2 text-sm text-white hover:bg-sky-800 disabled:opacity-50"
            disabled={this.state.recovering}
            onClick={() => void this.recover()}
          >
            {t('app.recover')}
          </button>
          <button
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
            onClick={() => window.location.reload()}
          >
            {t('app.reload')}
          </button>
        </div>
        {this.state.failed && <p className="text-sm text-red-700">{t('app.recoverFailed')}</p>}
        <pre className="max-w-xl overflow-auto text-xs text-slate-500">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}
