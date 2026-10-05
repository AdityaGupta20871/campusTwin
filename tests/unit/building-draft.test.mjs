import assert from "node:assert/strict";
import test from "node:test";
import { building } from "../../src/web/js/data/building-data.js";
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