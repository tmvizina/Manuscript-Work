import { afterEach, describe, expect, it, vi } from "vitest";
import { installCrashGuards } from "./crashGuards.js";

describe("installCrashGuards", () => {
  const originalUncaught = process.listeners("uncaughtException");
  const originalRejection = process.listeners("unhandledRejection");

  afterEach(() => {
    process.removeAllListeners("uncaughtException");
    for (const listener of originalUncaught) process.on("uncaughtException", listener as never);
    process.removeAllListeners("unhandledRejection");
    for (const listener of originalRejection) process.on("unhandledRejection", listener as never);
  });

  it("removes any pre-existing uncaughtException listener before installing its own", () => {
    // Stand in for Electron's built-in dialog-showing listener, registered
    // before the app's own code runs.
    const electronDefaultDialog = vi.fn();
    process.on("uncaughtException", electronDefaultDialog);

    const log = vi.fn();
    const shutdown = vi.fn();
    installCrashGuards({ log, shutdown });

    // The pre-existing (simulated Electron default) listener must be gone,
    // leaving only the one installCrashGuards just installed.
    expect(process.listeners("uncaughtException")).toHaveLength(1);
    expect(process.listeners("uncaughtException")).not.toContain(electronDefaultDialog);

    const error = new Error("boom");
    process.emit("uncaughtException", error);

    expect(electronDefaultDialog).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("uncaughtException", error);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("removes any pre-existing unhandledRejection listener before installing its own", () => {
    const electronDefaultDialog = vi.fn();
    process.on("unhandledRejection", electronDefaultDialog);

    const log = vi.fn();
    const shutdown = vi.fn();
    installCrashGuards({ log, shutdown });

    const reason = new Error("rejected");
    process.emit("unhandledRejection", reason, Promise.resolve());

    expect(electronDefaultDialog).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("unhandledRejection", reason);
  });

  it("keeps the session alive after a rejected promise", () => {
    // The dialog is what hung unattended launches, and removing Electron's
    // default listener already fixes that. Terminating on any stray rejection
    // would discard the writer's unsaved state for a non-fatal fault.
    const shutdown = vi.fn();
    installCrashGuards({ log: vi.fn(), shutdown });

    process.emit("unhandledRejection", new Error("rejected"), Promise.resolve());

    expect(shutdown).not.toHaveBeenCalled();
  });

  it("still shuts down even if the log callback throws", () => {
    const shutdown = vi.fn();
    installCrashGuards({
      log: () => {
        throw new Error("logging failed");
      },
      shutdown,
    });

    process.emit("uncaughtException", new Error("boom"));

    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
