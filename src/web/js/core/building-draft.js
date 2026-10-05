export const BUILDING_DRAFT_STORAGE_KEY = "campus-twin:building-draft:v1";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export function isValidBuildingDraft(building) {
  if (!isObject(building) || !hasText(building.id) || !hasText(building.name)) return false;
  if (!isObject(building.footprint) || !isFiniteNumber(building.footprint.width) || !isFiniteNumber(building.footprint.depth)) return false;
  if (building.footprint.width <= 0 || building.footprint.depth <= 0) return false;
  if (building.dimensionBasis !== undefined && !["estimated", "measured"].includes(building.dimensionBasis)) return false;
  if (building.dimensionSource !== undefined && typeof building.dimensionSource !== "string") return false;
  if (!Array.isArray(building.floors) || building.floors.length === 0) return false;

  const levels = new Set();
  const roomIds = new Set();
  for (const floor of building.floors) {
    if (!isObject(floor) || !Number.isInteger(floor.level) || levels.has(floor.level)) return false;
    if (!hasText(floor.name) || !Array.isArray(floor.rooms)) return false;
    if (floor.short !== undefined && typeof floor.short !== "string") return false;
    levels.add(floor.level);

    for (const room of floor.rooms) {
      if (!isObject(room) || !hasText(room.id) || !hasText(room.name) || !hasText(room.type)) return false;
      if (roomIds.has(room.id) || !isFiniteNumber(room.x) || !isFiniteNumber(room.z)) return false;
      if (!isFiniteNumber(room.w) || !isFiniteNumber(room.d) || room.w <= 0 || room.d <= 0) return false;
      roomIds.add(room.id);
    }
  }

  if (roomIds.size === 0) return false;

  if (building.workflows !== undefined) {
    if (!Array.isArray(building.workflows)) return false;
    for (const workflow of building.workflows) {
      if (!isObject(workflow) || !hasText(workflow.id) || !hasText(workflow.name) || !Array.isArray(workflow.stops)) return false;
      if (workflow.stops.some((id) => typeof id !== "string" || !roomIds.has(id))) return false;
    }
  }
  return true;
}

export function readBuildingDraft(fallback, storage = globalThis.localStorage) {
  if (!storage?.getItem) return fallback;
  try {
    const saved = JSON.parse(storage.getItem(BUILDING_DRAFT_STORAGE_KEY) ?? "null");
    return saved?.version === 1 && isValidBuildingDraft(saved.building) ? saved.building : fallback;
  } catch {
    return fallback;
  }
}

export function saveBuildingDraft(building, storage = globalThis.localStorage) {
  if (!isValidBuildingDraft(building)) throw new TypeError("Building draft is invalid.");
  if (!storage?.setItem) return false;
  storage.setItem(BUILDING_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, building }));
  return true;
}

export function clearBuildingDraft(storage = globalThis.localStorage) {
  storage?.removeItem?.(BUILDING_DRAFT_STORAGE_KEY);
}