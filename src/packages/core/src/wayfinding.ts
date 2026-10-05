import { dedupePoints, distance, polylineLength, rectOf, type Point2D } from "./geometry.js";
import { summarizeRoom, type BuildingModel, type ModelEntry, type RoomData } from "./model.js";

export type RouteMode = "fastest" | "accessible" | "stairs";
export type RouteVia = "none" | "walk" | "lift" | "stairs";
export type RouteErrorCode = "UNKNOWN_ROOM" | "INVALID_MODE" | "NO_VERTICAL_CONNECTOR" | "NO_EXIT" | "EMPTY_ITINERARY";

export class RouteError extends Error {
  constructor(public readonly code: RouteErrorCode, message: string) {
    super(message);
    this.name = "RouteError";
  }
}

export const ROUTE_MODES = Object.freeze(["fastest", "accessible", "stairs"] as const);

export const TRAVEL = Object.freeze({ walkSpeed: 1.3, liftWait: 25, liftPerFloor: 4, stairsPerFloor: 18 });

export interface RouteLeg {
  level: number;
  points: Point2D[];
}

export interface VerticalStep {
  via: "lift" | "stairs";
  fromLevel: number;
  toLevel: number;
  at: Point2D;
}

export interface Route {
  from: ReturnType<typeof summarizeRoom>;
  to: ReturnType<typeof summarizeRoom>;
  mode: RouteMode;
  via: RouteVia;
  floorsChanged: number;
  distanceM: number;
  etaSeconds: number;
  steps: string[];
  legs: RouteLeg[];
  verticals: VerticalStep[];
}

export interface EmergencyRoute extends Route {
  emergency: true;
}

export interface Itinerary {
  stops: ReturnType<typeof summarizeRoom>[];
  segments: Route[];
  distanceM: number;
  etaSeconds: number;
  legs: RouteLeg[];
  verticals: VerticalStep[];
}

export interface RouteOptions {
  mode?: RouteMode;
}

export interface ItineraryOptions extends RouteOptions {
  fromId?: string | null;
}

interface ConnectorChoice {
  start: ModelEntry;
  end: ModelEntry;
  cost: number;
}

const centerOf = (room: RoomData): Point2D => ({ x: room.x, z: room.z });

export function doorOf(room: RoomData, spineZ: number): Point2D {
  const bounds = rectOf(room);
  if (bounds.minZ > spineZ) return { x: room.x, z: bounds.minZ };
  if (bounds.maxZ < spineZ) return { x: room.x, z: bounds.maxZ };
  return { x: room.x, z: spineZ };
}

export function corridorPath(fromRoom: RoomData, toRoom: RoomData, spineZ: number): Point2D[] {
  const fromDoor = doorOf(fromRoom, spineZ);
  const toDoor = doorOf(toRoom, spineZ);
  return dedupePoints([
    centerOf(fromRoom),
    fromDoor,
    { x: fromDoor.x, z: spineZ },
    { x: toDoor.x, z: spineZ },
    toDoor,
    centerOf(toRoom),
  ]);
}

export function formatDuration(seconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  if (roundedSeconds < 60) return `${roundedSeconds} s`;
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return remainder ? `${minutes} min ${remainder} s` : `${minutes} min`;
}

function headingOf(points: readonly Point2D[]): string {
  if (points.length < 2) return "";
  const dx = points[points.length - 1].x - points[0].x;
  if (Math.abs(dx) < 1) return "straight across the corridor";
  return dx > 0 ? "east along the main corridor" : "west along the main corridor";
}

const sideOf = (room: RoomData, spineZ: number): "north" | "south" | "central" =>
  room.z < spineZ ? "north" : room.z > spineZ ? "south" : "central";

function arrivalText(entry: ModelEntry, spineZ: number): string {
  const side = sideOf(entry.room, spineZ);
  const location = side === "central" ? "in the building core" : `on the ${side} side`;
  const extra = entry.room.directions ? ` ${entry.room.directions}` : "";
  return `Arrive at ${entry.room.name} (${entry.floor.name}), ${location}.${extra}`;
}

