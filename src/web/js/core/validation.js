import { overlapArea, containsRect, round } from "./geometry.js";

const issue = (severity, code, message, extra = {}) => ({ severity, code, message, ...extra });

/**
 * Layout checks for the building model (data quality + life-safety basics).
 * These are indicative checks for a wayfinding twin, not building-code certification.
 */
export function validateLayout(model) {
  const issues = [];
  const { footprint } = model.building;
  const envelope = { x: 0, z: 0, w: footprint.width, d: footprint.depth };

  for (const id of new Set(model.duplicates)) {
    issues.push(issue("error", "DUPLICATE_ID", `Room id "${id}" is used more than once.`, { roomId: id }));
  }

  for (const floor of model.floors) {
    const rooms = model.roomsOnFloor(floor.level);

    for (const e of rooms) {
      const { room } = e;
      if (![room.x, room.z, room.w, room.d].every(Number.isFinite) || room.w <= 0 || room.d <= 0) {
        issues.push(issue("error", "INVALID_GEOMETRY", `${room.name} has invalid position or size.`, { roomId: room.id, level: floor.level }));
        continue;
      }
      if (e.typeKey === "other" && room.type !== "other") {
        issues.push(issue("warning", "UNKNOWN_TYPE", `${room.name} uses unknown type "${room.type}".`, { roomId: room.id, level: floor.level }));
      }
      if (!containsRect(envelope, room)) {
        issues.push(issue("error", "OUT_OF_FOOTPRINT", `${room.name} extends outside the building footprint.`, { roomId: room.id, level: floor.level }));
      }
    }

    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i].room;
        const b = rooms[j].room;
        const overlap = overlapArea(a, b);
        if (overlap > 0.01) {
          issues.push(
            issue("error", "OVERLAP", `${a.name} overlaps ${b.name} by ${round(overlap, 1)} m² on ${floor.name}.`, {
              roomId: a.id,
              otherRoomId: b.id,
              level: floor.level,
            })
          );
        }
      }
    }

    const count = (type) => rooms.filter((e) => e.typeKey === type).length;
    if (count("stairs") < 2) {
      issues.push(issue("error", "FIRE_EXITS", `${floor.name} has ${count("stairs")} fire exit(s); at least 2 are expected.`, { level: floor.level }));
    }
    if (count("lift") === 0) {
      issues.push(issue("warning", "NO_LIFT", `${floor.name} has no lift access (accessibility).`, { level: floor.level }));
    }
    if (count("restroom") === 0) {
      issues.push(issue("warning", "NO_RESTROOM", `${floor.name} has no restroom mapped.`, { level: floor.level }));
    }
  }

  if (model.roomsOfType("firstaid").length === 0) {
    issues.push(issue("warning", "NO_FIRST_AID", "No first-aid room is mapped in the building."));
  }

  for (const wf of model.workflows) {
    for (const stop of wf.stops) {
      if (!model.hasRoom(stop)) {
        issues.push(issue("error", "WORKFLOW_STOP", `Workflow "${wf.name}" references unknown room "${stop}".`, { workflowId: wf.id }));
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  return { ok: errors === 0, summary: { errors, warnings: issues.length - errors }, issues };
}
