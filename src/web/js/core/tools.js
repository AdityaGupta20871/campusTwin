import { describeRoom, summarizeRoom } from "./model.js";
import { searchRooms } from "./search.js";
import { findRoute, findEmergencyExit, planItinerary, travelSeconds, RouteError, ROUTE_MODES } from "./wayfinding.js";
import { validateLayout } from "./validation.js";
import { spaceMetrics, parseCapacity } from "./metrics.js";
import { validateInput } from "./schema.js";

export class ToolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export const ACTORS = Object.freeze(["human", "agent", "webmcp", "mcp"]);
export const CATEGORIES = Object.freeze(["inspect", "navigate", "present", "validate"]);
export const VIEWS = Object.freeze(["plan", "orbit", "walk"]);

// ---------- Schema fragments ----------
const ROOM_ID = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$",
  description: 'Stable room id, e.g. "3-it". Use search_rooms or list_rooms to discover ids.',
};
const LEVEL = { type: "integer", minimum: -10, maximum: 200, description: "Floor level (0 = ground)." };
const MODE = { type: "string", enum: [...ROUTE_MODES], description: "fastest (default), accessible (lifts only) or stairs." };
const FROM = { ...ROOM_ID, description: "Start room id. Defaults to the user's current location, then Reception." };

const objectSchema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  ...(required.length && { required }),
  additionalProperties: false,
});

function defineTool({ name, title, description, category, readOnly = true, inputSchema = objectSchema(), execute, summarize }) {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) throw new TypeError(`Invalid tool name "${name}".`);
  if (!CATEGORIES.includes(category)) throw new TypeError(`Invalid category for ${name}.`);
  return Object.freeze({ name, title, description, category, readOnly, inputSchema, execute, summarize });
}

/** Route payload for agents: steps and totals, without render geometry. */
const publicRoute = ({ legs, verticals, ...rest }) => rest;
const publicItinerary = ({ legs, verticals, segments, ...rest }) => ({ ...rest, segments: segments.map(publicRoute) });

function wrapRouteErrors(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RouteError) throw new ToolError(err.code, err.message);
    throw err;
  }
}

/** Shared computations reused by core and presentation tools. */
export function createToolContext(model, session) {
  const requireRoom = (id) => {
    const entry = model.getRoom(id);
    if (!entry) throw new ToolError("NOT_FOUND", `No room with id "${id}". Use search_rooms to find valid ids.`);
    return entry;
  };
  const originId = (fromRoomId) => {
    if (fromRoomId) return requireRoom(fromRoomId).id;
    const here = session.getHereId();
    return here && model.hasRoom(here) ? here : model.defaultOriginId;
  };

  const directions = ({ toRoomId, fromRoomId, mode = "fastest" }) => {
    requireRoom(toRoomId);
    return wrapRouteErrors(() => findRoute(model, originId(fromRoomId), toRoomId, { mode }));
  };
  const emergency = ({ fromRoomId }) => wrapRouteErrors(() => findEmergencyExit(model, originId(fromRoomId)));
  const itinerary = ({ stops, workflowId, fromRoomId, mode = "fastest" }) => {
    let stopIds = stops;
    let workflow = null;
    if (workflowId) {
      workflow = model.getWorkflow(workflowId);
      if (!workflow) throw new ToolError("NOT_FOUND", `No workflow with id "${workflowId}".`);
      stopIds = workflow.stops;
    }
    if (!stopIds?.length) throw new ToolError("INVALID_INPUT", "Provide either stops or workflowId.");
    stopIds.forEach(requireRoom);
    const start = fromRoomId || session.getHereId() ? originId(fromRoomId) : null;
    const plan = wrapRouteErrors(() => planItinerary(model, stopIds, { fromId: start, mode }));
    return { ...plan, workflow: workflow && { id: workflow.id, name: workflow.name } };
  };

  return { model, session, requireRoom, originId, directions, emergency, itinerary };
}

