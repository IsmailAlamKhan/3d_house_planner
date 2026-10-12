import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

/** Last line of defence: a crash shows a plain message and a Reload button instead of a blank page. The project is autosaved. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The app crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center text-slate-800"
      >
        <p className="max-w-md text-base">{t('app.error')}</p>
        <button
          className="rounded-md bg-sky-700 px-4 py-2 text-sm text-white hover:bg-sky-800"
          onClick={() => window.location.reload()}
        >
          {t('app.reload')}
        </button>
        <pre className="max-w-xl overflow-auto text-xs text-slate-500">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}
