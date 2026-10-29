import { Component, type ReactNode } from "react";

/** Shows what went wrong instead of a blank page if the app crashes while rendering. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>Try reloading the page. If it keeps happening, send this message to whoever runs the site:</p>
        <pre>{error.message || String(error)}</pre>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
