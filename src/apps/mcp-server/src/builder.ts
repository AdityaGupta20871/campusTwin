import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BuildingData, RoomData, RoomTypeMap } from "@campus-twin/core";

const RoomSchema = z.looseObject({
  id: z.string().min(1).max(64), name: z.string().min(1).max(80), type: z.string().min(1),
  x: z.number().finite(), z: z.number().finite(), w: z.number().finite().positive(), d: z.number().finite().positive(),
});
const BuildingSchema = z.looseObject({
  id: z.string().min(1), name: z.string().min(1).max(80),
  footprint: z.object({ width: z.number().finite().positive(), depth: z.number().finite().positive() }),
  defaultOriginId: z.string().optional(),
  workflows: z.array(z.looseObject({ id: z.string(), name: z.string(), description: z.string(), stops: z.array(z.string()) })).optional(),
  floors: z.array(z.looseObject({
    level: z.number().int(), name: z.string().min(1).max(80),
    rooms: z.array(RoomSchema).max(200),
  })).min(1).max(20),
}).superRefine((building, context) => {
  const levels = new Set<number>();
  const roomIds = new Set<string>();
  for (const floor of building.floors) {
    if (levels.has(floor.level)) context.addIssue({ code: "custom", message: `Duplicate floor ${floor.level}.` });
    levels.add(floor.level);
    for (const room of floor.rooms) {
      if (roomIds.has(room.id)) context.addIssue({ code: "custom", message: `Duplicate room id ${room.id}.` });
      roomIds.add(room.id);
    }
  }
  if (!roomIds.size) context.addIssue({ code: "custom", message: "Keep at least one room." });
  if (building.defaultOriginId && !roomIds.has(building.defaultOriginId)) context.addIssue({ code: "custom", message: "Default origin room does not exist." });
  for (const workflow of building.workflows ?? []) {
    if (workflow.stops.some((id) => !roomIds.has(id))) context.addIssue({ code: "custom", message: `Workflow ${workflow.id} refers to a missing room.` });
  }
});
const EditInput = z.object({
  building: BuildingSchema,
  action: z.enum(["rename_building", "resize_building", "add_floor", "rename_floor", "delete_floor", "add_room", "move_room", "resize_room", "rename_room", "delete_room", "duplicate_room", "set_room_type"]),
  level: z.number().int().optional(), roomId: z.string().optional(), name: z.string().min(1).max(80).optional(),
  short: z.string().max(12).optional(), category: z.string().optional(),
  width: z.number().finite().positive().optional(), depth: z.number().finite().positive().optional(),
  x: z.number().finite().optional(), z: z.number().finite().optional(),
});

