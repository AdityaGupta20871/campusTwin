import { areaOf, round } from "./geometry.js";
import type { BuildingFloor, BuildingModel } from "./model.js";

export interface FloorMetrics {
  level: number;
  floor: string;
  rooms: number;
  grossAreaM2: number;
  netAreaM2: number;
  utilisationPct: number;
  workstations: number;
  meetingSeats: number;
  areaByTypeM2: Record<string, number>;
}

export interface SpaceMetrics {
  floors: FloorMetrics[];
  totals: {
    floors: number;
    rooms: number;
    grossAreaM2: number;
    netAreaM2: number;
    utilisationPct: number;
    workstations: number;
    meetingSeats: number;
  };
}

export function parseCapacity(value: unknown): number {
  const match = /(\d+)/.exec(String(value ?? ""));
  return match ? Number(match[1]) : 0;
}

function floorMetrics(model: Readonly<BuildingModel>, floor: BuildingFloor): FloorMetrics {
  const rooms = model.roomsOnFloor(floor.level);
  const gross = model.building.footprint.width * model.building.footprint.depth;
  const net = rooms.reduce((total, entry) => total + areaOf(entry.room), 0);
  const byType: Record<string, number> = {};
  for (const entry of rooms) byType[entry.typeKey] = round((byType[entry.typeKey] ?? 0) + areaOf(entry.room), 1);
  const capacityFor = (type: string) =>
    rooms.filter((entry) => entry.typeKey === type).reduce((total, entry) => total + parseCapacity(entry.room.capacity), 0);

  return {
    level: floor.level,
    floor: floor.name,
    rooms: rooms.length,
    grossAreaM2: round(gross, 1),
    netAreaM2: round(net, 1),
    utilisationPct: round((net / gross) * 100, 1),
    workstations: capacityFor("workspace"),
    meetingSeats: capacityFor("meeting"),
    areaByTypeM2: byType,
  };
}

export function spaceMetrics(model: Readonly<BuildingModel>, level: number | null = null): SpaceMetrics {
  const floors = (level === null ? model.floors : model.floors.filter((floor) => floor.level === level)).map((floor) => floorMetrics(model, floor));
  const sum = (key: keyof Omit<FloorMetrics, "floor" | "level" | "areaByTypeM2">) =>
    round(floors.reduce((total, floor) => total + floor[key], 0), 1);
  const gross = sum("grossAreaM2");
  const net = sum("netAreaM2");
  return {
    floors,
    totals: {
      floors: floors.length,
      rooms: sum("rooms"),
      grossAreaM2: gross,
      netAreaM2: net,
      utilisationPct: gross ? round((net / gross) * 100, 1) : 0,
      workstations: sum("workstations"),
      meetingSeats: sum("meetingSeats"),
    },
  };
}