import { contextBridge, ipcRenderer } from "electron";
import { exposeBookWriter } from "./expose.js";

// Expose only the typed, allow-listed API. ipcRenderer itself never crosses
// the isolation boundary.
exposeBookWriter(contextBridge, ipcRenderer);
