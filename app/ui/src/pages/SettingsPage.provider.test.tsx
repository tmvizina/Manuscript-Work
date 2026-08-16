import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookWriterTransport, ExecutionProvider, ProviderSummary } from "../transport";

/*
 * SettingsPage has no DOM-specific behavior, so these tests use the same
 * node-only hook runner as ProviderOnboardingPage.test.tsx.  Rendering JSX
 * into ordinary React element objects lets the tests inspect provider cards
 * and invoke button handlers without starting a browser or making a request.
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

import SettingsPage from "./SettingsPage";

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

function buttonContaining(tree: unknown, label: string): ElementLike {
  const button = elementsOf(tree).find((element) => element.type === "button" && textOf(element).includes(label));
  if (!button) throw new Error(`button containing ${label} was not rendered`);
  return button;
}

function settingTransport(initial: ProviderSummary[], followUp = initial) {
  const status = vi.fn(async (provider?: ExecutionProvider) => provider ? followUp : initial);
  const auth = vi.fn(async (provider: ExecutionProvider) => ({
    provider,
    status: "auth_required" as const,
    ok: false,
    authenticated: false,
    message: "The CLI did not report an authenticated account.",
  }));
  const cancelAuth = vi.fn(async (provider: ExecutionProvider) => ({ provider, cancelled: true }));
  const settings = {
    get: vi.fn(async (projectId: string, key: "preferredProvider" | "defaultModel" | "permissionMode" | "runVariant") => ({
      projectId,
      key,
      value: key === "preferredProvider" ? "claude" : key === "defaultModel" ? "" : key === "permissionMode" ? "default" : "base",
      updatedAt: "now",
    })),
    set: vi.fn(async (projectId: string, key: "preferredProvider" | "defaultModel" | "permissionMode" | "runVariant", value: unknown) => ({
      projectId,
      key,
      value,
      updatedAt: "now",
    })),
  };
  const transport = {
    mode: "electron" as const,
    providers: { status, auth, cancelAuth },
    settings,
  } as unknown as BookWriterTransport;
  return { transport, status, auth, cancelAuth, settings };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsPage provider authentication", () => {
  it("displays detected provider status without making a network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fake = settingTransport([
      { provider: "claude", status: "auth_required", version: "2.1.226", executablePath: "C:\\Tools\\claude.exe" },
      { provider: "codex", status: "not_installed", message: "Codex CLI was not found." },
    ]);

    const rendered = hookRuntime.session(SettingsPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    const tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });

    expect(textOf(tree)).toContain("Claude CLI");
    expect(textOf(tree)).toContain("auth required");
    expect(textOf(tree)).toContain("2.1.226");
    expect(textOf(tree)).toContain("C:\\Tools\\claude.exe");
    expect(fake.status.mock.calls[0]).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes only the provider enum to auth and trusts the follow-up ready status", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fake = settingTransport(
      [{ provider: "claude", status: "auth_required" }, { provider: "codex", status: "not_installed" }],
      [{ provider: "claude", status: "ready", version: "2.1.226" }],
    );
    const rendered = hookRuntime.session(SettingsPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    let tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });

    await buttonContaining(tree, "Sign in").props?.onClick();
    await settle();
    tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });

    expect(fake.auth).toHaveBeenCalledTimes(1);
    expect(fake.auth.mock.calls[0]).toEqual(["claude"]);
    expect(fake.status.mock.calls[1]).toEqual(["claude"]);
    expect(textOf(tree)).toContain("ready");
    expect(textOf(tree)).toContain("The CLI did not report an authenticated account.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers re-authentication for a ready provider and keeps the call provider-only", async () => {
    const fake = settingTransport(
      [{ provider: "claude", status: "ready", version: "2.1.226" }],
      [{ provider: "claude", status: "ready", version: "2.1.226" }],
    );
    const rendered = hookRuntime.session(SettingsPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    let tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });

    expect(textOf(tree)).toContain("Re-authenticate");
    await buttonContaining(tree, "Re-authenticate").props?.onClick();
    await settle();
    tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });

    expect(fake.auth.mock.calls).toEqual([["claude"]]);
    expect(fake.status.mock.calls[1]).toEqual(["claude"]);
    expect(textOf(tree)).toContain("The CLI did not report an authenticated account.");
  });

  it("shows cancellation while authentication is in flight and sends only the provider enum", async () => {
    let resolveAuth!: () => void;
    const pendingAuth = new Promise<void>((resolve) => { resolveAuth = resolve; });
    const fake = settingTransport([{ provider: "claude", status: "auth_required" }]);
    fake.auth.mockImplementation(async (provider: ExecutionProvider) => pendingAuth.then(() => ({
      provider,
      status: "auth_required" as const,
      ok: false,
      authenticated: false,
      message: "The CLI did not report an authenticated account.",
    })));
    const rendered = hookRuntime.session(SettingsPage, { transport: fake.transport, projectId: "project-1" });
    await settle();
    let tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });

    const authInFlight = buttonContaining(tree, "Sign in").props?.onClick();
    tree = rendered.session.render(SettingsPage, { transport: fake.transport, projectId: "project-1" });
    expect(textOf(tree)).toContain("Cancel sign-in");

    await buttonContaining(tree, "Cancel sign-in").props?.onClick();
    expect(fake.cancelAuth.mock.calls).toEqual([["claude"]]);
    resolveAuth();
    await authInFlight;
    await settle();
    expect(fake.auth.mock.calls).toEqual([["claude"]]);
  });
});
