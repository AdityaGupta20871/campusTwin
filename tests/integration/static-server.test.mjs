import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { createStaticServer, resolveSafePath, inlineScriptHashes } from "../../src/server/static-server.mjs";

/** Raw HTTP request so ../ sequences are not normalised by the client. */
function raw(port, path, method = "GET") {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("static server", () => {
  let server;
  let port;

  before(async () => {
    server = createStaticServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(() => server.close());

  test("serves the landing page with security headers", async () => {
    const res = await raw(port, "/");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    assert.doesNotMatch(res.headers["content-security-policy"], /unsafe-inline|unsafe-eval/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
  });

  test("studio CSP uses local scripts without CDN allowances", async () => {
    const res = await raw(port, "/studio.html");
    assert.equal(res.status, 200);
    const policy = res.headers["content-security-policy"];
    assert.match(policy, /script-src 'self'/);
    assert.doesNotMatch(policy, /cdn\.jsdelivr\.net/);
    for (const hash of inlineScriptHashes(res.body)) assert.ok(policy.includes(hash));
  });

  test("serves built JavaScript bundles without bare module specifiers", async () => {
    const html = (await raw(port, "/studio.html")).body;
    const src = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    assert.ok(src, "studio.html should reference a built bundle");
    const res = await raw(port, src.startsWith("/") ? src : `/${src}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/javascript/);
    assert.doesNotMatch(res.body, /from\s*["']three["']/);
  });

  test("blocks path traversal, unknown files and non-GET methods", async () => {
    assert.equal((await raw(port, "/..%2f..%2fpackage.json")).status, 400);
    assert.equal((await raw(port, "/%2e%2e/%2e%2e/package.json")).status, 404);
    assert.equal((await raw(port, "/missing.html")).status, 404);
    assert.equal((await raw(port, "/", "POST")).status, 405);
    assert.equal((await raw(port, "/%E0%A4%A")).status, 400);
  });

  test("inline script hashes ignore CRLF vs LF line endings", () => {
    const lf = inlineScriptHashes('<script type="importmap">\n{"a":1}\n</script>');
    const crlf = inlineScriptHashes('<script type="importmap">\r\n{"a":1}\r\n</script>');
    assert.deepEqual(crlf, lf);
    assert.equal(inlineScriptHashes('<script src="x.js"></script>').length, 0);
  });

  test("resolveSafePath keeps requests inside root", () => {
    const root = resolve("/srv/web");
    assert.equal(resolveSafePath(root, "/a/b.js"), resolve(root, "a/b.js"));
    assert.equal(resolveSafePath(root, "/"), resolve(root, "index.html"));
    assert.equal(resolveSafePath(root, "/../secret"), null);
    assert.equal(resolveSafePath(root, "/%00"), null);
  });
});
