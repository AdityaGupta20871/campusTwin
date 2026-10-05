import { rectOf, distance, polylineLength, dedupePoints } from "./geometry.js";
import { summarizeRoom } from "./model.js";

export class RouteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RouteError";
    this.code = code;
  }
}

export const ROUTE_MODES = Object.freeze(["fastest", "accessible", "stairs"]);

/** Indicative travel assumptions (seconds / metres per second). */
export const TRAVEL = Object.freeze({ walkSpeed: 1.3, liftWait: 25, liftPerFloor: 4, stairsPerFloor: 18 });

const centerOf = (room) => ({ x: room.x, z: room.z });

/** Door point: the edge of the room facing the main corridor. */
export function doorOf(room, spineZ) {
  const r = rectOf(room);
  if (r.minZ > spineZ) return { x: room.x, z: r.minZ };
  if (r.maxZ < spineZ) return { x: room.x, z: r.maxZ };
  return { x: room.x, z: spineZ };
}

export function corridorPath(fromRoom, toRoom, spineZ) {
  const a = doorOf(fromRoom, spineZ);
  const b = doorOf(toRoom, spineZ);
  return dedupePoints([centerOf(fromRoom), a, { x: a.x, z: spineZ }, { x: b.x, z: spineZ }, b, centerOf(toRoom)]);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

function headingOf(points) {
  if (points.length < 2) return "";
  const dx = points[points.length - 1].x - points[0].x;
  if (Math.abs(dx) < 1) return "straight across the corridor";
  return dx > 0 ? "east along the main corridor" : "west along the main corridor";
}

const sideOf = (room, spineZ) => (room.z < spineZ ? "north" : room.z > spineZ ? "south" : "central");

function arrivalText(entry, spineZ) {
  const side = sideOf(entry.room, spineZ);
  const where = side === "central" ? "in the building core" : `on the ${side} side`;
  const extra = entry.room.directions ? ` ${entry.room.directions}` : "";
  return `Arrive at ${entry.room.name} (${entry.floor.name}), ${where}.${extra}`;
}

const connectorsOn = (model, level, typeKey) => model.roomsOnFloor(level).filter((e) => e.typeKey === typeKey);

/** Picks the vertical connector (lift / stair shaft) giving the shortest walk. */
function pickConnector(model, from, to, typeKey) {
  let best = null;
  for (const start of connectorsOn(model, from.level, typeKey)) {
    const end = connectorsOn(model, to.level, typeKey).find((e) => distance(e.room, start.room) < 1);
    if (!end) continue;
    const cost =
      polylineLength(corridorPath(from.room, start.room, model.spineZ)) +
      polylineLength(corridorPath(end.room, to.room, model.spineZ));
    if (!best || cost < best.cost) best = { start, end, cost };
  }
  return best;
}

function result({ from, to, mode, via, floorsChanged, walk, verticalSeconds, steps, legs, verticals }) {
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

function requireRoom(model, id, label) {
  const entry = model.getRoom(id);
  if (!entry) throw new RouteError("UNKNOWN_ROOM", `Unknown ${label} room "${id}".`);
  return entry;
}

export function findRoute(model, fromId, toId, { mode = "fastest" } = {}) {
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

  let via = mode === "stairs" ? "stairs" : "lift";
  let conn = pickConnector(model, from, to, via);
  if (!conn && mode === "fastest") {
    via = "stairs";
    conn = pickConnector(model, from, to, via);
  }
  if (!conn) {
    throw new RouteError("NO_VERTICAL_CONNECTOR", `No ${via} connects ${from.floor.name} and ${to.floor.name}.`);
  }

  const floors = Math.abs(to.level - from.level);
  const dir = to.level > from.level ? "up" : "down";
  const first = corridorPath(from.room, conn.start.room, spine);
  const second = corridorPath(conn.end.room, to.room, spine);
  const walk = polylineLength(first) + polylineLength(second);
  const verticalSeconds = via === "lift" ? TRAVEL.liftWait + TRAVEL.liftPerFloor * floors : TRAVEL.stairsPerFloor * floors;

  const steps = [];
  if (polylineLength(first) > 0) {
    steps.push(`From ${from.room.name}, walk ~${Math.round(polylineLength(first))} m ${headingOf(first)} to ${conn.start.room.name}.`);
  }
  steps.push(
    via === "lift"
      ? `Take the lift ${dir} to ${to.floor.name}.`
      : `Take ${conn.start.room.name} ${dir} ${floors} floor${floors > 1 ? "s" : ""} to ${to.floor.name}.`
  );
  if (polylineLength(second) > 0) steps.push(`Walk ~${Math.round(polylineLength(second))} m ${headingOf(second)}.`);
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
    verticals: [{ via, fromLevel: from.level, toLevel: to.level, at: centerOf(conn.start.room) }],
  });
}

/** Nearest stair (fire exit) on the current floor, then down to the exit level. Lifts are never used. */
export function findEmergencyExit(model, fromId) {
  const from = requireRoom(model, fromId, "start");
  const spine = model.spineZ;
  const exits = connectorsOn(model, from.level, "stairs");
  if (!exits.length) throw new RouteError("NO_EXIT", `No fire exit is mapped on ${from.floor.name}.`);

  const ranked = exits
    .map((e) => ({ e, points: corridorPath(from.room, e.room, spine) }))
    .sort((a, b) => polylineLength(a.points) - polylineLength(b.points));
  const { e: exit, points } = ranked[0];
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

export function planItinerary(model, stopIds, { fromId = null, mode = "fastest" } = {}) {
  if (!Array.isArray(stopIds) || stopIds.length === 0) {
    throw new RouteError("EMPTY_ITINERARY", "An itinerary needs at least one stop.");
  }
  stopIds.forEach((id) => requireRoom(model, id, "stop"));
  const sequence = fromId && fromId !== stopIds[0] ? [fromId, ...stopIds] : [...stopIds];
  const segments = [];
  for (let i = 1; i < sequence.length; i++) segments.push(findRoute(model, sequence[i - 1], sequence[i], { mode }));

  return {
    stops: stopIds.map((id) => summarizeRoom(model.getRoom(id))),
    segments,
    distanceM: segments.reduce((s, r) => s + r.distanceM, 0),
    etaSeconds: segments.reduce((s, r) => s + r.etaSeconds, 0),
    legs: segments.flatMap((r) => r.legs),
    verticals: segments.flatMap((r) => r.verticals),
  };
}

/** Travel time in seconds, or Infinity when no route exists. */
export function travelSeconds(model, fromId, toId, mode = "fastest") {
  try {
    return findRoute(model, fromId, toId, { mode }).etaSeconds;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
