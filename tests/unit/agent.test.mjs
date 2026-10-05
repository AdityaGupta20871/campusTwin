import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createConciergeAgent, extractTarget, MAX_MESSAGE_LENGTH } from "../../src/packages/core/dist/index.js";
import { makeRuntime, makePresenter, createMemorySession } from "../helpers/fixtures.mjs";

function setup({ presentation = true, here = null } = {}) {
  const session = createMemorySession(here);
  const presenter = presentation ? makePresenter() : null;
  const rt = makeRuntime({ session, presenter });
  const agent = createConciergeAgent({ model: rt.model, executor: rt.executor, presentation, getHereId: session.getHereId });
  return { ...rt, agent, presenter, session };
}

const tools = (res) => res.trace.map((t) => t.tool);

describe("concierge agent", () => {
  test("extractTarget strips conversational lead-ins", () => {
    assert.equal(extractTarget("where is the it helpdesk?"), "it helpdesk");
    assert.equal(extractTarget("how do i get to the board room"), "board room");
    assert.equal(extractTarget("please take me to hr"), "hr");
  });

  const cases = [
    ["Where is the IT helpdesk?", "navigate", ["search_rooms", "navigate_to"], "3-it"],
    ["Nearest restroom", "navigate", ["find_nearest", "navigate_to"], "g-restrooms"],
    ["Find a room for 12 people", "meeting_room", ["find_meeting_room", "navigate_to"], "3-boardroom"],
    ["Fire! Get me out", "emergency", ["show_emergency_exit"], null],
    ["What's on floor 3?", "floor", ["set_active_floor", "list_rooms"], null],
    ["Switch to walk mode", "switch_view", ["switch_view"], null],
    ["Validate the layout", "validate", ["validate_layout"], null],
    ["It's my first day", "workflow", ["show_itinerary"], null],
    ["How many desks are there?", "metrics", ["get_space_metrics"], null],
    ["hello", "help", [], null],
    ["coffee", "navigate", ["find_nearest", "navigate_to"], null],
  ];

  for (const [message, intent, expectedTools, focus] of cases) {
    test(`“${message}” → ${intent}`, async () => {
      const { agent } = setup();
      const res = await agent.respond(message);
      assert.equal(res.intent, intent);
      assert.deepEqual(tools(res), expectedTools);
      assert.ok(res.trace.every((t) => t.ok), JSON.stringify(res.trace));
      assert.ok(res.reply.text.length > 0);
      if (focus) assert.equal(res.reply.focus, focus);
    });
  }

  test("set location then route from there", async () => {
    const { agent, session } = setup();
    const set = await agent.respond("I'm at Meeting Room 2.01");
    assert.equal(set.intent, "set_location");
    assert.equal(session.getHereId(), "2-meet-1");
    const route = await agent.respond("nearest pantry");
    assert.equal(route.reply.focus, "2-pantry");
  });

  test("from X to Y routes between two named rooms", async () => {
    const { agent } = setup();
    const res = await agent.respond("from the cafeteria to the town hall");
    assert.equal(res.trace.at(-1).args.fromRoomId, "g-cafeteria");
    assert.equal(res.reply.focus, "3-townhall");
  });

  test("headless mode uses read-only tools only", async () => {
    const { agent, executor } = setup({ presentation: false });
    for (const msg of ["Where is HR?", "fire", "It's my first day"]) {
      const res = await agent.respond(msg);
      for (const t of res.trace) assert.equal(executor.get(t.tool).readOnly, true, `${msg} → ${t.tool}`);
    }
  });

  test("unknown targets fail gracefully with suggestions", async () => {
    const { agent } = setup();
    const res = await agent.respond("helicopter pad");
    assert.equal(res.intent, "navigate");
    assert.ok(res.reply.suggestions.length > 0);
  });

  test("rejects oversized messages without calling tools", async () => {
    const { agent } = setup();
    const res = await agent.respond("x".repeat(MAX_MESSAGE_LENGTH + 1));
    assert.equal(res.intent, "rejected");
    assert.equal(res.trace.length, 0);
  });
});
