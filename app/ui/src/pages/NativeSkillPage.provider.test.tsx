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

import NativeSkillPage from "./NativeSkillPage";
import type { SkillSummary } from "../lib/api";
import type { BookWriterTransport, ProviderSummary } from "../transport";

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
function findElement(tree: unknown, type: string, label?: string): ElementLike {
  const element = elementsOf(tree).find((candidate) => candidate.type === type && (!label || textOf(candidate).includes(label)));
  if (!element) throw new Error(`${type} ${label ?? ""} was not rendered`);
  return element;
}

const skill: SkillSummary = {
  skill_id: "book-reviewer-v2",
  display_name: "Book reviewer",
  pipeline_order: 1,
  phase: "Review",
  blurb: "Review the manuscript.",
  image_path: "/images/reviewer.svg",
  has_rag_variant: 1,
};

function transportFor(status: ProviderSummary["status"]) {
  const settings = {
    get: vi.fn(async () => ({ projectId: "project-1", key: "preferredProvider" as const, value: "claude", updatedAt: "now" })),
  };
  const runs = {
    list: vi.fn(async () => []),
    start: vi.fn(async (request: any) => ({ runId: "run-1", provider: request.provider, status: "queued" as const })),
    cancel: vi.fn(async () => ({ runId: "run-1", cancelled: true })),
    subscribe: vi.fn(async () => ({ subscriptionId: "sub-1", runId: "run-1", replayCursor: -1, replayTruncated: false })),
    unsubscribe: vi.fn(async () => ({ subscriptionId: "sub-1", unsubscribed: true })),
  };
  const providers = {
    status: vi.fn(async () => [{ provider: "claude" as const, status }]),
  };
  const transport = { mode: "electron" as const, settings, runs, providers } as unknown as BookWriterTransport;
  return { transport, settings, runs, providers };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function installSessionStorage() {
  (globalThis as any).sessionStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  };
}

describe("NativeSkillPage provider gate", () => {
  it("keeps Run disabled for an auth-required provider even with a prompt", async () => {
    installSessionStorage();
    const fake = transportFor("auth_required");
    const rendered = hookRuntime.session(NativeSkillPage, { transport: fake.transport, projectId: "project-1", skill });
    await settle();
    let tree = rendered.session.render(NativeSkillPage, { transport: fake.transport, projectId: "project-1", skill });

    findElement(tree, "textarea").props?.onChange({ target: { value: "Review chapter one" } });
    tree = rendered.session.render(NativeSkillPage, { transport: fake.transport, projectId: "project-1", skill });
    expect(findElement(tree, "button", "Run").props?.disabled).toBe(true);
    expect(fake.runs.start).not.toHaveBeenCalled();
  });

  it("enables Run only after the selected provider reports ready", async () => {
    installSessionStorage();
    const fake = transportFor("ready");
    const rendered = hookRuntime.session(NativeSkillPage, { transport: fake.transport, projectId: "project-1", skill });
    await settle();
    let tree = rendered.session.render(NativeSkillPage, { transport: fake.transport, projectId: "project-1", skill });

    findElement(tree, "textarea").props?.onChange({ target: { value: "Review chapter one" } });
    tree = rendered.session.render(NativeSkillPage, { transport: fake.transport, projectId: "project-1", skill });
    expect(findElement(tree, "button", "Run").props?.disabled).toBe(false);

    await findElement(tree, "button", "Run").props?.onClick();
    expect(fake.runs.start).toHaveBeenCalledWith(expect.objectContaining({ provider: "claude", projectId: "project-1", skillId: skill.skill_id }));
  });
});
