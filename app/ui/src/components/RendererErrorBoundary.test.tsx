import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RendererErrorBoundary from "./RendererErrorBoundary";

describe("RendererErrorBoundary", () => {
  it("replaces failed content without exposing the exception and supports recovery", () => {
    const onReset = vi.fn();
    const boundary = new RendererErrorBoundary({ children: createElement("p", null, "healthy"), onReset });
    boundary.state = RendererErrorBoundary.getDerivedStateFromError(new Error("C:/private/manuscript secret"));
    boundary.setState = ((next: { error: Error | null }) => { boundary.state = next; }) as typeof boundary.setState;

    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain("unexpected error");
    expect(html).not.toContain("private/manuscript");

    boundary.retry();
    expect(boundary.state.error).toBeNull();
    expect(onReset).toHaveBeenCalledOnce();
  });
});
