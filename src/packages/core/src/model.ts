import { areaOf, round } from "./geometry.js";

export interface RoomData {
  id: string;
  name: string;
  type: string;
  x: number;
  z: number;
  w: number;
  d: number;
  height?: number;
  capacity?: string;
  hours?: string;
  contact?: string;
  info?: string;
  tags?: readonly string[];
  directions?: string;
}

export interface BuildingFloor {
  level: number;
  short?: string;
  name: string;
  rooms: readonly RoomData[];
}

export interface BuildingWorkflow {
  id: string;
  name: string;
  description: string;
  stops: readonly string[];
}

export interface BuildingData {
  id: string;
  name: string;
  subtitle?: string;
  dimensionBasis?: "estimated" | "measured";
  dimensionSource?: string;
  footprint: { width: number; depth: number };
  floorSpacing?: number;
  circulation?: { spineZ?: number };
  defaultOriginId?: string;
  floors: readonly BuildingFloor[];
  workflows?: readonly BuildingWorkflow[];
}

export interface RoomTypeInfo {
  label: string;
  color: number;
  icon: string;
}

export type RoomTypeMap = Readonly<Record<string, RoomTypeInfo>> & { readonly other: RoomTypeInfo };

export interface ModelEntry {
  id: string;
  room: RoomData;
  floor: BuildingFloor;
  level: number;
  typeKey: string;
  type: RoomTypeInfo;
}

export interface BuildingModel {
  building: BuildingData;
  roomTypes: RoomTypeMap;
  floors: readonly BuildingFloor[];
  entries: readonly ModelEntry[];
  duplicates: readonly string[];
  defaultOriginId: string | null;
  spineZ: number;
  workflows: readonly BuildingWorkflow[];
  getRoom(id: string): ModelEntry | null;
  hasRoom(id: string): boolean;
  getFloor(level: number): BuildingFloor | null;
  roomsOnFloor(level: number): ModelEntry[];
  roomsOfType(type: string): ModelEntry[];
  getWorkflow(id: string): BuildingWorkflow | null;
}

export interface RoomDescription {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  level: number;
  floor: string;
  areaM2: number;
  position: { x: number; z: number };
  size: { w: number; d: number };
  capacity?: string;
  hours?: string;
  contact?: string;
  info?: string;
  tags?: string[];
}

export function createModel(building: BuildingData, roomTypes: RoomTypeMap): Readonly<BuildingModel> {
  if (!building || !Array.isArray(building.floors) || building.floors.length === 0) {
    throw new TypeError("Building must define at least one floor.");
  }
  if (!roomTypes?.other) throw new TypeError("roomTypes must include an 'other' fallback.");

  const floors = [...building.floors].sort((a, b) => a.level - b.level);
  const entries: ModelEntry[] = [];
  const byId = new Map<string, ModelEntry>();
  const duplicates: string[] = [];

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

  const floorByLevel = new Map(floors.map((floor) => [floor.level, floor]));
  const defaultOriginId = byId.has(building.defaultOriginId ?? "")
    ? building.defaultOriginId ?? null
    : entries.find((entry) => entry.typeKey === "reception")?.id ?? entries[0]?.id ?? null;

  return Object.freeze({
    building,
    roomTypes,
    floors,
    entries,
    duplicates,
    defaultOriginId,
    spineZ: building.circulation?.spineZ ?? 0,
    workflows: building.workflows ?? [],
    getRoom: (id: string) => byId.get(id) ?? null,
    hasRoom: (id: string) => byId.has(id),
    getFloor: (level: number) => floorByLevel.get(level) ?? null,
    roomsOnFloor: (level: number) => entries.filter((entry) => entry.level === level),
    roomsOfType: (type: string) => entries.filter((entry) => entry.typeKey === type),
    getWorkflow: (id: string) => building.workflows?.find((workflow) => workflow.id === id) ?? null,
  });
}

export function describeRoom(entry: ModelEntry): RoomDescription {
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

export const summarizeRoom = (entry: ModelEntry) => ({
  id: entry.id,
  name: entry.room.name,
  type: entry.typeKey,
  level: entry.level,
  floor: entry.floor.name,
});