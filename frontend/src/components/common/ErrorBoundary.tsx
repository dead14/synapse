import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Shown instead of the default panel. Receives a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Label used in the default panel so the operator knows what failed. */
  scope?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * React only surfaces render-phase errors through a class boundary
 * (https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary).
 * Without one, a throw inside a chart, the 3D viewer, or the sectioning map
 * unmounts the whole tree and leaves a blank page with no way to recover.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.scope ? ` · ${this.props.scope}` : ''}]`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="syn-page">
        <div className="syn-shell">
          <section className="syn-panel syn-empty-compact" role="alert">
            <p className="syn-kicker">Workspace error</p>
            <h1 className="syn-heading">
              {this.props.scope ? `${this.props.scope} could not be displayed.` : 'This page could not be displayed.'}
            </h1>
            <p className="syn-copy">
              The view failed to render, but data already saved on the server is unaffected.
              Technical details are available in the browser console.
            </p>
            <p className="syn-copy font-mono text-xs">{error.message}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className="syn-action syn-action--ink" onClick={this.reset}>
                Try again
              </button>
              <a className="syn-action syn-action--outline" href="/">
                Back to Overview
              </a>
            </div>
          </section>
        </div>
      </div>
    );
  }
}
