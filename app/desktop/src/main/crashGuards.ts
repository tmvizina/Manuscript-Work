export interface CrashGuardDeps {
  /** Record the failure before the process exits. Never throw. */
  log: (label: "uncaughtException" | "unhandledRejection", error: unknown) => void;
  /**
   * Perform a best-effort, bounded shutdown (destroy windows, close the
   * runtime, exit the process). Must not depend on further event-loop turns
   * completing normally, since the process is already in a broken state.
   * Called for an uncaught exception only, never for a rejected promise.
   */
  shutdown: () => void;
}

/**
 * Electron installs a default `process.on('uncaughtException', ...)` listener
 * that presents a blocking native "A JavaScript error occurred in the main
 * process" dialog and leaves the process alive until a user dismisses it.
 * Node (15+) also treats an unhandled promise rejection as an uncaught
 * exception by default, so the same dialog can appear from a rejected
 * promise anywhere in the main process that nothing awaits or catches.
 *
 * In an unattended launch (automated benchmarking, CI, a machine with no
 * interactive session) nothing ever dismisses that dialog: the main process
 * hangs indefinitely on the modal message loop while any renderer/GPU/
 * utility helper processes it already spawned keep running. An external
 * harness that eventually force-kills the hung process only catches the
 * child processes that existed in its last process-tree snapshot, so
 * anything spawned afterward (or reparented before the snapshot, e.g. a
 * crash-reporter helper) can be left running as an orphan.
 *
 * Replace Electron's default listener with one that logs the failure and
 * performs an explicit, bounded shutdown instead of ever presenting a
 * dialog. This must run before any other startup code that could throw.
 */
export function installCrashGuards(deps: CrashGuardDeps): void {
  // Electron registers its dialog-showing listener before the app's own
  // entry point runs. Node's EventEmitter invokes every registered listener
  // for an event, so simply adding our own listener would not stop
  // Electron's from also firing; the default listener must be removed first.
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", (error) => {
    try {
      deps.log("uncaughtException", error);
    } catch {
      // The process is already crashing; a broken logger must not prevent
      // shutdown from running.
    } finally {
      deps.shutdown();
    }
  });

  // A rejected promise is deliberately NOT treated as fatal. Node's default
  // would rethrow it into the uncaught path, and Electron would then show the
  // same blocking dialog, so the default still has to be replaced. But this
  // application holds a writer's unsaved manuscript state, and an unawaited
  // rejection in a non-critical path (a provider probe, a background scan) is
  // not a reason to terminate the session with no warning. Removing the
  // dialog already fixes the unattended hang; log and keep running.
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason) => {
    try {
      deps.log("unhandledRejection", reason);
    } catch {
      // See above.
    }
  });
}
