import { building as defaultBuilding, roomTypes as defaultRoomTypes } from "../data/building-data.js";
import { createModel } from "./model.js";
import { createToolContext, createCoreTools, createPresentationTools, createToolExecutor } from "./tools.js";

export function createMemorySession(initialHereId = null) {
  let hereId = initialHereId;
  return {
    getHereId: () => hereId,
    setHereId: (id) => {
      hereId = id;
    },
  };
}

/**
 * Composition root: model + session + typed tools + executor.
 * Pass a `presenter` (browser) to add canvas tools; omit it for headless use (MCP server, tests).
 */
export function createRuntime({
  building = defaultBuilding,
  roomTypes = defaultRoomTypes,
  session = createMemorySession(),
  presenter = null,
  onEvent,
} = {}) {
  const model = createModel(building, roomTypes);
  const ctx = createToolContext(model, session);
  const tools = [...createCoreTools(ctx), ...(presenter ? createPresentationTools(ctx, presenter) : [])];
  const executor = createToolExecutor(tools, { onEvent });
  return { model, session, executor };
}

const NOOP_PRESENTER = Object.freeze({
  getState: () => ({}),
  setView() {},
  setActiveFloor() {},
  focusRoom() {},
  showRoute() {},
  clear() {},
});

/** Metadata for every tool (core + presentation) — used for docs and the landing page catalog. */
export function listToolCatalog() {
  return createRuntime({ presenter: NOOP_PRESENTER })
    .executor.list()
    .map(({ name, title, description, category, readOnly, inputSchema }) => ({ name, title, description, category, readOnly, inputSchema }));
}
