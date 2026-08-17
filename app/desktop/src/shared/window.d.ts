import type { BookWriterApi } from "./contracts.js";

declare global {
  interface Window {
    readonly bookWriter: BookWriterApi;
  }
}

export {};
