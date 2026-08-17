import { Component, type ErrorInfo, type ReactNode } from "react";

interface RendererErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface RendererErrorBoundaryState {
  error: Error | null;
}

/** Last-resort renderer recovery UI; never renders exception details or paths. */
export default class RendererErrorBoundary extends Component<RendererErrorBoundaryProps, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[renderer] unexpected component failure", error, info.componentStack);
  }

  retry = () => {
    this.setState({ error: null });
    if (this.props.onReset) this.props.onReset();
    else window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <h1>Book Writer hit an unexpected error</h1>
        <p>No manuscript or provider details were displayed. Reload the renderer to try again.</p>
        <button className="btn" onClick={this.retry}>Reload Book Writer</button>
      </main>
    );
  }
}
