import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createModel, validateLayout, spaceMetrics, parseCapacity } from "../../src/packages/core/dist/index.js";
import { cloneBuilding, roomTypes } from "../helpers/fixtures.mjs";

const codes = (res) => res.issues.map((i) => i.code);

describe("validateLayout", () => {
  test("sample building passes with no errors", () => {
    const res = validateLayout(createModel(cloneBuilding(), roomTypes));
    assert.equal(res.summary.errors, 0, JSON.stringify(res.issues));
    assert.equal(res.ok, true);
  });

  test("detects overlaps, out-of-footprint rooms and missing exits", () => {
    const b = cloneBuilding();
    const g = b.floors[0].rooms;
    g.push({ id: "g-clash", name: "Clash", type: "office", x: 0, z: 10, w: 4, d: 4 });
    g.push({ id: "g-outside", name: "Outside", type: "office", x: 40, z: 0, w: 4, d: 4 });
    b.floors[1].rooms = b.floors[1].rooms.filter((r) => r.type !== "stairs");
    const res = validateLayout(createModel(b, roomTypes));
    assert.ok(codes(res).includes("OVERLAP"));
    assert.ok(codes(res).includes("OUT_OF_FOOTPRINT"));
    assert.ok(codes(res).includes("FIRE_EXITS"));
    assert.equal(res.ok, false);
  });

  test("flags duplicate ids, invalid geometry, unknown types and broken workflows", () => {
    const b = cloneBuilding();
    b.floors[2].rooms.push({ ...b.floors[2].rooms[0] });
    b.floors[3].rooms.push({ id: "3-bad", name: "Bad", type: "unicorn", x: 0, z: 10, w: -1, d: 2 });
    b.floors[3].rooms.push({ id: "3-odd", name: "Odd", type: "unicorn", x: -2, z: -12, w: 1, d: 1 });
    b.workflows[0].stops.push("ghost-room");
    const c = codes(validateLayout(createModel(b, roomTypes)));
    for (const code of ["DUPLICATE_ID", "INVALID_GEOMETRY", "UNKNOWN_TYPE", "WORKFLOW_STOP"]) assert.ok(c.includes(code), code);
  });
});

describe("spaceMetrics", () => {
  const model = createModel(cloneBuilding(), roomTypes);

  test("parseCapacity", () => {
    assert.equal(parseCapacity("80 seats"), 80);
    assert.equal(parseCapacity(undefined), 0);
  });

  test("totals add up across floors", () => {
    const m = spaceMetrics(model);
    assert.equal(m.totals.floors, 4);
    assert.equal(m.totals.grossAreaM2, 4 * 60 * 30);
    assert.equal(m.totals.workstations, 2 * (80 + 64 + 64));
    assert.ok(m.totals.utilisationPct > 0 && m.totals.utilisationPct <= 100);
  });

  test("single floor filter", () => {
    const m = spaceMetrics(model, 3);
    assert.equal(m.floors.length, 1);
    assert.equal(m.floors[0].meetingSeats, 20);
  });
});
