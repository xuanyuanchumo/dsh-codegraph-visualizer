// Error boundary for graph visualization components
import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GraphErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    console.error('GraphErrorBoundary caught error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary-fallback" role="alert">
          <h3>Something went wrong</h3>
          <p>{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            aria-label="Retry"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional component error boundary alternative using React 19 error hooks
export function useErrorBoundary(): {
  error: Error | null;
  setError: (error: Error | null) => void;
} {
  const [error, setError] = React.useState<Error | null>(null);
  return { error, setError };
}