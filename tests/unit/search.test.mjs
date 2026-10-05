import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createModel, searchRooms, normalizeText, scoreEntry } from "../../src/packages/core/dist/index.js";
import { cloneBuilding, roomTypes } from "../helpers/fixtures.mjs";

const model = createModel(cloneBuilding(), roomTypes);

describe("search", () => {
  test("normalizeText strips punctuation and case but keeps dots", () => {
    assert.equal(normalizeText("  Meeting Room 2.01! "), "meeting room 2.01");
    assert.equal(normalizeText("HR & Admin"), "hr admin");
  });

  test("exact name ranks first", () => {
    const [top] = searchRooms(model, "IT Helpdesk");
    assert.equal(top.entry.id, "3-it");
    assert.equal(top.score, 95);
  });

  test("matches tags", () => {
    assert.equal(searchRooms(model, "badge")[0].entry.id, "g-reception");
    assert.equal(searchRooms(model, "laptop")[0].entry.id, "3-it");
  });

  test("prefers rooms nearest the user when scores tie", () => {
    const near = model.getRoom("2-bay-a");
    const [top] = searchRooms(model, "restrooms", { near });
    assert.equal(top.entry.level, 2);
  });

  test("filters by type and respects limit", () => {
    const res = searchRooms(model, "room", { types: ["meeting"], limit: 3 });
    assert.ok(res.length <= 3);
    assert.ok(res.every((r) => r.entry.typeKey === "meeting"));
  });

  test("returns nothing for empty or unknown queries", () => {
    assert.equal(searchRooms(model, "   ").length, 0);
    assert.equal(searchRooms(model, "helicopter pad").length, 0);
    assert.equal(scoreEntry(model.getRoom("3-it"), ""), 0);
  });
});