// ---------- Core tools (headless; used by browser, WebMCP and MCP server) ----------
export function createCoreTools(ctx) {
  const { model, session, requireRoom, originId } = ctx;
  const typeKeys = Object.keys(model.roomTypes);

  return [
    defineTool({
      name: "get_building_overview",
      title: "Get building overview",
      description: "Inspect the building: floors, room counts, room types, workflows and the user's current location. Call this first.",
      category: "inspect",
      execute: () => {
        const here = session.getHereId();
        return {
          id: model.building.id,
          name: model.building.name,
          footprintM: model.building.footprint,
          floors: model.floors.map((f) => ({ level: f.level, short: f.short, name: f.name, rooms: f.rooms.length })),
          roomTypes: typeKeys.map((t) => ({ type: t, label: model.roomTypes[t].label })),
          workflows: model.workflows.map((w) => ({ id: w.id, name: w.name })),
          currentLocation: here && model.hasRoom(here) ? summarizeRoom(model.getRoom(here)) : null,
          defaultOrigin: model.defaultOriginId,
        };
      },
      summarize: (d) => `${d.floors.length} floors inspected`,
    }),
    defineTool({
      name: "list_rooms",
      title: "List rooms",
      description: "List rooms, optionally filtered by floor level and/or room type.",
      category: "inspect",
      inputSchema: objectSchema({ level: LEVEL, type: { type: "string", enum: typeKeys } }),
      execute: ({ level, type }) => {
        const rooms = model.entries
          .filter((e) => (level === undefined || e.level === level) && (!type || e.typeKey === type))
          .map(summarizeRoom);
        return { count: rooms.length, rooms };
      },
      summarize: (d) => `${d.count} rooms listed`,
    }),
    defineTool({
      name: "get_room",
      title: "Get room details",
      description: "Get full details of one room: floor, size, area, capacity, hours, contact and notes.",
      category: "inspect",
      inputSchema: objectSchema({ roomId: ROOM_ID }, ["roomId"]),
      execute: ({ roomId }) => describeRoom(requireRoom(roomId)),
      summarize: (d) => `Read ${d.name}`,
    }),
    defineTool({
      name: "search_rooms",
      title: "Search rooms",
      description: "Free-text search over room names, types and tags (e.g. 'it helpdesk', 'badge', 'coffee'). Results nearest the user rank first.",
      category: "inspect",
      inputSchema: objectSchema(
        { query: { type: "string", minLength: 1, maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 25 } },
        ["query"]
      ),
      execute: ({ query, limit = 10 }) => {
        const near = model.getRoom(originId());
        const results = searchRooms(model, query, { limit, near }).map(({ entry, score }) => ({ ...summarizeRoom(entry), score }));
        return { query, count: results.length, results };
      },
      summarize: (d) => `${d.count} match(es) for “${d.query}”`,
    }),
    defineTool({
      name: "find_nearest",
      title: "Find nearest facility",
      description: "Find the nearest room of a type (restroom, pantry, lift, stairs, firstaid, meeting…) by travel time from the user.",
      category: "navigate",
      inputSchema: objectSchema({ type: { type: "string", enum: typeKeys }, fromRoomId: FROM, mode: MODE }, ["type"]),
      execute: ({ type, fromRoomId, mode = "fastest" }) => {
        const from = originId(fromRoomId);
        const ranked = model
          .roomsOfType(type)
          .map((e) => ({ e, eta: travelSeconds(model, from, e.id, mode) }))
          .filter((r) => Number.isFinite(r.eta))
          .sort((a, b) => a.eta - b.eta);
        if (!ranked.length) throw new ToolError("NOT_FOUND", `No reachable ${model.roomTypes[type].label.toLowerCase()} found.`);
        return {
          from: summarizeRoom(model.getRoom(from)),
          nearest: { ...describeRoom(ranked[0].e), etaSeconds: ranked[0].eta },
          alternatives: ranked.slice(1, 4).map((r) => ({ ...summarizeRoom(r.e), etaSeconds: r.eta })),
        };
      },
      summarize: (d) => `Nearest: ${d.nearest.name} (${d.nearest.floor})`,
    }),
    defineTool({
      name: "find_meeting_room",
      title: "Find a meeting room",
      description: "Find the best-fitting meeting/training room for a number of people (smallest room that fits, then nearest).",
      category: "navigate",
      inputSchema: objectSchema({ people: { type: "integer", minimum: 1, maximum: 1000 }, level: LEVEL, fromRoomId: FROM }, ["people"]),
      execute: ({ people, level, fromRoomId }) => {
        const from = originId(fromRoomId);
        const ranked = model.entries
          .filter((e) => ["meeting", "training"].includes(e.typeKey) && (level === undefined || e.level === level))
          .map((e) => ({ e, cap: parseCapacity(e.room.capacity), eta: travelSeconds(model, from, e.id) }))
          .filter((r) => r.cap >= people)
          .sort((a, b) => a.cap - b.cap || a.eta - b.eta);
        if (!ranked.length) throw new ToolError("NOT_FOUND", `No room seats ${people} people${level === undefined ? "" : ` on level ${level}`}.`);
        const view = (r) => ({ ...summarizeRoom(r.e), capacity: r.cap, etaSeconds: r.eta });
        return { people, best: view(ranked[0]), alternatives: ranked.slice(1, 4).map(view) };
      },
      summarize: (d) => `${d.best.name} fits ${d.people}`,
    }),
    defineTool({
      name: "get_directions",
      title: "Get directions",
      description: "Turn-by-turn indoor directions between two rooms with distance and ETA. Does not change the map.",
      category: "navigate",
      inputSchema: objectSchema({ toRoomId: ROOM_ID, fromRoomId: FROM, mode: MODE }, ["toRoomId"]),
      execute: (args) => publicRoute(ctx.directions(args)),
      summarize: (d) => `${d.from.name} → ${d.to.name}`,
    }),
    defineTool({
      name: "get_emergency_exit",
      title: "Get emergency exit",
      description: "Nearest fire-exit staircase and evacuation steps from a room. Never routes via lifts.",
      category: "navigate",
      inputSchema: objectSchema({ fromRoomId: FROM }),
      execute: (args) => publicRoute(ctx.emergency(args)),
      summarize: (d) => `Exit via ${d.to.name}`,
    }),
    defineTool({
      name: "list_workflows",
      title: "List workflows",
      description: "List predefined multi-stop journeys (e.g. new-joiner day 1, visitor journey).",
      category: "inspect",
      execute: () => ({
        workflows: model.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          stops: w.stops.filter(model.hasRoom).map((id) => summarizeRoom(model.getRoom(id))),
        })),
      }),
      summarize: (d) => `${d.workflows.length} workflows`,
    }),
    defineTool({
      name: "plan_itinerary",
      title: "Plan itinerary",
      description: "Plan an ordered multi-stop route from explicit room ids or a predefined workflowId. Does not change the map.",
      category: "navigate",
      inputSchema: objectSchema({
        stops: { type: "array", items: ROOM_ID, minItems: 1, maxItems: 8 },
        workflowId: { type: "string", pattern: "^[a-z0-9-]{1,64}$" },
        fromRoomId: FROM,
        mode: MODE,
      }),
      execute: (args) => publicItinerary(ctx.itinerary(args)),
      summarize: (d) => `${d.stops.length} stops planned`,
    }),
    defineTool({
      name: "set_my_location",
      title: "Set my location",
      description: "Set the user's current location ('You are here'). Subsequent directions start from here.",
      category: "navigate",
      readOnly: false,
      inputSchema: objectSchema({ roomId: ROOM_ID }, ["roomId"]),
      execute: ({ roomId }) => {
        const entry = requireRoom(roomId);
        session.setHereId(entry.id);
        return { location: summarizeRoom(entry) };
      },
      summarize: (d) => `You are at ${d.location.name}`,
    }),
    defineTool({
      name: "validate_layout",
      title: "Validate layout",
      description: "Run layout checks: duplicate ids, overlaps, rooms outside footprint, fire exits per floor, lifts, restrooms, first aid, workflow integrity.",
      category: "validate",
      execute: () => validateLayout(model),
      summarize: (d) => `${d.summary.errors} error(s), ${d.summary.warnings} warning(s)`,
    }),
    defineTool({
      name: "get_space_metrics",
      title: "Get space metrics",
      description: "Gross/net area (m²), utilisation, workstation and meeting-seat counts — for the building or one floor.",
      category: "validate",
      inputSchema: objectSchema({ level: LEVEL }),
      execute: ({ level }) => {
        if (level !== undefined && !model.getFloor(level)) throw new ToolError("NOT_FOUND", `No floor at level ${level}.`);
        return spaceMetrics(model, level ?? null);
      },
      summarize: (d) => `${d.totals.netAreaM2} m² net across ${d.totals.floors} floor(s)`,
    }),
  ];
}

