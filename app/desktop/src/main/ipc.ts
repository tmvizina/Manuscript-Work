/**
 * Placeholder for the desktop IPC surface.
 *
 * Keep registration in one idempotent hook so future handlers can be added
 * without making BrowserWindow creation responsible for IPC details. No
 * channels are exposed until their contracts and validation are implemented.
 */
let registered = false;

export function registerIpcHandlers(): void {
  if (registered) return;
  registered = true;
}
