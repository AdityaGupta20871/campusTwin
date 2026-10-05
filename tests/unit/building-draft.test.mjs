import assert from "node:assert/strict";
import test from "node:test";
import { building } from "../../src/web/js/data/building-data.js";
import { parseBuilderCommand } from "../../src/web/js/core/builder-commands.js";
import {
  BUILDING_DRAFT_STORAGE_KEY,
  clearBuildingDraft,
  isValidBuildingDraft,
  readBuildingDraft,
  saveBuildingDraft,
} from "../../src/web/js/core/building-draft.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("building drafts validate geometry and round-trip through versioned storage", () => {
  const storage = createStorage();
  const draft = structuredClone(building);
  draft.floors[0].rooms[0].w = 12.5;

  assert.equal(isValidBuildingDraft(draft), true);
  assert.equal(saveBuildingDraft(draft, storage), true);
  assert.equal(readBuildingDraft(building, storage).floors[0].rooms[0].w, 12.5);
  assert.equal(JSON.parse(storage.getItem(BUILDING_DRAFT_STORAGE_KEY)).version, 1);
});

test("invalid or corrupt drafts fall back to the bundled building", () => {
  const storage = createStorage();
  const invalid = structuredClone(building);
  invalid.floors[0].rooms[0].w = 0;
  storage.setItem(BUILDING_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, building: invalid }));
  assert.equal(readBuildingDraft(building, storage), building);
  assert.throws(() => saveBuildingDraft(invalid, storage), /invalid/);

  storage.setItem(BUILDING_DRAFT_STORAGE_KEY, "not-json");
  assert.equal(readBuildingDraft(building, storage), building);

  const empty = structuredClone(building);
  for (const floor of empty.floors) floor.rooms = [];
  delete empty.workflows;
  assert.equal(isValidBuildingDraft(empty), false);
});

test("clearing removes only the building draft", () => {
  const storage = createStorage();
  saveBuildingDraft(structuredClone(building), storage);
  clearBuildingDraft(storage);
  assert.equal(readBuildingDraft(building, storage), building);
});

test("builder commands parse floor, geometry, and room edits without guessing", () => {
  assert.deepEqual(parseBuilderCommand("add floor called Showcase"), { type: "add_floor", name: "Showcase" });
  assert.deepEqual(parseBuilderCommand("add a 6 by 4 meeting room called Orion on floor 2"), {
    type: "add_room", roomType: "meeting", width: 6, depth: 4, name: "Orion", floor: "2",
  });
  assert.deepEqual(parseBuilderCommand("move Orion to 12, -5"), { type: "move_room", name: "Orion", x: 12, z: -5 });
  assert.equal(parseBuilderCommand("make an entire office from a photo"), null);
});