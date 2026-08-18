import { describe, expect, it, vi } from "vitest";

const hookRuntime = vi.hoisted(() => {
  type Session = {
    states: unknown[];
    effects: Array<unknown[] | undefined>;
    cursor: number;
    effectCursor: number;
    render: (component: (props: any) => unknown, props: any) => unknown;
  };

  let current: Session | undefined;
  const sameDeps = (left: unknown[] | undefined, right: unknown[] | undefined) =>
    !!left && !!right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

  const useState = (initial: unknown) => {
    if (!current) throw new Error("hook state used outside a test render");
    const index = current.cursor++;
    if (!(index in current.states)) current.states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    const session = current;
    return [session.states[index], (next: unknown) => {
      session.states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(session.states[index]) : next;
    }] as const;
  };

  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    if (!current) throw new Error("hook effect used outside a test render");
    const index = current.effectCursor++;
    const previous = current.effects[index];
    if (!previous || !sameDeps(previous, deps)) {
      current.effects[index] = deps;
      void effect();
    }
  };

  return {
    useState,
    useEffect,
    session(component: (props: any) => unknown, props: any) {
      const session: Session = {
        states: [],
        effects: [],
        cursor: 0,
        effectCursor: 0,
        render(nextComponent, nextProps) {
          current = session;
          session.cursor = 0;
          session.effectCursor = 0;
          const tree = nextComponent(nextProps);
          current = undefined;
          return tree;
        },
      };
      return { session, tree: session.render(component, props) };
    },
  };
});

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState: hookRuntime.useState, useEffect: hookRuntime.useEffect };
});

import NativeReviewsPage from "./NativeReviewsPage";
import { createElectronTransport } from "../transport/electron";
import type { BookWriterReadOnlyBridge } from "../transport/bridge";

type ElementLike = { type?: unknown; props?: Record<string, any> };

function isElement(value: unknown): value is ElementLike {
  return !!value && typeof value === "object" && "props" in value;
}

function textOf(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  return isElement(value) ? textOf(value.props?.children) : "";
}

function findElement(tree: unknown, type: string, match?: (props: any) => boolean): ElementLike {
  if (tree == null || typeof tree === "boolean") throw new Error(`${type} was not rendered`);
  if (Array.isArray(tree)) {
    for (const child of tree) {
      try {
        return findElement(child, type, match);
      } catch {
        // Continue searching the remaining children.
      }
    }
    throw new Error(`${type} was not rendered`);
  }
  if (isElement(tree)) {
    if (tree.type === type && (!match || match(tree.props))) return tree;
    return findElement(tree.props?.children, type, match);
  }
  throw new Error(`${type} was not rendered`);
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("NativeReviewsPage", () => {
  it("loads review summaries and the selected document through Electron transport without fetch", async () => {
    const network = vi.fn(() => {
      throw new Error("Native reviews must not use fetch");
    });
    vi.stubGlobal("fetch", network);

    const summary = {
      relPath: "reviews/RV-001.md",
      name: "RV-001.md",
      ext: ".md",
      kind: "review" as const,
      date: "2026-08-16",
      scope: "chapter-1",
      title: "Chapter 1 review",
      updatedAt: "2026-08-16T00:00:00.000Z",
      stats: { findings: 1 },
    };
    const document = {
      relPath: summary.relPath,
      kind: summary.kind,
      updatedAt: summary.updatedAt,
      bytes: 22,
      text: "# Chapter 1 review\n\nOne finding. Raised as RV-001 in the review pass.",
    };
    const bridge = {
      content: {
        listReviews: vi.fn(async (projectId: string) => {
          expect(projectId).toBe("project-1");
          return [summary];
        }),
        reviewIdIndex: vi.fn(async (projectId: string) => {
          expect(projectId).toBe("project-1");
          return [{ id: "RV-001", relPath: "reviews/other.md" }];
        }),
        getReview: vi.fn(async (projectId: string, relPath: string) => {
          expect(projectId).toBe("project-1");
          expect(relPath).toBe(summary.relPath);
          return document;
        }),
      },
    } as unknown as BookWriterReadOnlyBridge;
    const transport = createElectronTransport(bridge);
    const props = { transport, projectId: "project-1", path: summary.relPath };
    const rendered = hookRuntime.session(NativeReviewsPage, props);

    await settle();
    const tree = rendered.session.render(NativeReviewsPage, props);

    expect(transport.mode).toBe("electron");
    expect(bridge.content.listReviews).toHaveBeenCalledTimes(1);
    expect(bridge.content.getReview).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain("RV-001.md");
    // Markdown reviews are rendered rather than shown as source, and pipeline
    // ids link to the document that defines them.
    const body = findElement(tree, "div", (props) => typeof props?.dangerouslySetInnerHTML?.__html === "string");
    const html = String(body.props?.dangerouslySetInnerHTML?.__html ?? "");
    expect(html).toContain("<h1>Chapter 1 review</h1>");
    expect(html).toContain("One finding.");
    expect(html).toContain('href="#/reviews/reviews/other.md"');
    expect(network).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
