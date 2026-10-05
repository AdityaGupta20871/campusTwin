import { building, roomTypes } from "../../src/web/js/data/building-data.js";
import { createRuntime, createMemorySession } from "../../src/packages/core/dist/index.js";

/** Deep-cloned sample building so tests can mutate freely. */
export const cloneBuilding = () => structuredClone(building);

export { roomTypes };

export function makeRuntime(options = {}) {
  const events = [];
  const runtime = createRuntime({ onEvent: (e) => events.push(e), ...options });
  return { ...runtime, events };
}

export function makePresenter() {
  const calls = [];
  const state = { view: "orbit", activeLevel: null, selectedRoomId: null, route: null };
  return {
    calls,
    getState: () => ({ ...state }),
    setView: (view) => calls.push(["setView", view]) && (state.view = view),
    setActiveFloor: (level) => calls.push(["setActiveFloor", level]) && (state.activeLevel = level),
    focusRoom: (id) => calls.push(["focusRoom", id]) && (state.selectedRoomId = id),
    showRoute: (route, meta) => calls.push(["showRoute", meta.kind]) && (state.route = meta.title),
    clear: () => calls.push(["clear"]),
  };
}

export { createMemorySession };
