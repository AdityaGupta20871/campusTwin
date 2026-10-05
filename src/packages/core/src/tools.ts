import { z } from "zod";
import { describeRoom, summarizeRoom, type BuildingModel, type ModelEntry } from "./model.js";
import { searchRooms } from "./search.js";
import {
  findEmergencyExit,
  findRoute,
  planItinerary,
  ROUTE_MODES,
  RouteError,
  travelSeconds,
  type Itinerary,
  type Route,
  type RouteMode,
} from "./wayfinding.js";
import { validateLayout } from "./validation.js";
import { parseCapacity, spaceMetrics } from "./metrics.js";

export const ACTORS = Object.freeze(["human", "agent", "webmcp", "mcp"] as const);
export const CATEGORIES = Object.freeze(["inspect", "navigate", "present", "validate"] as const);
export const VIEWS = Object.freeze(["plan", "orbit", "walk"] as const);

export type Actor = (typeof ACTORS)[number];
export type ToolCategory = (typeof CATEGORIES)[number];
export type ViewMode = (typeof VIEWS)[number];
export type ToolErrorCode = "INVALID_ACTOR" | "UNKNOWN_TOOL" | "INVALID_INPUT" | "NOT_FOUND" | "INTERNAL_ERROR" | RouteError["code"];

export class ToolError extends Error {
  constructor(public readonly code: ToolErrorCode, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolEvent {
  id: number;
  tool: string;
  actor: string;
  args: unknown;
  category: ToolCategory | null;
  readOnly: boolean | null;
  durationMs: number;
  ok: boolean;
  summary: string;
  error?: { code: string; message: string; details?: unknown };
  cause?: unknown;
}

export interface JsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  readOnly: boolean;
  inputSchema: JsonSchema;
  validator: z.ZodType;
  execute(args: unknown): unknown;
  summarize?(data: unknown, args: unknown): string;
}

export type ToolExecutionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface ToolSession {
  getHereId(): string | null;
  setHereId(id: string): void;
}

export interface DirectionsInput {
  toRoomId: string;
  fromRoomId?: string;
  mode?: RouteMode;
}

export interface EmergencyInput {
  fromRoomId?: string;
}

export interface ItineraryInput extends EmergencyInput {
  stops?: string[];
  workflowId?: string;
  mode?: RouteMode;
}

export type ItineraryWithWorkflow = Itinerary & {
  workflow: { id: string; name: string } | null;
};

export interface ToolContext {
  model: Readonly<BuildingModel>;
  session: ToolSession;
  requireRoom(id: string): ModelEntry;
  originId(fromRoomId?: string): string | null;
  directions(input: DirectionsInput): Route;
  emergency(input: EmergencyInput): ReturnType<typeof findEmergencyExit>;
  itinerary(input: ItineraryInput): ItineraryWithWorkflow;
}

export interface Presenter {
  getState(): Record<string, unknown>;
  setView(view: ViewMode): void;
  setActiveFloor(level: number | null): void;
  focusRoom(id: string): void;
  showRoute(route: Route | ItineraryWithWorkflow, metadata: { kind: "route" | "emergency" | "itinerary"; title: string }): void;
  clear(): void;
}

interface ToolConfig<Schema extends z.ZodType, Output> {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  readOnly?: boolean;
  schema: Schema;
  execute(args: z.output<Schema>): Output;
  summarize?(data: Awaited<Output>, args: z.output<Schema>): string;
}

function defineTool<Schema extends z.ZodType, Output>(config: ToolConfig<Schema, Output>): ToolDefinition {
  const { name, title, description, category, readOnly = true, schema, execute, summarize } = config;
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) throw new TypeError(`Invalid tool name "${name}".`);
  if (!CATEGORIES.includes(category)) throw new TypeError(`Invalid category for ${name}.`);