type EditArgs = z.infer<typeof EditInput>;
type Draft = Omit<BuildingData, "floors" | "workflows"> & {
  floors: Array<{ level: number; name: string; short?: string; rooms: RoomData[] }>;
  workflows?: Array<{ id: string; name: string; description: string; stops: string[] }>;
};

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this action.`);
  return value;
}

function updateDraft(input: EditArgs, roomTypes: RoomTypeMap): Draft {
  const draft = structuredClone(input.building) as unknown as Draft;
  const level = input.level ?? draft.floors.at(-1)!.level;
  const floor = draft.floors.find((entry) => entry.level === level);
  const room = floor?.rooms.find((entry) => entry.id === input.roomId);
  const requireFloor = () => {
    if (!floor) throw new Error(`Floor ${level} does not exist.`);
    return floor;
  };
  const requireRoom = () => {
    if (!room) throw new Error(`Room ${input.roomId ?? "(missing id)"} does not exist on Floor ${level}.`);
    return room;
  };
  const clear = (candidate: RoomData, rooms: readonly RoomData[]) =>
    Math.abs(candidate.x) + candidate.w / 2 <= draft.footprint.width / 2 &&
    Math.abs(candidate.z) + candidate.d / 2 <= draft.footprint.depth / 2 &&
    rooms.every((other) => other === candidate ||
      Math.abs(candidate.x - other.x) >= (candidate.w + other.w) / 2 ||
      Math.abs(candidate.z - other.z) >= (candidate.d + other.d) / 2);
  const uniqueId = (name: string) => {
    const base = `${level}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "room"}`;
    let id = base;
    let suffix = 2;
    while (draft.floors.some((entry) => entry.rooms.some((item) => item.id === id))) id = `${base}-${suffix++}`;
    return id;
  };

  switch (input.action) {
    case "rename_building": draft.name = required(input.name, "name"); break;
    case "resize_building":
      draft.footprint.width = input.width ?? draft.footprint.width;
      draft.footprint.depth = input.depth ?? draft.footprint.depth;
      if (draft.floors.some((entry) => entry.rooms.some((item) =>
        Math.abs(item.x) + item.w / 2 > draft.footprint.width / 2 ||
        Math.abs(item.z) + item.d / 2 > draft.footprint.depth / 2))) throw new Error("Rooms would extend beyond the new footprint.");
      break;
    case "add_floor": {
      const nextLevel = input.level ?? Math.max(...draft.floors.map((entry) => entry.level)) + 1;
      if (draft.floors.some((entry) => entry.level === nextLevel)) throw new Error(`Floor ${nextLevel} already exists.`);
      if (draft.floors.length >= 20) throw new Error("Building already has 20 floors.");
      draft.floors.push({ level: nextLevel, name: input.name ?? `Floor ${nextLevel}`, short: input.short ?? String(nextLevel), rooms: [] });
      break;
    }
    case "rename_floor":
      requireFloor().name = required(input.name, "name");
      if (input.short !== undefined) requireFloor().short = input.short;
      break;
    case "delete_floor": {
      if (draft.floors.length === 1 || draft.floors.reduce((count, entry) => count + entry.rooms.length, 0) === requireFloor().rooms.length) {
        throw new Error("Keep at least one floor and one room.");
      }
      const removed = new Set(requireFloor().rooms.map((entry) => entry.id));
      draft.floors = draft.floors.filter((entry) => entry !== floor);
      draft.workflows = draft.workflows?.map((workflow) => ({ ...workflow, stops: workflow.stops.filter((id) => !removed.has(id)) })).filter((workflow) => workflow.stops.length >= 2);
      if (draft.defaultOriginId && removed.has(draft.defaultOriginId)) delete draft.defaultOriginId;
      break;
    }
    case "add_room":
    case "duplicate_room": {
      const target = requireFloor();
      const original = input.action === "duplicate_room" ? requireRoom() : null;
      const name = input.name ?? (original ? `${original.name} copy` : undefined);
      const category = input.category ?? original?.type;
      if (!name || !category || !roomTypes[category]) throw new Error("A name and valid category are required.");
      const candidate: RoomData = {
        ...(original ?? {}), id: uniqueId(name), name, type: category,
        w: input.width ?? original?.w ?? 5, d: input.depth ?? original?.d ?? 4,
        x: input.x ?? 0, z: input.z ?? 0,
      };
      if (input.x === undefined || input.z === undefined) {
        let found = false;
        for (let z = -draft.footprint.depth / 2 + candidate.d / 2; z <= draft.footprint.depth / 2 - candidate.d / 2 && !found; z += 1) {
          for (let x = -draft.footprint.width / 2 + candidate.w / 2; x <= draft.footprint.width / 2 - candidate.w / 2; x += 1) {
            candidate.x = x; candidate.z = z;
            if (clear(candidate, target.rooms)) { found = true; break; }
          }
        }
        if (!found) throw new Error("No clear area for that room on this floor.");
      } else if (!clear(candidate, target.rooms)) throw new Error("Room would overlap another or extend outside the footprint.");
      target.rooms.push(candidate);
      break;
    }
    case "move_room":
    case "resize_room": {
      const target = requireRoom();
      const proposed = { ...target,
        x: input.x ?? target.x, z: input.z ?? target.z,
        w: input.width ?? target.w, d: input.depth ?? target.d,
      };
      if (!clear(proposed, requireFloor().rooms.filter((entry) => entry !== target))) throw new Error("Room would overlap another or extend outside the footprint.");
      Object.assign(target, proposed);
      break;
    }
    case "rename_room": requireRoom().name = required(input.name, "name"); break;
    case "set_room_type": {
      const category = required(input.category, "category");
      if (!roomTypes[category]) throw new Error("Unknown room category.");
      requireRoom().type = category;
      break;
    }
    case "delete_room": {
      const target = requireRoom();
      if (draft.floors.reduce((count, entry) => count + entry.rooms.length, 0) <= 1) throw new Error("Keep at least one room.");
      requireFloor().rooms = requireFloor().rooms.filter((entry) => entry !== target);
      draft.workflows = draft.workflows?.map((workflow) => ({ ...workflow, stops: workflow.stops.filter((id) => id !== target.id) })).filter((workflow) => workflow.stops.length >= 2);
      if (draft.defaultOriginId === target.id) delete draft.defaultOriginId;
      break;
    }
  }
  return draft;
}

export function registerBuilderTools(server: McpServer, building: BuildingData, roomTypes: RoomTypeMap): void {
  server.registerTool("get_building_template", {
    title: "Get building template", description: "Return a sample building JSON draft for editing; does not change anyone's browser.",
    inputSchema: z.object({}), annotations: { readOnlyHint: true },
  }, async () => {
    const draft = structuredClone(building);
    return { isError: false, content: [{ type: "text", text: JSON.stringify(draft) }], structuredContent: { building: draft } };
  });

  server.registerTool("edit_building_draft", {
    title: "Edit building draft", description: "Apply one stateless edit to a supplied building JSON draft and return the updated draft. Import the JSON in Floor Builder to view it; this tool never writes to a visitor's browser.",
    inputSchema: EditInput, annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args) => {
    try {
      const draft = updateDraft(args, roomTypes);
      return { isError: false, content: [{ type: "text", text: JSON.stringify(draft) }], structuredContent: { building: draft } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid building edit.";
      return { isError: true, content: [{ type: "text", text: message }], structuredContent: { error: { code: "INVALID_INPUT", message } } };
    }
  });
}