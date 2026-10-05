import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../../src/packages/core/dist/index.js";
import {
  findRoute,
  findEmergencyExit,
  planItinerary,
  formatDuration,
  doorOf,
  RouteError,
} from "../../src/packages/core/dist/index.js";
import { cloneBuilding, roomTypes } from "../helpers/fixtures.mjs";

const model = createModel(cloneBuilding(), roomTypes);

describe("wayfinding", () => {
  test("same-floor route walks the corridor without vertical travel", () => {
    const r = findRoute(model, "g-reception", "g-cafeteria");
    assert.equal(r.via, "walk");
    assert.equal(r.floorsChanged, 0);
    assert.equal(r.legs.length, 1);
    assert.equal(r.verticals.length, 0);
    assert.ok(r.distanceM > 0 && r.etaSeconds > 0);
    assert.match(r.steps.at(-1), /Cafeteria/);
  });

  test("cross-floor route uses the lift by default", () => {
    const r = findRoute(model, "g-reception", "3-it");
    assert.equal(r.via, "lift");
    assert.equal(r.floorsChanged, 3);
    assert.deepEqual(r.legs.map((l) => l.level), [0, 3]);
    assert.ok(r.steps.some((s) => /lift up to Floor 3/.test(s)));
  });

  test("stairs mode uses a stair shaft", () => {
    const r = findRoute(model, "3-it", "g-reception", { mode: "stairs" });
    assert.equal(r.via, "stairs");
    assert.ok(r.steps.some((s) => /Staircase .* down 3 floors/.test(s)));
  });

  test("same room returns a zero-length route", () => {
    const r = findRoute(model, "3-it", "3-it");
    assert.equal(r.distanceM, 0);
    assert.equal(r.legs.length, 0);
  });

  test("rejects unknown rooms and modes with typed errors", () => {
    assert.throws(() => findRoute(model, "nope", "3-it"), (e) => e instanceof RouteError && e.code === "UNKNOWN_ROOM");
    assert.throws(() => findRoute(model, "g-reception", "3-it", { mode: "teleport" }), (e) => e.code === "INVALID_MODE");
  });

  test("accessible mode fails clearly when no lift connects floors", () => {
    const b = cloneBuilding();
    for (const f of b.floors) f.rooms = f.rooms.filter((r) => r.type !== "lift");
    const m = createModel(b, roomTypes);
    assert.throws(() => findRoute(m, "g-reception", "3-it", { mode: "accessible" }), (e) => e.code === "NO_VERTICAL_CONNECTOR");
    assert.equal(findRoute(m, "g-reception", "3-it").via, "stairs");
  });

  test("emergency exit picks the nearest stairs and never the lift", () => {
    const r = findEmergencyExit(model, "3-townhall");
    assert.equal(r.emergency, true);
    assert.equal(r.to.id, "3-stairs-a");
    assert.ok(r.verticals.every((v) => v.via === "stairs"));
    assert.match(r.steps[0], /Do NOT use the lifts/);
  });

  test("itinerary chains segments and sums totals", () => {
    const plan = planItinerary(model, ["3-hr", "3-it"], { fromId: "g-reception" });
    assert.equal(plan.segments.length, 2);
    assert.equal(plan.etaSeconds, plan.segments[0].etaSeconds + plan.segments[1].etaSeconds);
    assert.throws(() => planItinerary(model, []), (e) => e.code === "EMPTY_ITINERARY");
  });

  test("doorOf faces the corridor", () => {
    assert.deepEqual(doorOf({ x: 0, z: 10, w: 4, d: 4 }, 0), { x: 0, z: 8 });
    assert.deepEqual(doorOf({ x: 0, z: -10, w: 4, d: 4 }, 0), { x: 0, z: -8 });
  });

  test("formatDuration", () => {
    assert.equal(formatDuration(42), "42 s");
    assert.equal(formatDuration(120), "2 min");
    assert.equal(formatDuration(95), "1 min 35 s");
  });
});