// ---------- Presentation tools (browser only; drive the live 2D/3D canvas) ----------
export function createPresentationTools(ctx, presenter) {
  const { model, requireRoom } = ctx;
  return [
    defineTool({
      name: "get_view_state",
      title: "Get view state",
      description: "Inspect what the user currently sees: view mode, active floor, selected room, location and active route.",
      category: "inspect",
      execute: () => presenter.getState(),
      summarize: (d) => `View: ${d.view}`,
    }),
    defineTool({
      name: "switch_view",
      title: "Switch view",
      description: "Switch the canvas between 2D floor plan, 3D orbit and first-person walk mode.",
      category: "present",
      readOnly: false,
      inputSchema: objectSchema({ view: { type: "string", enum: [...VIEWS] } }, ["view"]),
      execute: ({ view }) => {
        presenter.setView(view);
        return { view };
      },
      summarize: (d) => `Switched to ${d.view}`,
    }),
    defineTool({
      name: "set_active_floor",
      title: "Set active floor",
      description: "Isolate one floor on the canvas, or pass null to show all floors.",
      category: "present",
      readOnly: false,
      inputSchema: objectSchema({ level: { ...LEVEL, type: ["integer", "null"] } }, ["level"]),
      execute: ({ level }) => {
        if (level !== null && !model.getFloor(level)) throw new ToolError("NOT_FOUND", `No floor at level ${level}.`);
        presenter.setActiveFloor(level);
        return { level, floor: level === null ? "All floors" : model.getFloor(level).name };
      },
      summarize: (d) => `Showing ${d.floor}`,
    }),
    defineTool({
      name: "focus_room",
      title: "Focus room",
      description: "Select a room, fly the camera to it and open its details for the user.",
      category: "present",
      readOnly: false,
      inputSchema: objectSchema({ roomId: ROOM_ID }, ["roomId"]),
      execute: ({ roomId }) => {
        const entry = requireRoom(roomId);
        presenter.focusRoom(entry.id);
        return describeRoom(entry);
      },
      summarize: (d) => `Focused ${d.name}`,
    }),
    defineTool({
      name: "navigate_to",
      title: "Navigate to room",
      description: "Compute directions and draw the route on the user's map (2D and 3D), then focus the destination.",
      category: "present",
      readOnly: false,
      inputSchema: objectSchema({ toRoomId: ROOM_ID, fromRoomId: FROM, mode: MODE }, ["toRoomId"]),
      execute: (args) => {
        const route = ctx.directions(args);
        presenter.showRoute(route, { kind: "route", title: `${route.from.name} → ${route.to.name}` });
        return publicRoute(route);
      },
      summarize: (d) => `Route ${d.from.name} → ${d.to.name}`,
    }),
    defineTool({
      name: "show_emergency_exit",
      title: "Show emergency exit",
      description: "Draw the evacuation route to the nearest fire-exit staircase on the user's map.",
      category: "present",
      readOnly: false,
      inputSchema: objectSchema({ fromRoomId: FROM }),
      execute: (args) => {
        const route = ctx.emergency(args);
        presenter.showRoute(route, { kind: "emergency", title: `Evacuate via ${route.to.name}` });
        return publicRoute(route);
      },
      summarize: (d) => `Evacuate via ${d.to.name}`,
    }),
    defineTool({
      name: "show_itinerary",
      title: "Show itinerary",
      description: "Draw a multi-stop journey (explicit stops or a workflowId) on the user's map.",
      category: "present",
      readOnly: false,
      inputSchema: objectSchema({
        stops: { type: "array", items: ROOM_ID, minItems: 1, maxItems: 8 },
        workflowId: { type: "string", pattern: "^[a-z0-9-]{1,64}$" },
        fromRoomId: FROM,
        mode: MODE,
      }),
      execute: (args) => {
        const plan = ctx.itinerary(args);
        presenter.showRoute(plan, { kind: "itinerary", title: plan.workflow?.name ?? `${plan.stops.length}-stop itinerary` });
        return publicItinerary(plan);
      },
      summarize: (d) => `${d.stops.length}-stop itinerary shown`,
    }),
    defineTool({
      name: "clear_map",
      title: "Clear map",
      description: "Clear the selection and any drawn route.",
      category: "present",
      readOnly: false,
      execute: () => {
        presenter.clear();
        return { cleared: true };
      },
      summarize: () => "Map cleared",
    }),
  ];
}

