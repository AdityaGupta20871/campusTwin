import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerWebMcpTools, getModelContext } from "../../src/web/js/app/webmcp.js";
import { makeRuntime, makePresenter } from "../helpers/fixtures.mjs";

describe("WebMCP bridge", () => {
  test("reports unsupported when no model context exists", () => {
    const { executor } = makeRuntime();
    assert.deepEqual(registerWebMcpTools(executor, { modelContext: null }), { supported: false, registered: 0 });
    assert.equal(getModelContext({ navigator: {}, document: {} }), null);
  });

  test("registers every tool via registerTool and executes as the webmcp actor", async () => {
    const registered = [];
    const { executor, events } = makeRuntime({ presenter: makePresenter() });
    const res = registerWebMcpTools(executor, { modelContext: { registerTool: (d) => registered.push(d) } });
    assert.equal(res.registered, executor.list().length);
    const nav = registered.find((d) => d.name === "navigate_to");
    assert.equal(nav.annotations.readOnlyHint, false);
    const out = await nav.execute({ toRoomId: "3-it" });
    assert.equal(out.isError, false);
    assert.equal(JSON.parse(out.content[0].text).to.id, "3-it");
    assert.equal(events.at(-1).actor, "webmcp");
  });

  test("falls back to provideContext and surfaces tool errors in-band", async () => {
    let provided;
    const { executor } = makeRuntime();
    registerWebMcpTools(executor, { modelContext: { provideContext: (ctx) => (provided = ctx) } });
    const getRoom = provided.tools.find((t) => t.name === "get_room");
    const out = await getRoom.execute({ roomId: "nope" });
    assert.equal(out.isError, true);
    assert.equal(JSON.parse(out.content[0].text).error.code, "NOT_FOUND");
  });

  test("one rejected definition does not block the others", () => {
    const { executor } = makeRuntime();
    let n = 0;
    const res = registerWebMcpTools(executor, {
      modelContext: {
        registerTool: () => {
          if (n++ === 0) throw new Error("dup");
        },
      },
    });
    assert.equal(res.registered, executor.list().length - 1);
  });
});
