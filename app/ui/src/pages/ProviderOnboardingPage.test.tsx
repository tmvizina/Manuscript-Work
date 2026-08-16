import { describe, expect, it, vi } from "vitest";
import type { ProviderSummary } from "../transport";

/*
 * The UI package intentionally has no browser test dependency.  This small
 * hook runner lets these tests exercise the page's state transitions while
 * keeping the repository's node-only Vitest environment.  JSX still creates
 * ordinary React element objects, so button props and rendered text can be
 * inspected without a DOM or network.
 */
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

  const useMemo = (factory: () => unknown) => factory();

  return {
    useState,
    useEffect,
    useMemo,
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
  return { ...actual, useState: hookRuntime.useState, useEffect: hookRuntime.useEffect, useMemo: hookRuntime.useMemo };
});

import ProviderOnboardingPage from "./ProviderOnboardingPage";
import type { BookWriterTransport } from "../transport";

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

function elementsOf(value: unknown): ElementLike[] {
  if (value == null || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap(elementsOf);
  if (!isElement(value)) return [];
  return [value, ...elementsOf(value.props?.children)];
}

function buttonsOf(tree: unknown): ElementLike[] {
  return elementsOf(tree).filter((element) => element.type === "button");
}

function buttonContaining(tree: unknown, label: string): ElementLike {
  const button = buttonsOf(tree).find((candidate) => textOf(candidate).includes(label));
  if (!button) throw new Error(`button containing ${label} was not rendered`);
  return button;
}

function transportFor(sequence: ProviderSummary[], setting?: "claude" | "codex") {
  let saved = setting;
  let scanCount = 0;
  const settings = {
    get: vi.fn(async () => saved ? { projectId: "project-1", key: "preferredProvider" as const, value: saved, updatedAt: "now" } : null),
    set: vi.fn(async (_projectId: string, _key: "preferredProvider", value: unknown) => {
      saved = value as "claude" | "codex";
      return { projectId: "project-1", key: "preferredProvider" as const, value, updatedAt: "now" };
    }),
  };
  const status = vi.fn(async () => {
    scanCount += 1;
    return sequence;
  });
  const auth = vi.fn(async (provider: "claude" | "codex") => ({ provider, status: "authenticated" as const, ok: true, authenticated: true }));
  const cancelAuth = vi.fn(async (provider: "claude" | "codex") => ({ provider, cancelled: true }));
  const transport = {
    mode: "electron" as const,
    providers: {
      status,
      auth,
      cancelAuth,
    },
    settings,
  } as unknown as BookWriterTransport;
  return { transport, settings, status, auth, cancelAuth, scanCount: () => scanCount };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ProviderOnboardingPage", () => {
  it("keeps installation disabled when a provider is not installed", async () => {
    const fake = transportFor([
      { provider: "claude", status: "not_installed", message: "Claude CLI was not found." },
      { provider: "codex", status: "not_installed", message: "Codex CLI was not found." },
    ]);
    const rendered = hookRuntime.session(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    const tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });

    expect(buttonContaining(tree, "Install Claude CLI").props?.disabled).toBe(true);
    expect(buttonContaining(tree, "Install Codex CLI").props?.disabled).toBe(true);
    expect(fake.status).toHaveBeenCalledOnce();
  });

  it("allows an auth-required provider and persists the project selection", async () => {
    const fake = transportFor([
      { provider: "claude", status: "auth_required", version: "2.1.226" },
      { provider: "codex", status: "not_installed" },
    ]);
    const rendered = hookRuntime.session(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    let tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });

    const chooseClaude = buttonContaining(tree, "Use Claude CLI");
    expect(chooseClaude.props?.disabled).not.toBe(true);
    await chooseClaude.props?.onClick();
    tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });

    expect(fake.settings.set).toHaveBeenCalledWith("project-1", "preferredProvider", "claude");
    expect(textOf(tree)).toContain("Claude CLI selected for this project.");

    const reloaded = hookRuntime.session(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    tree = reloaded.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    expect(buttonContaining(tree, "Selected").props?.className).toBe("btn");
  });

  it("rescans PATH and updates the provider action without making a network request", async () => {
    const fake = transportFor([
      { provider: "claude", status: "not_installed" },
      { provider: "codex", status: "not_installed" },
    ]);
    fake.status.mockImplementationOnce(async () => [
      { provider: "claude", status: "not_installed" },
      { provider: "codex", status: "not_installed" },
    ]).mockImplementationOnce(async () => [
      { provider: "claude", status: "auth_required" },
      { provider: "codex", status: "not_installed" },
    ]);
    const rendered = hookRuntime.session(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    let tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    expect(buttonContaining(tree, "Install Claude CLI").props?.disabled).toBe(true);

    await buttonContaining(tree, "Rescan PATH").props?.onClick();
    await settle();
    tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });

    expect(fake.status).toHaveBeenCalledTimes(2);
    expect(buttonContaining(tree, "Use Claude CLI").props?.disabled).not.toBe(true);
  });

  it("authenticates through the provider-only transport and trusts only the follow-up status scan", async () => {
    const fake = transportFor([{ provider: "claude", status: "auth_required" }]);
    fake.status.mockImplementationOnce(async () => [{ provider: "claude", status: "auth_required" }])
      .mockImplementationOnce(async () => [{ provider: "claude", status: "ready" }]);
    const rendered = hookRuntime.session(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    let tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });

    await buttonContaining(tree, "Sign in to Claude CLI").props?.onClick();
    await settle();
    tree = rendered.session.render(ProviderOnboardingPage, { transport: fake.transport, projectId: "project-1" });

    expect(fake.auth).toHaveBeenCalledWith("claude");
    expect(fake.status).toHaveBeenLastCalledWith("claude");
    expect(textOf(tree)).toContain("ready");
  });
});
