/**
 * Server compatibility facade for the shared database core.
 *
 * Keep this module at its existing path because the current routes and sync
 * services import it directly. The implementation lives in packages/core so
 * the desktop and other hosts can use the same migrations and helpers.
 */
export {
  getSetting,
  newId,
  nowIso,
  openDb,
  setSetting,
  type DB,
} from "../../../../packages/core/src/db/db.js";
