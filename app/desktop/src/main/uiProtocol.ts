import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { getPackagedResourcePath } from "./paths.js";

export const UI_SCHEME = "book-writer";
export const UI_HOST = "app";

const UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

let schemeRegistered = false;
let handlerRegistered = false;

/** Must run before app.ready. */
export function registerUiScheme(): void {
  if (schemeRegistered) return;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: UI_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
  schemeRegistered = true;
}

function requestRelativePath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${UI_SCHEME}:` || url.hostname !== UI_HOST) return null;
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    return pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  } catch {
    return null;
  }
}

/** Serve the built Vite output under a secure, standard local origin. */
export function registerUiProtocol(uiRoot: string): void {
  if (handlerRegistered) return;
  handlerRegistered = true;
  protocol.handle(UI_SCHEME, async (request) => {
    const relativePath = requestRelativePath(request.url);
    const filePath = relativePath ? getPackagedResourcePath(uiRoot, relativePath) : null;
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
      });
    }

    try {
      const upstream = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(upstream.headers);
      headers.set("x-content-type-options", "nosniff");
      if (filePath.toLowerCase().endsWith(".html")) headers.set("content-security-policy", UI_CSP);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      console.error("[desktop] failed to serve UI resource", filePath, error);
      return new Response("Unable to load UI resource", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
      });
    }
  });
}

export function createUiUrl(path = "index.html"): string {
  const normalized = path.replace(/^\/+/, "");
  return `${UI_SCHEME}://${UI_HOST}/${normalized}`;
}

/** Navigation is allowed only within the configured renderer origin. */
export function isAllowedUiUrl(url: string, devOrigin?: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${UI_SCHEME}:`) return parsed.hostname === UI_HOST;
    return Boolean(devOrigin && parsed.origin === devOrigin);
  } catch {
    return false;
  }
}
