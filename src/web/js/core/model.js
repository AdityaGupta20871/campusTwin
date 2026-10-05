import { areaOf, round } from "./geometry.js";

/**
 * Canonical, read-only building model. Every view (2D plan, 3D, agent, WebMCP, MCP)
 * reads from this single source of truth.
 */
export function createModel(building, roomTypes) {
  if (!building || !Array.isArray(building.floors) || building.floors.length === 0) {
    throw new TypeError("Building must define at least one floor.");
  }
  if (!roomTypes?.other) throw new TypeError("roomTypes must include an 'other' fallback.");

  const floors = [...building.floors].sort((a, b) => a.level - b.level);
  const entries = [];
  const byId = new Map();
  const duplicates = [];

  for (const floor of floors) {
    for (const room of floor.rooms) {
      const entry = Object.freeze({
        id: room.id,
        room,
        floor,
        level: floor.level,
        typeKey: roomTypes[room.type] ? room.type : "other",
        type: roomTypes[room.type] ?? roomTypes.other,
      });
      if (byId.has(room.id)) duplicates.push(room.id);
      else byId.set(room.id, entry);
      entries.push(entry);
    }
  }

  const floorByLevel = new Map(floors.map((f) => [f.level, f]));
  const defaultOriginId = byId.has(building.defaultOriginId)
    ? building.defaultOriginId
    : entries.find((e) => e.typeKey === "reception")?.id ?? entries[0]?.id ?? null;

  return Object.freeze({
    building,
    roomTypes,
    floors,
    entries,
    duplicates,
    defaultOriginId,
    spineZ: building.circulation?.spineZ ?? 0,
    workflows: building.workflows ?? [],
    getRoom: (id) => byId.get(id) ?? null,
    hasRoom: (id) => byId.has(id),
    getFloor: (level) => floorByLevel.get(level) ?? null,
    roomsOnFloor: (level) => entries.filter((e) => e.level === level),
    roomsOfType: (type) => entries.filter((e) => e.typeKey === type),
    getWorkflow: (id) => (building.workflows ?? []).find((w) => w.id === id) ?? null,
  });
}

/** Plain, serialisable description of a room — safe to return from tools. */
export function describeRoom(entry) {
  const { room, floor, type, typeKey } = entry;
  return {
    id: room.id,
    name: room.name,
    type: typeKey,
    typeLabel: type.label,
    level: floor.level,
    floor: floor.name,
    areaM2: round(areaOf(room), 1),
    position: { x: room.x, z: room.z },
    size: { w: room.w, d: room.d },
    ...(room.capacity && { capacity: room.capacity }),
    ...(room.hours && { hours: room.hours }),
    ...(room.contact && { contact: room.contact }),
    ...(room.info && { info: room.info }),
    ...(room.tags?.length && { tags: [...room.tags] }),
  };
}

export const summarizeRoom = (entry) => ({
  id: entry.id,
  name: entry.room.name,
  type: entry.typeKey,
  level: entry.level,
  floor: entry.floor.name,
});
