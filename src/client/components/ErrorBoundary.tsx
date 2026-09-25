// Error boundary for graph visualization components
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { REPO_URL } from '../../shared/constants.ts';

const log = scoped('boundary');

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

function ErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="cg-error-boundary-fallback" role="alert">
      <h3>{t('error.title')}</h3>
      <p>{error?.message}</p>
      <div className="cg-error-boundary-actions">
        <button onClick={onRetry} aria-label={t('error.retry')}>
          {t('error.retry')}
        </button>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className="cg-error-boundary-feedback">
          {t('error.reportIssue')}
        </a>
      </div>
    </div>
  );
}

export class GraphErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    log.error('render error caught by boundary', { error, componentStack: errorInfo.componentStack });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState((prev) => ({ hasError: false, error: null, retryKey: prev.retryKey + 1 }))}
        />
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
