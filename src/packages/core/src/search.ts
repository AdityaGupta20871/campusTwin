import { distance } from "./geometry.js";
import type { BuildingModel, ModelEntry } from "./model.js";

export interface SearchOptions {
  limit?: number;
  near?: ModelEntry | null;
  types?: readonly string[] | null;
}

export const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function scoreEntry(entry: ModelEntry, query: string): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;
  const name = normalizeText(entry.room.name);
  const tags = (entry.room.tags ?? []).map(normalizeText);
  const typeLabel = normalizeText(entry.type.label);

  if (entry.id === normalizedQuery) return 100;
  if (name === normalizedQuery) return 95;
  if (name.startsWith(normalizedQuery)) return 80;
  if (tags.includes(normalizedQuery)) return 70;
  if (name.includes(normalizedQuery)) return 60;
  if (typeLabel === normalizedQuery || typeLabel.startsWith(normalizedQuery)) return 50;
  if (tags.some((tag) => tag.includes(normalizedQuery))) return 40;
  if (typeLabel.includes(normalizedQuery)) return 35;

  const haystack = `${name} ${tags.join(" ")} ${typeLabel} ${normalizeText(entry.typeKey)}`;
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) return 30;
  return 0;
}

export function proximityCost(from: ModelEntry | null, to: ModelEntry): number {
  if (!from) return 0;
  return Math.abs(from.level - to.level) * 1000 + distance(from.room, to.room);
}

export function searchRooms(
  model: Pick<BuildingModel, "entries">,
  query: string,
  options: SearchOptions = {},
): { entry: ModelEntry; score: number }[] {
  const { limit = 10, near = null, types = null } = options;
  const pool = types ? model.entries.filter((entry) => types.includes(entry.typeKey)) : model.entries;
  const seen = new Set<string>();
  return pool
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ entry, score }) => score > 0 && !seen.has(entry.id) && Boolean(seen.add(entry.id)))
    .sort(
      (a, b) =>
        b.score - a.score ||
        proximityCost(near, a.entry) - proximityCost(near, b.entry) ||
        a.entry.level - b.entry.level ||
        a.entry.room.name.localeCompare(b.entry.room.name),
    )
    .slice(0, limit);
}

export function sortByProximity(entries: readonly ModelEntry[], near: ModelEntry | null): ModelEntry[] {
  return [...entries].sort(
    (a, b) =>
      proximityCost(near, a) - proximityCost(near, b) ||
      a.level - b.level ||
      a.room.name.localeCompare(b.room.name),
  );
}