import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateInput } from "../../src/web/js/core/schema.js";
import { listToolCatalog } from "../../src/packages/core/dist/index.js";
import { makeRuntime, makePresenter, createMemorySession } from "../helpers/fixtures.mjs";

describe("schema validator", () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^[a-z]+$", maxLength: 5 },
      n: { type: "integer", minimum: 1, maximum: 3 },
      level: { type: ["integer", "null"] },
      list: { type: "array", items: { type: "string" }, maxItems: 2 },
      mode: { type: "string", enum: ["a", "b"] },
    },
    required: ["id"],
    additionalProperties: false,
  };

  test("accepts valid input", () => {
    assert.deepEqual(validateInput(schema, { id: "abc", n: 2, level: null, list: ["x"], mode: "a" }), []);
  });

  test("reports every violation", () => {
    const errors = validateInput(schema, { n: 9, level: "x", list: [1, 2, 3], mode: "z", extra: true });
    const joined = errors.join("|");
    for (const part of ["$.id is required", "$.n must be <= 3", "$.level must be integer or null", "at most 2", "$.list[0] must be string", "one of", "$.extra is not allowed"]) {
      assert.ok(joined.includes(part), part);
    }
  });

  test("rejects non-objects and bad patterns", () => {
    assert.deepEqual(validateInput(schema, "str"), ["$ must be object"]);
    assert.ok(validateInput(schema, { id: "ABC!" }).some((e) => e.includes("invalid format")));
    assert.ok(validateInput(schema, { id: "abcdefg" }).some((e) => e.includes("longer")));
  });
});

describe("tool catalog", () => {
  const catalog = listToolCatalog();

  test("has unique snake_case names, categories and object schemas", () => {
    const names = catalog.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const t of catalog) {
      assert.match(t.name, /^[a-z][a-z0-9_]+$/);
      assert.ok(["inspect", "navigate", "present", "validate"].includes(t.category));
      assert.equal(t.inputSchema.type, "object");
      assert.equal(t.inputSchema.additionalProperties, false);
      assert.ok(t.description.length > 20, `${t.name} needs a useful description`);
    }
  });

  test("read-only annotation is accurate for mutating tools", () => {
    const mutating = catalog.filter((t) => !t.readOnly).map((t) => t.name).sort();
    assert.deepEqual(mutating, ["clear_map", "focus_room", "navigate_to", "set_active_floor", "set_my_location", "show_emergency_exit", "show_itinerary", "switch_view"]);
  });
});

describe("tool executor", () => {
  test("returns ok envelopes and emits attributed events", async () => {
    const { executor, events } = makeRuntime();
    const res = await executor.execute("get_room", { roomId: "3-it" }, { actor: "mcp" });
    assert.equal(res.ok, true);
    assert.equal(res.data.name, "IT Helpdesk");
    assert.equal(events.at(-1).actor, "mcp");
    assert.equal(events.at(-1).ok, true);
    assert.equal(events.at(-1).summary, "Read IT Helpdesk");
  });

  test("validates input at the boundary", async () => {
    const { executor } = makeRuntime();
    const res = await executor.execute("get_room", { roomId: "../../etc/passwd" });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "INVALID_INPUT");
    const extra = await executor.execute("get_room", { roomId: "3-it", evil: 1 });
    assert.equal(extra.error.code, "INVALID_INPUT");
  });

  test("unknown tools, rooms and actors return typed errors", async () => {
    const { executor } = makeRuntime();
    assert.equal((await executor.execute("rm_rf", {})).error.code, "UNKNOWN_TOOL");
    assert.equal((await executor.execute("get_room", { roomId: "nope" })).error.code, "NOT_FOUND");
    assert.equal((await executor.execute("get_room", { roomId: "3-it" }, { actor: "root" })).error.code, "INVALID_ACTOR");
  });

  test("internal errors are masked", async () => {
    const { executor, events } = makeRuntime({ session: { getHereId: () => { throw new Error("secret stack"); }, setHereId() {} } });
    const res = await executor.execute("get_building_overview", {});
    assert.equal(res.error.code, "INTERNAL_ERROR");
    assert.ok(!res.error.message.includes("secret"));
    assert.ok(events.at(-1).cause instanceof Error);
  });

  test("session location drives the default origin", async () => {
    const session = createMemorySession();
    const { executor } = makeRuntime({ session });
    await executor.execute("set_my_location", { roomId: "2-meet-1" });
    const res = await executor.execute("get_directions", { toRoomId: "2-pantry" });
    assert.equal(res.data.from.id, "2-meet-1");
    assert.equal(res.data.legs, undefined, "render geometry is not exposed to agents");
  });

  test("find_nearest, find_meeting_room and plan_itinerary", async () => {
    const { executor } = makeRuntime({ session: createMemorySession("2-bay-a") });
    const near = await executor.execute("find_nearest", { type: "restroom" });
    assert.equal(near.data.nearest.id, "2-restrooms");
    const room = await executor.execute("find_meeting_room", { people: 12 });
    assert.equal(room.data.best.id, "3-boardroom");
    const none = await executor.execute("find_meeting_room", { people: 999 });
    assert.equal(none.error.code, "NOT_FOUND");
    const wf = await executor.execute("plan_itinerary", { workflowId: "new-joiner" });
    assert.equal(wf.data.workflow.name, "New joiner – Day 1");
    const empty = await executor.execute("plan_itinerary", {});
    assert.equal(empty.error.code, "INVALID_INPUT");
  });

  test("presentation tools drive the presenter", async () => {
    const presenter = makePresenter();
    const { executor } = makeRuntime({ presenter });
    await executor.execute("switch_view", { view: "walk" });
    await executor.execute("set_active_floor", { level: null });
    await executor.execute("navigate_to", { toRoomId: "3-it" });
    await executor.execute("show_emergency_exit", {});
    assert.deepEqual(presenter.calls.map((c) => c[0]), ["setView", "setActiveFloor", "showRoute", "showRoute"]);
    assert.equal((await executor.execute("set_active_floor", { level: 42 })).error.code, "NOT_FOUND");
    assert.equal((await executor.execute("switch_view", { view: "vr" })).error.code, "INVALID_INPUT");
  });
});