  return Object.freeze({
    name,
    title,
    description,
    category,
    readOnly,
    inputSchema: z.toJSONSchema(schema) as JsonSchema,
    validator: schema,
    execute: (args: unknown) => execute(args as z.output<Schema>),
    ...(summarize && {
      summarize: (data: unknown, args: unknown) => summarize(data as Awaited<Output>, args as z.output<Schema>),
    }),
  });
}

const EMPTY_INPUT = z.strictObject({});
const ROOM_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u).describe('Stable room id, e.g. "3-it". Use search_rooms or list_rooms to discover ids.');
const LEVEL = z.number().int().min(-10).max(200).describe("Floor level (0 = ground).");
const MODE = z.enum(ROUTE_MODES).describe("fastest (default), accessible (lifts only) or stairs.");
const FROM = ROOM_ID.describe("Start room id. Defaults to the user's current location, then Reception.");

function publicRoute<T extends Route>(route: T): Omit<T, "legs" | "verticals"> {
  const { legs: _legs, verticals: _verticals, ...publicData } = route;
  return publicData;
}

function publicItinerary({ legs: _legs, verticals: _verticals, segments, ...publicData }: ItineraryWithWorkflow) {
  return { ...publicData, segments: segments.map(publicRoute) };
}

function wrapRouteErrors<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof RouteError) throw new ToolError(error.code, error.message);
    throw error;
  }
}

export function createToolContext(model: Readonly<BuildingModel>, session: ToolSession): ToolContext {
  const requireRoom = (id: string): ModelEntry => {
    const entry = model.getRoom(id);
    if (!entry) throw new ToolError("NOT_FOUND", `No room with id "${id}". Use search_rooms to find valid ids.`);
    return entry;
  };

  const originId = (fromRoomId?: string): string | null => {
    if (fromRoomId) return requireRoom(fromRoomId).id;
    const here = session.getHereId();
    return here && model.hasRoom(here) ? here : model.defaultOriginId;
  };

  const directions = ({ toRoomId, fromRoomId, mode = "fastest" }: DirectionsInput): Route => {
    requireRoom(toRoomId);
    return wrapRouteErrors(() => findRoute(model, originId(fromRoomId), toRoomId, { mode }));
  };

  const emergency = ({ fromRoomId }: EmergencyInput) => wrapRouteErrors(() => findEmergencyExit(model, originId(fromRoomId)));

  const itinerary = ({ stops, workflowId, fromRoomId, mode = "fastest" }: ItineraryInput): ItineraryWithWorkflow => {
    let stopIds = stops;
    let workflow = null;
    if (workflowId) {
      workflow = model.getWorkflow(workflowId);
      if (!workflow) throw new ToolError("NOT_FOUND", `No workflow with id "${workflowId}".`);
      stopIds = [...workflow.stops];
    }
    if (!stopIds?.length) throw new ToolError("INVALID_INPUT", "Provide either stops or workflowId.");
    stopIds.forEach(requireRoom);
    const start = fromRoomId || session.getHereId() ? originId(fromRoomId) : null;
    const plan = wrapRouteErrors(() => planItinerary(model, stopIds, { fromId: start, mode }));
    return { ...plan, workflow: workflow && { id: workflow.id, name: workflow.name } };
  };

  return { model, session, requireRoom, originId, directions, emergency, itinerary };
}