const connectorsOn = (model: Readonly<BuildingModel>, level: number, typeKey: string): ModelEntry[] =>
  model.roomsOnFloor(level).filter((entry) => entry.typeKey === typeKey);

function pickConnector(
  model: Readonly<BuildingModel>,
  from: ModelEntry,
  to: ModelEntry,
  typeKey: "lift" | "stairs",
): ConnectorChoice | null {
  let best: ConnectorChoice | null = null;
  for (const start of connectorsOn(model, from.level, typeKey)) {
    const end = connectorsOn(model, to.level, typeKey).find((entry) => distance(entry.room, start.room) < 1);
    if (!end) continue;
    const cost =
      polylineLength(corridorPath(from.room, start.room, model.spineZ)) +
      polylineLength(corridorPath(end.room, to.room, model.spineZ));
    if (!best || cost < best.cost) best = { start, end, cost };
  }
  return best;
}

interface RouteResultInput {
  from: ModelEntry;
  to: ModelEntry;
  mode: RouteMode;
  via: RouteVia;
  floorsChanged: number;
  walk: number;
  verticalSeconds: number;
  steps: string[];
  legs: RouteLeg[];
  verticals: VerticalStep[];
}

function result(input: RouteResultInput): Route {
  const { from, to, mode, via, floorsChanged, walk, verticalSeconds, steps, legs, verticals } = input;
  return {
    from: summarizeRoom(from),
    to: summarizeRoom(to),
    mode,
    via,
    floorsChanged,
    distanceM: Math.round(walk),
    etaSeconds: Math.ceil(walk / TRAVEL.walkSpeed + verticalSeconds),
    steps,
    legs,
    verticals,
  };
}

function requireRoom(model: Readonly<BuildingModel>, id: string | null, label: string): ModelEntry {
  const entry = id === null ? null : model.getRoom(id);
  if (!entry) throw new RouteError("UNKNOWN_ROOM", `Unknown ${label} room "${id}".`);
  return entry;
}

export function findRoute(
  model: Readonly<BuildingModel>,
  fromId: string | null,
  toId: string,
  { mode = "fastest" }: RouteOptions = {},
): Route {
  if (!ROUTE_MODES.includes(mode)) throw new RouteError("INVALID_MODE", `Unsupported route mode "${mode}".`);
  const from = requireRoom(model, fromId, "start");
  const to = requireRoom(model, toId, "destination");
  const spine = model.spineZ;
  const base = { from, to, mode };

  if (from.id === to.id) {
    return result({ ...base, via: "none", floorsChanged: 0, walk: 0, verticalSeconds: 0, steps: [`You are already at ${to.room.name}.`], legs: [], verticals: [] });
  }

  if (from.level === to.level) {
    const points = corridorPath(from.room, to.room, spine);
    const walk = polylineLength(points);
    return result({
      ...base,
      via: "walk",
      floorsChanged: 0,
      walk,
      verticalSeconds: 0,
      steps: [`From ${from.room.name}, walk ~${Math.round(walk)} m ${headingOf(points)}.`, arrivalText(to, spine)],
      legs: [{ level: from.level, points }],
      verticals: [],
    });
  }

  let via: "lift" | "stairs" = mode === "stairs" ? "stairs" : "lift";
  let connector = pickConnector(model, from, to, via);
  if (!connector && mode === "fastest") {
    via = "stairs";
    connector = pickConnector(model, from, to, via);
  }
  if (!connector) {
    throw new RouteError("NO_VERTICAL_CONNECTOR", `No ${via} connects ${from.floor.name} and ${to.floor.name}.`);
  }

  const floors = Math.abs(to.level - from.level);
  const direction = to.level > from.level ? "up" : "down";
  const first = corridorPath(from.room, connector.start.room, spine);
  const second = corridorPath(connector.end.room, to.room, spine);
  const walk = polylineLength(first) + polylineLength(second);
  const verticalSeconds = via === "lift" ? TRAVEL.liftWait + TRAVEL.liftPerFloor * floors : TRAVEL.stairsPerFloor * floors;

  const steps: string[] = [];
  const firstDistance = polylineLength(first);
  const secondDistance = polylineLength(second);
  if (firstDistance > 0) {
    steps.push(`From ${from.room.name}, walk ~${Math.round(firstDistance)} m ${headingOf(first)} to ${connector.start.room.name}.`);
  }
  steps.push(
    via === "lift"
      ? `Take the lift ${direction} to ${to.floor.name}.`
      : `Take ${connector.start.room.name} ${direction} ${floors} floor${floors > 1 ? "s" : ""} to ${to.floor.name}.`,
  );
  if (secondDistance > 0) steps.push(`Walk ~${Math.round(secondDistance)} m ${headingOf(second)}.`);
  steps.push(arrivalText(to, spine));

  return result({
    ...base,
    via,
    floorsChanged: floors,
    walk,
    verticalSeconds,
    steps,
    legs: [
      { level: from.level, points: first },
      { level: to.level, points: second },
    ],
    verticals: [{ via, fromLevel: from.level, toLevel: to.level, at: centerOf(connector.start.room) }],
  });
}