// ---------- Executor: one pipeline for humans, the built-in agent, WebMCP and MCP ----------
export function createToolExecutor(tools, { onEvent = () => {}, now = () => Date.now() } = {}) {
  const byName = new Map();
  for (const t of tools) {
    if (byName.has(t.name)) throw new TypeError(`Duplicate tool name "${t.name}".`);
    byName.set(t.name, t);
  }
  let seq = 0;

  async function execute(name, args = {}, { actor = "human" } = {}) {
    const id = ++seq;
    const started = now();
    const tool = byName.get(name);
    const input = args ?? {};
    const emit = (extra) =>
      onEvent({ id, tool: name, actor, args: input, category: tool?.category ?? null, readOnly: tool?.readOnly ?? null, durationMs: now() - started, ...extra });

    try {
      if (!ACTORS.includes(actor)) throw new ToolError("INVALID_ACTOR", `Unknown actor "${actor}".`);
      if (!tool) throw new ToolError("UNKNOWN_TOOL", `Unknown tool "${name}".`);
      const errors = validateInput(tool.inputSchema, input);
      if (errors.length) throw new ToolError("INVALID_INPUT", `Invalid input for ${name}: ${errors.join("; ")}`, errors);
      const data = await tool.execute(input);
      emit({ ok: true, summary: tool.summarize?.(data, input) ?? "Done" });
      return { ok: true, data };
    } catch (err) {
      const known = err instanceof ToolError;
      const error = known
        ? { code: err.code, message: err.message, ...(err.details && { details: err.details }) }
        : { code: "INTERNAL_ERROR", message: `Unexpected error while running ${name}.` };
      emit({ ok: false, summary: error.message, error, ...(known ? {} : { cause: err }) });
      return { ok: false, error };
    }
  }

  return {
    execute,
    get: (name) => byName.get(name) ?? null,
    list: () => [...byName.values()],
  };
}