export function createCoreTools(context: ToolContext): ToolDefinition[] {
  const { model, session, requireRoom, originId } = context;
  const typeKeys = Object.keys(model.roomTypes);
  const roomType = z.enum(typeKeys as [string, ...string[]]);

  return [
    defineTool({
      name: "get_building_overview",
      title: "Get building overview",
      description: "Inspect the building: floors, room counts, room types, workflows and the user's current location. Call this first.",
      category: "inspect",
      schema: EMPTY_INPUT,
      execute: () => {
        const here = session.getHereId();
        const hereEntry = here ? model.getRoom(here) : null;
        return {
          id: model.building.id,
          name: model.building.name,
          footprintM: model.building.footprint,
          floors: model.floors.map((floor) => ({ level: floor.level, short: floor.short, name: floor.name, rooms: floor.rooms.length })),
          roomTypes: typeKeys.map((type) => ({ type, label: model.roomTypes[type].label })),
          workflows: model.workflows.map((workflow) => ({ id: workflow.id, name: workflow.name })),
          currentLocation: hereEntry ? summarizeRoom(hereEntry) : null,
          defaultOrigin: model.defaultOriginId,
        };
      },
      summarize: (data) => `${data.floors.length} floors inspected`,
    }),
    defineTool({
      name: "list_rooms",
      title: "List rooms",
      description: "List rooms, optionally filtered by floor level and/or room type.",
      category: "inspect",
      schema: z.strictObject({ level: LEVEL.optional(), type: roomType.optional() }),
      execute: ({ level, type }) => {
        const rooms = model.entries
          .filter((entry) => (level === undefined || entry.level === level) && (!type || entry.typeKey === type))
          .map(summarizeRoom);
        return { count: rooms.length, rooms };
      },
      summarize: (data) => `${data.count} rooms listed`,
    }),
    defineTool({
      name: "get_room",
      title: "Get room details",
      description: "Get full details of one room: floor, size, area, capacity, hours, contact and notes.",
      category: "inspect",
      schema: z.strictObject({ roomId: ROOM_ID }),
      execute: ({ roomId }) => describeRoom(requireRoom(roomId)),
      summarize: (data) => `Read ${data.name}`,
    }),
    defineTool({
      name: "search_rooms",
      title: "Search rooms",
      description: "Free-text search over room names, types and tags (e.g. 'it helpdesk', 'badge', 'coffee'). Results nearest the user rank first.",
      category: "inspect",
      schema: z.strictObject({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(25).optional() }),
      execute: ({ query, limit = 10 }) => {
        const near = model.getRoom(originId() ?? "");
        const results = searchRooms(model, query, { limit, near }).map(({ entry, score }) => ({ ...summarizeRoom(entry), score }));
        return { query, count: results.length, results };
      },
      summarize: (data) => `${data.count} match(es) for “${data.query}”`,
    }),
    defineTool({
      name: "find_nearest",
      title: "Find nearest facility",
      description: "Find the nearest room of a type (restroom, pantry, lift, stairs, firstaid, meeting…) by travel time from the user.",
      category: "navigate",
      schema: z.strictObject({ type: roomType, fromRoomId: FROM.optional(), mode: MODE.optional() }),
      execute: ({ type, fromRoomId, mode = "fastest" }) => {
        const from = originId(fromRoomId);
        const ranked = model
          .roomsOfType(type)
          .map((entry) => ({ entry, eta: travelSeconds(model, from, entry.id, mode) }))
          .filter((candidate) => Number.isFinite(candidate.eta))
          .sort((first, second) => first.eta - second.eta);
        if (!ranked.length) throw new ToolError("NOT_FOUND", `No reachable ${model.roomTypes[type].label.toLowerCase()} found.`);
        const [best, ...alternatives] = ranked;
        return {
          from: summarizeRoom(model.getRoom(from ?? "")!),
          nearest: { ...describeRoom(best.entry), etaSeconds: best.eta },
          alternatives: alternatives.slice(0, 3).map(({ entry, eta }) => ({ ...summarizeRoom(entry), etaSeconds: eta })),
        };
      },
      summarize: (data) => `Nearest: ${data.nearest.name} (${data.nearest.floor})`,
    }),
    defineTool({
      name: "find_meeting_room",
      title: "Find a meeting room",
      description: "Find the best-fitting meeting/training room for a number of people (smallest room that fits, then nearest).",
      category: "navigate",
      schema: z.strictObject({ people: z.number().int().min(1).max(1000), level: LEVEL.optional(), fromRoomId: FROM.optional() }),
      execute: ({ people, level, fromRoomId }) => {
        const from = originId(fromRoomId);
        const ranked = model.entries
          .filter((entry) => ["meeting", "training"].includes(entry.typeKey) && (level === undefined || entry.level === level))
          .map((entry) => ({ entry, capacity: parseCapacity(entry.room.capacity), eta: travelSeconds(model, from, entry.id) }))
          .filter((candidate) => candidate.capacity >= people)
          .sort((first, second) => first.capacity - second.capacity || first.eta - second.eta);
        if (!ranked.length) throw new ToolError("NOT_FOUND", `No room seats ${people} people${level === undefined ? "" : ` on level ${level}`}.`);
        const asView = ({ entry, capacity, eta }: (typeof ranked)[number]) => ({ ...summarizeRoom(entry), capacity, etaSeconds: eta });
        return { people, best: asView(ranked[0]), alternatives: ranked.slice(1, 4).map(asView) };
      },
      summarize: (data) => `${data.best.name} fits ${data.people}`,
    }),
    defineTool({
      name: "get_directions",
      title: "Get directions",
      description: "Turn-by-turn indoor directions between two rooms with distance and ETA. Does not change the map.",
      category: "navigate",
      schema: z.strictObject({ toRoomId: ROOM_ID, fromRoomId: FROM.optional(), mode: MODE.optional() }),
      execute: (args) => publicRoute(context.directions(args)),
      summarize: (data) => `${data.from.name} → ${data.to.name}`,
    }),
    defineTool({
      name: "get_emergency_exit",
      title: "Get emergency exit",
      description: "Nearest fire-exit staircase and evacuation steps from a room. Never routes via lifts.",
      category: "navigate",
      schema: z.strictObject({ fromRoomId: FROM.optional() }),
      execute: (args) => publicRoute(context.emergency(args)),
      summarize: (data) => `Exit via ${data.to.name}`,
    }),
    defineTool({
      name: "list_workflows",
      title: "List workflows",
      description: "List predefined multi-stop journeys (e.g. new-joiner day 1, visitor journey).",
      category: "inspect",
      schema: EMPTY_INPUT,
      execute: () => ({
        workflows: model.workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          stops: workflow.stops.flatMap((id) => {
            const entry = model.getRoom(id);
            return entry ? [summarizeRoom(entry)] : [];
          }),
        })),
      }),
      summarize: (data) => `${data.workflows.length} workflows`,
    }),
    defineTool({
      name: "plan_itinerary",
      title: "Plan itinerary",
      description: "Plan an ordered multi-stop route from explicit room ids or a predefined workflowId. Does not change the map.",
      category: "navigate",
      schema: z.strictObject({
        stops: z.array(ROOM_ID).min(1).max(8).optional(),
        workflowId: z.string().regex(/^[a-z0-9-]{1,64}$/u).optional(),
        fromRoomId: FROM.optional(),
        mode: MODE.optional(),
      }),
      execute: (args) => publicItinerary(context.itinerary(args)),
      summarize: (data) => `${data.stops.length} stops planned`,
    }),
    defineTool({
      name: "set_my_location",
      title: "Set my location",
      description: "Set the user's current location ('You are here'). Subsequent directions start from here.",
      category: "navigate",
      readOnly: false,
      schema: z.strictObject({ roomId: ROOM_ID }),
      execute: ({ roomId }) => {
        const entry = requireRoom(roomId);
        session.setHereId(entry.id);
        return { location: summarizeRoom(entry) };
      },
      summarize: (data) => `You are at ${data.location.name}`,
    }),
    defineTool({
      name: "validate_layout",
      title: "Validate layout",
      description: "Run layout checks: duplicate ids, overlaps, rooms outside footprint, fire exits per floor, lifts, restrooms, first aid, workflow integrity.",
      category: "validate",
      schema: EMPTY_INPUT,
      execute: () => validateLayout(model),
      summarize: (data) => `${data.summary.errors} error(s), ${data.summary.warnings} warning(s)`,
    }),
    defineTool({
      name: "get_space_metrics",
      title: "Get space metrics",
      description: "Gross/net area (m²), utilisation, workstation and meeting-seat counts — for the building or one floor.",
      category: "validate",
      schema: z.strictObject({ level: LEVEL.optional() }),
      execute: ({ level }) => {
        if (level !== undefined && !model.getFloor(level)) throw new ToolError("NOT_FOUND", `No floor at level ${level}.`);
        return spaceMetrics(model, level ?? null);
      },
      summarize: (data) => `${data.totals.netAreaM2} m² net across ${data.totals.floors} floor(s)`,
    }),
  ];
}

