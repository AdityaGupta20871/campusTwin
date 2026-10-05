import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createModel, describeRoom, overlapArea, containsRect, polylineLength, dedupePoints } from "../../src/packages/core/dist/index.js";
import { cloneBuilding, roomTypes } from "../helpers/fixtures.mjs";

describe("model", () => {
  const model = createModel(cloneBuilding(), roomTypes);

  test("indexes every room by id and sorts floors", () => {
    assert.deepEqual(model.floors.map((f) => f.level), [0, 1, 2, 3]);
    assert.ok(model.hasRoom("3-it"));
    assert.equal(model.getRoom("3-it").floor.name, "Floor 3");
    assert.equal(model.getRoom("missing"), null);
  });

  test("resolves the default origin to reception", () => {
    assert.equal(model.defaultOriginId, "g-reception");
  });

  test("falls back to 'other' for unknown room types", () => {
    const b = cloneBuilding();
    b.floors[0].rooms[0].type = "spaceship";
    const m = createModel(b, roomTypes);
    assert.equal(m.getRoom(b.floors[0].rooms[0].id).typeKey, "other");
  });

  test("records duplicate ids instead of silently overwriting", () => {
    const b = cloneBuilding();
    b.floors[1].rooms.push({ ...b.floors[1].rooms[0] });
    const m = createModel(b, roomTypes);
    assert.deepEqual(m.duplicates, [b.floors[1].rooms[0].id]);
  });

  test("rejects invalid input", () => {
    assert.throws(() => createModel({ floors: [] }, roomTypes), TypeError);
    assert.throws(() => createModel(cloneBuilding(), {}), TypeError);
  });

  test("describeRoom returns a serialisable snapshot with area", () => {
    const d = describeRoom(model.getRoom("g-cafeteria"));
    assert.equal(d.areaM2, 280);
    assert.equal(d.floor, "Ground Floor");
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
  });
});

describe("geometry", () => {
  const a = { x: 0, z: 0, w: 4, d: 4 };
  test("overlapArea", () => {
    assert.equal(overlapArea(a, { x: 2, z: 2, w: 4, d: 4 }), 4);
    assert.equal(overlapArea(a, { x: 4, z: 0, w: 4, d: 4 }), 0);
  });
  test("containsRect", () => {
    assert.ok(containsRect({ x: 0, z: 0, w: 10, d: 10 }, a));
    assert.ok(!containsRect(a, { x: 3, z: 0, w: 4, d: 4 }));
  });
  test("polylineLength and dedupePoints", () => {
    const pts = dedupePoints([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 3, z: 4 }]);
    assert.equal(pts.length, 2);
    assert.equal(polylineLength(pts), 5);
  });
});