export function findEmergencyExit(model: Readonly<BuildingModel>, fromId: string | null): EmergencyRoute {
  const from = requireRoom(model, fromId, "start");
  const spine = model.spineZ;
  const exits = connectorsOn(model, from.level, "stairs");
  if (!exits.length) throw new RouteError("NO_EXIT", `No fire exit is mapped on ${from.floor.name}.`);

  const ranked = exits
    .map((entry) => ({ entry, points: corridorPath(from.room, entry.room, spine) }))
    .sort((a, b) => polylineLength(a.points) - polylineLength(b.points));
  const { entry: exit, points } = ranked[0];
  const walk = polylineLength(points);

  const exitLevel = model.getFloor(0) ? 0 : model.floors[0].level;
  const floors = Math.abs(from.level - exitLevel);
  const steps = [
    "Stay calm. Do NOT use the lifts.",
    walk > 0
      ? `Walk ~${Math.round(walk)} m ${headingOf(points)} to ${exit.room.name}.`
      : `You are at ${exit.room.name}.`,
  ];
  if (floors > 0) steps.push(`Go down ${floors} floor${floors > 1 ? "s" : ""} to ${model.getFloor(exitLevel)?.name ?? "the exit level"}.`);
  steps.push("Leave the building and proceed to the assembly point. Follow fire wardens' instructions.");

  return {
    ...result({
      from,
      to: exit,
      mode: "stairs",
      via: floors > 0 ? "stairs" : "walk",
      floorsChanged: floors,
      walk,
      verticalSeconds: TRAVEL.stairsPerFloor * floors,
      steps,
      legs: [{ level: from.level, points }],
      verticals: floors > 0 ? [{ via: "stairs", fromLevel: from.level, toLevel: exitLevel, at: centerOf(exit.room) }] : [],
    }),
    emergency: true,
  };
}

export function planItinerary(
  model: Readonly<BuildingModel>,
  stopIds: readonly string[],
  { fromId = null, mode = "fastest" }: ItineraryOptions = {},
): Itinerary {
  if (!Array.isArray(stopIds) || stopIds.length === 0) {
    throw new RouteError("EMPTY_ITINERARY", "An itinerary needs at least one stop.");
  }
  stopIds.forEach((id) => requireRoom(model, id, "stop"));
  const sequence = fromId && fromId !== stopIds[0] ? [fromId, ...stopIds] : [...stopIds];
  const segments: Route[] = [];
  for (let index = 1; index < sequence.length; index++) {
    segments.push(findRoute(model, sequence[index - 1], sequence[index], { mode }));
  }

  return {
    stops: stopIds.map((id) => summarizeRoom(model.getRoom(id)!)),
    segments,
    distanceM: segments.reduce((total, route) => total + route.distanceM, 0),
    etaSeconds: segments.reduce((total, route) => total + route.etaSeconds, 0),
    legs: segments.flatMap((route) => route.legs),
    verticals: segments.flatMap((route) => route.verticals),
  };
}

export function travelSeconds(
  model: Readonly<BuildingModel>,
  fromId: string | null,
  toId: string,
  mode: RouteMode = "fastest",
): number {
  try {
    return findRoute(model, fromId, toId, { mode }).etaSeconds;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}