export function createPresentationTools(context: ToolContext, presenter: Presenter): ToolDefinition[] {
  const { model, requireRoom } = context;
  return [
    defineTool({
      name: "get_view_state",
      title: "Get view state",
      description: "Inspect what the user currently sees: view mode, active floor, selected room, location and active route.",
      category: "inspect",
      schema: EMPTY_INPUT,
      execute: () => presenter.getState(),
      summarize: (data) => `View: ${data.view}`,
    }),
    defineTool({
      name: "switch_view",
      title: "Switch view",
      description: "Switch the canvas between 2D floor plan, 3D orbit and first-person walk mode.",
      category: "present",
      readOnly: false,
      schema: z.strictObject({ view: z.enum(VIEWS) }),
      execute: ({ view }) => {
        presenter.setView(view);
        return { view };
      },
      summarize: (data) => `Switched to ${data.view}`,
    }),
    defineTool({
      name: "set_active_floor",
      title: "Set active floor",
      description: "Isolate one floor on the canvas, or pass null to show all floors.",
      category: "present",
      readOnly: false,
      schema: z.strictObject({ level: LEVEL.nullable() }),
      execute: ({ level }) => {
        const floor = level === null ? null : model.getFloor(level);
        if (level !== null && !floor) throw new ToolError("NOT_FOUND", `No floor at level ${level}.`);
        presenter.setActiveFloor(level);
        return { level, floor: floor?.name ?? "All floors" };
      },
      summarize: (data) => `Showing ${data.floor}`,
    }),
    defineTool({
      name: "focus_room",
      title: "Focus room",
      description: "Select a room, fly the camera to it and open its details for the user.",
      category: "present",
      readOnly: false,
      schema: z.strictObject({ roomId: ROOM_ID }),
      execute: ({ roomId }) => {
        const entry = requireRoom(roomId);
        presenter.focusRoom(entry.id);
        return describeRoom(entry);
      },
      summarize: (data) => `Focused ${data.name}`,
    }),
    defineTool({
      name: "navigate_to",
      title: "Navigate to room",
      description: "Compute directions and draw the route on the user's map (2D and 3D), then focus the destination.",
      category: "present",
      readOnly: false,
      schema: z.strictObject({ toRoomId: ROOM_ID, fromRoomId: FROM.optional(), mode: MODE.optional() }),
      execute: (args) => {
        const route = context.directions(args);
        presenter.showRoute(route, { kind: "route", title: `${route.from.name} → ${route.to.name}` });
        return publicRoute(route);
      },
      summarize: (data) => `Route ${data.from.name} → ${data.to.name}`,
    }),
    defineTool({
      name: "show_emergency_exit",
      title: "Show emergency exit",
      description: "Draw the evacuation route to the nearest fire-exit staircase on the user's map.",
      category: "present",
      readOnly: false,
      schema: z.strictObject({ fromRoomId: FROM.optional() }),
      execute: (args) => {
        const route = context.emergency(args);
        presenter.showRoute(route, { kind: "emergency", title: `Evacuate via ${route.to.name}` });
        return publicRoute(route);
      },
      summarize: (data) => `Evacuate via ${data.to.name}`,
    }),
    defineTool({
      name: "show_itinerary",
      title: "Show itinerary",
      description: "Draw a multi-stop journey (explicit stops or a workflowId) on the user's map.",
      category: "present",
      readOnly: false,
      schema: z.strictObject({
        stops: z.array(ROOM_ID).min(1).max(8).optional(),
        workflowId: z.string().regex(/^[a-z0-9-]{1,64}$/u).optional(),
        fromRoomId: FROM.optional(),
        mode: MODE.optional(),
      }),
      execute: (args) => {
        const plan = context.itinerary(args);
        presenter.showRoute(plan, { kind: "itinerary", title: plan.workflow?.name ?? `${plan.stops.length}-stop itinerary` });
        return publicItinerary(plan);
      },
      summarize: (data) => `${data.stops.length}-stop itinerary shown`,
    }),
    defineTool({
      name: "clear_map",
      title: "Clear map",
      description: "Clear the selection and any drawn route.",
      category: "present",
      readOnly: false,
      schema: EMPTY_INPUT,
      execute: () => {
        presenter.clear();
        return { cleared: true };
      },
      summarize: () => "Map cleared",
    }),
  ];
}

