#!/usr/bin/env node
/**
 * Zero-dependency static server for the built web studio with security headers.
 * - Serves only files under dist/web, the Vite build output (path traversal is rejected).
 * - GET/HEAD only.
 * - Strict CSP; inline scripts are allowed only by SHA-256 hash, not 'unsafe-inline'.
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Source modules import bare specifiers (e.g. "three") that only the Vite build resolves.
export const DEFAULT_ROOT = resolve(fileURLToPath(new URL("../../dist/web", import.meta.url)));

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
});

export function inlineScriptHashes(html) {
  // Browsers normalise CRLF/CR to LF before hashing inline scripts.
  const normalized = html.replace(/\r\n?/g, "\n");
  const hashes = [];
  for (const m of normalized.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    hashes.push(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function securityHeaders(scriptHashes = []) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

/** Maps a URL path to an absolute file path inside root, or null if it escapes root. */
export function resolveSafePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const full = resolve(join(root, relative));
  return full === root || full.startsWith(root + sep) ? full : null;
}

export function createStaticServer({ root = DEFAULT_ROOT } = {}) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8", ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };

    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "Method Not Allowed", { Allow: "GET, HEAD" });

    const file = resolveSafePath(base, new URL(req.url, "http://localhost").pathname);
    if (!file) return send(400, "Bad Request");

    try {
      const info = await stat(file);
      if (!info.isFile()) return send(404, "Not Found");
      const type = MIME[extname(file).toLowerCase()];
      if (!type) return send(404, "Not Found");
      const body = await readFile(file);
      const isHtml = type.startsWith("text/html");
      res.writeHead(200, {
        ...securityHeaders(isHtml ? inlineScriptHashes(body.toString("utf8")) : []),
        "Content-Type": type,
        "Content-Length": body.length,
        "Cache-Control": isHtml ? "no-cache" : "public, max-age=300",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return send(404, "Not Found");
      process.stderr.write(`[static] ${err.message}\n`);
      return send(500, "Internal Server Error");
    }
  });
}

function main() {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!existsSync(join(DEFAULT_ROOT, "index.html"))) {
    process.stderr.write(`No build found at ${DEFAULT_ROOT}. Run "npm run build:web" first.\n`);
    process.exit(1);
  }
  createStaticServer().listen(port, host, () => {
    process.stdout.write(`Campus Twin studio → http://${host === "0.0.0.0" ? "localhost" : host}:${port}/\n`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
