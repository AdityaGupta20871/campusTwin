import assert from "node:assert/strict";
import test from "node:test";
import { building } from "../../src/web/js/data/building-data.js";
import { buildShareUrl, decodeBuildingShare, encodeBuildingShare, readShareToken } from "../../src/web/js/core/building-share.js";

test("shared model links round-trip a building through the URL hash", async () => {
  const url = await buildShareUrl(building, "studio.html", "https://example.com/app/builder.html?x=1");
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://example.com/app/studio.html");
  assert.equal(parsed.search, "");
  assert.ok(url.length < 2900, "starter model should fit in a QR code");

  const decoded = await decodeBuildingShare(readShareToken(parsed.hash));
  assert.deepEqual(decoded, building);
});

test("shared model decoding drops unknown fields", async () => {
  const draft = structuredClone(building);
  draft.secret = "nope";
  draft.floors[0].rooms[0].onclick = "alert(1)";
  draft.floors[0].rooms[0].tags = [{ html: "<b>" }];
  const decoded = await decodeBuildingShare(await encodeBuildingShare(draft));
  assert.equal(decoded.secret, undefined);
  assert.equal(decoded.floors[0].rooms[0].onclick, undefined);
  assert.equal(decoded.floors[0].rooms[0].tags, undefined);
});

test("shared model decoding rejects malformed, invalid and oversized payloads", async () => {
  await assert.rejects(decodeBuildingShare("v2.abc"));
  await assert.rejects(decodeBuildingShare("v1.not base64!"));
  await assert.rejects(decodeBuildingShare("v1.AAAA"));

  const invalid = structuredClone(building);
  invalid.floors[0].rooms[0].w = -1;
  await assert.rejects(encodeBuildingShare(invalid));

  const bomb = new TextEncoder().encode(`{"pad":"${"a".repeat(2 * 1024 * 1024)}"}`);
  const compressed = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const token = `v1.${Buffer.from(compressed).toString("base64url")}`;
  await assert.rejects(decodeBuildingShare(token), /too large/);
});

test("readShareToken ignores unrelated hash values", () => {
  assert.equal(readShareToken("#room=1"), null);
  assert.equal(readShareToken("#model=v1.abc"), "v1.abc");
});