export interface ToolExecutorOptions {
  onEvent?: (event: ToolEvent) => void;
  now?: () => number;
}

export interface ToolExecutor {
  execute(name: string, args?: unknown, options?: { actor?: string }): Promise<ToolExecutionResult>;
  get(name: string): ToolDefinition | null;
  list(): ToolDefinition[];
}

export function createToolExecutor(tools: readonly ToolDefinition[], { onEvent = () => {}, now = () => Date.now() }: ToolExecutorOptions = {}): ToolExecutor {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new TypeError(`Duplicate tool name "${tool.name}".`);
    byName.set(tool.name, tool);
  }
  let sequence = 0;

  async function execute(name: string, args: unknown = {}, { actor = "human" }: { actor?: string } = {}): Promise<ToolExecutionResult> {
    const id = ++sequence;
    const started = now();
    const tool = byName.get(name);
    const input = args ?? {};
    const emit = (outcome: Pick<ToolEvent, "ok" | "summary"> & Partial<Pick<ToolEvent, "error" | "cause">>) =>
      onEvent({
        id,
        tool: name,
        actor,
        args: input,
        category: tool?.category ?? null,
        readOnly: tool?.readOnly ?? null,
        durationMs: now() - started,
        ...outcome,
      });

    try {
      if (!ACTORS.includes(actor as Actor)) throw new ToolError("INVALID_ACTOR", `Unknown actor "${actor}".`);
      if (!tool) throw new ToolError("UNKNOWN_TOOL", `Unknown tool "${name}".`);
      const parsed = tool.validator.safeParse(input);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((validationIssue) => {
          const path = validationIssue.path.length ? `$.${validationIssue.path.map(String).join(".")}` : "$";
          return `${path} ${validationIssue.message}`;
        });
        throw new ToolError("INVALID_INPUT", `Invalid input for ${name}: ${errors.join("; ")}`, errors);
      }
      const data = await tool.execute(parsed.data);
      emit({ ok: true, summary: tool.summarize?.(data, parsed.data) ?? "Done" });
      return { ok: true, data };
    } catch (error) {
      const knownError = error instanceof ToolError;
      const publicError = error instanceof ToolError
        ? { code: error.code, message: error.message, ...(error.details !== undefined && { details: error.details }) }
        : { code: "INTERNAL_ERROR", message: `Unexpected error while running ${name}.` };
      emit({ ok: false, summary: publicError.message, error: publicError, ...(knownError ? {} : { cause: error }) });
      return { ok: false, error: publicError };
    }
  }

  return {
    execute,
    get: (name) => byName.get(name) ?? null,
    list: () => [...byName.values()],
  };
}