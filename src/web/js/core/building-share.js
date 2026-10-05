import { isValidBuildingDraft } from "./building-draft.js";

export const SHARE_HASH_KEY = "model";
const FORMAT = "v1";
const MAX_TOKEN_LENGTH = 256 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FLOORS = 100;
const MAX_ROOMS = 3000;
const MAX_TEXT = 500;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => (typeof value === "string" && value.length <= MAX_TEXT ? value : undefined);

function withoutUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/** Copies only known fields so a shared link cannot smuggle extra data into the app. */
function pickBuilding(raw) {
  const roomIds = new Set(raw.floors.flatMap((floor) => floor.rooms.map((room) => room.id)));
  return withoutUndefined({
    id: raw.id,
    name: raw.name,
    subtitle: text(raw.subtitle),
    dimensionBasis: raw.dimensionBasis,
    dimensionSource: text(raw.dimensionSource),
    footprint: { width: raw.footprint.width, depth: raw.footprint.depth },
    floorSpacing: isNumber(raw.floorSpacing) && raw.floorSpacing > 0 ? raw.floorSpacing : undefined,
    circulation: isObject(raw.circulation) && isNumber(raw.circulation.spineZ) ? { spineZ: raw.circulation.spineZ } : undefined,
    defaultOriginId: roomIds.has(raw.defaultOriginId) ? raw.defaultOriginId : undefined,
    floors: raw.floors.map((floor) => withoutUndefined({
      level: floor.level,
      short: floor.short,
      name: floor.name,
      rooms: floor.rooms.map((room) => withoutUndefined({
        id: room.id,
        name: room.name,
        type: room.type,
        x: room.x,
        z: room.z,
        w: room.w,
        d: room.d,
        hours: text(room.hours),
        info: text(room.info),
        capacity: text(room.capacity),
        tags: Array.isArray(room.tags) && room.tags.every((tag) => text(tag) !== undefined) ? [...room.tags] : undefined,
      })),
    })),
    workflows: raw.workflows?.map((workflow) => withoutUndefined({
      id: workflow.id,
      name: workflow.name,
      description: text(workflow.description),
      stops: [...workflow.stops],
    })),
  });
}

function withinLimits(building) {
  if (building.floors.length > MAX_FLOORS) return false;
  const rooms = building.floors.flatMap((floor) => floor.rooms);
  if (rooms.length > MAX_ROOMS) return false;
  const labels = [building.id, building.name, ...building.floors.flatMap((floor) => [floor.name, floor.short ?? ""]),
    ...rooms.flatMap((room) => [room.id, room.name, room.type])];
  return labels.every((label) => label.length <= MAX_TEXT);
}

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Shared model link is malformed.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  let binary;
  try {
    binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw new Error("Shared model link is malformed.");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function readLimited(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Shared model is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function encodeBuildingShare(building) {
  if (!isValidBuildingDraft(building) || !withinLimits(building)) throw new TypeError("Building model is invalid or too large to share.");
  const json = new TextEncoder().encode(JSON.stringify(pickBuilding(building)));
  const compressed = await readLimited(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw")), MAX_TOKEN_LENGTH);
  return `${FORMAT}.${toBase64Url(compressed)}`;
}

/** Returns a sanitized building, or throws if the token is not a valid shared model. */
export async function decodeBuildingShare(token) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !token.startsWith(`${FORMAT}.`)) {
    throw new Error("Shared model link is not supported.");
  }
  const compressed = fromBase64Url(token.slice(FORMAT.length + 1));
  let raw;
  try {
    const json = await readLimited(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")), MAX_JSON_BYTES);
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch (error) {
    if (/too large/.test(error?.message)) throw error;
    throw new Error("Shared model link is damaged or incomplete.");
  }
  if (!isValidBuildingDraft(raw) || !withinLimits(raw)) throw new Error("Shared model link does not contain a valid building.");
  const building = pickBuilding(raw);
  if (!isValidBuildingDraft(building)) throw new Error("Shared model link does not contain a valid building.");
  return building;
}

export function readShareToken(hash = globalThis.location?.hash ?? "") {
  return new URLSearchParams(hash.replace(/^#/, "")).get(SHARE_HASH_KEY);
}

export async function buildShareUrl(building, page = "studio.html", base = globalThis.location?.href) {
  const url = new URL(page, base);
  url.search = "";
  url.hash = new URLSearchParams({ [SHARE_HASH_KEY]: await encodeBuildingShare(building) }).toString();
  return url.toString();
}
