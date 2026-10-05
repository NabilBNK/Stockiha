import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ChartErrorBoundaryProps {
  fallbackText: string;
  children: ReactNode;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
}

export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ChartErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="sk-chart-fallback" role="alert">
          <p className="sk-muted">{this.props.fallbackText}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
