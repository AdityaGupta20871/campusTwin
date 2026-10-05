import { containsRect, overlapArea, round } from "./geometry.js";
import type { BuildingModel } from "./model.js";

export type LayoutIssueSeverity = "error" | "warning";
export type LayoutIssueCode =
  | "DUPLICATE_ID"
  | "INVALID_GEOMETRY"
  | "UNKNOWN_TYPE"
  | "OUT_OF_FOOTPRINT"
  | "OVERLAP"
  | "FIRE_EXITS"
  | "NO_LIFT"
  | "NO_RESTROOM"
  | "NO_FIRST_AID"
  | "WORKFLOW_STOP";

export interface LayoutIssue {
  severity: LayoutIssueSeverity;
  code: LayoutIssueCode;
  message: string;
  roomId?: string;
  otherRoomId?: string;
  level?: number;
  workflowId?: string;
}

export interface LayoutValidationResult {
  ok: boolean;
  summary: { errors: number; warnings: number };
  issues: LayoutIssue[];
}

type IssueDetails = Omit<Partial<LayoutIssue>, "severity" | "code" | "message">;

const issue = (severity: LayoutIssueSeverity, code: LayoutIssueCode, message: string, extra: IssueDetails = {}): LayoutIssue => ({
  severity,
  code,
  message,
  ...extra,
});

export function validateLayout(model: Readonly<BuildingModel>): LayoutValidationResult {
  const issues: LayoutIssue[] = [];
  const { footprint } = model.building;
  const envelope = { x: 0, z: 0, w: footprint.width, d: footprint.depth };

  for (const id of new Set(model.duplicates)) {
    issues.push(issue("error", "DUPLICATE_ID", `Room id "${id}" is used more than once.`, { roomId: id }));
  }

  for (const floor of model.floors) {
    const rooms = model.roomsOnFloor(floor.level);

    for (const entry of rooms) {
      const { room } = entry;
      if (![room.x, room.z, room.w, room.d].every(Number.isFinite) || room.w <= 0 || room.d <= 0) {
        issues.push(issue("error", "INVALID_GEOMETRY", `${room.name} has invalid position or size.`, { roomId: room.id, level: floor.level }));
        continue;
      }
      if (entry.typeKey === "other" && room.type !== "other") {
        issues.push(issue("warning", "UNKNOWN_TYPE", `${room.name} uses unknown type "${room.type}".`, { roomId: room.id, level: floor.level }));
      }
      if (!containsRect(envelope, room)) {
        issues.push(issue("error", "OUT_OF_FOOTPRINT", `${room.name} extends outside the building footprint.`, { roomId: room.id, level: floor.level }));
      }
    }

    for (let firstIndex = 0; firstIndex < rooms.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < rooms.length; secondIndex++) {
        const firstRoom = rooms[firstIndex].room;
        const secondRoom = rooms[secondIndex].room;
        const overlap = overlapArea(firstRoom, secondRoom);
        if (overlap > 0.01) {
          issues.push(
            issue("error", "OVERLAP", `${firstRoom.name} overlaps ${secondRoom.name} by ${round(overlap, 1)} m² on ${floor.name}.`, {
              roomId: firstRoom.id,
              otherRoomId: secondRoom.id,
              level: floor.level,
            }),
          );
        }
      }
    }

    const count = (type: string) => rooms.filter((entry) => entry.typeKey === type).length;
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

  for (const workflow of model.workflows) {
    for (const stop of workflow.stops) {
      if (!model.hasRoom(stop)) {
        issues.push(issue("error", "WORKFLOW_STOP", `Workflow "${workflow.name}" references unknown room "${stop}".`, { workflowId: workflow.id }));
      }
    }
  }

  const errors = issues.filter((entry) => entry.severity === "error").length;
  return { ok: errors === 0, summary: { errors, warnings: issues.length - errors }, issues };
}