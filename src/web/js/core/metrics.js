import { areaOf, round } from "./geometry.js";

/** Extracts the leading integer from strings like "80 seats" or "8 people". */
export function parseCapacity(value) {
  const match = /(\d+)/.exec(String(value ?? ""));
  return match ? Number(match[1]) : 0;
}

function floorMetrics(model, floor) {
  const rooms = model.roomsOnFloor(floor.level);
  const gross = model.building.footprint.width * model.building.footprint.depth;
  const net = rooms.reduce((s, e) => s + areaOf(e.room), 0);
  const byType = {};
  for (const e of rooms) byType[e.typeKey] = round((byType[e.typeKey] ?? 0) + areaOf(e.room), 1);
  const cap = (type) => rooms.filter((e) => e.typeKey === type).reduce((s, e) => s + parseCapacity(e.room.capacity), 0);

  return {
    level: floor.level,
    floor: floor.name,
    rooms: rooms.length,
    grossAreaM2: round(gross, 1),
    netAreaM2: round(net, 1),
    utilisationPct: round((net / gross) * 100, 1),
    workstations: cap("workspace"),
    meetingSeats: cap("meeting"),
    areaByTypeM2: byType,
  };
}

export function spaceMetrics(model, level = null) {
  const floors = (level === null ? model.floors : model.floors.filter((f) => f.level === level)).map((f) => floorMetrics(model, f));
  const sum = (k) => round(floors.reduce((s, f) => s + f[k], 0), 1);
  const gross = sum("grossAreaM2");
  return {
    floors,
    totals: {
      floors: floors.length,
      rooms: sum("rooms"),
      grossAreaM2: gross,
      netAreaM2: sum("netAreaM2"),
      utilisationPct: gross ? round((sum("netAreaM2") / gross) * 100, 1) : 0,
      workstations: sum("workstations"),
      meetingSeats: sum("meetingSeats"),
    },
  };
}
