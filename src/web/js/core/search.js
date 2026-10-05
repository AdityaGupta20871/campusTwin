import { distance } from "./geometry.js";

export const normalizeText = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Relevance score for a room against a normalised query (0 = no match). */
export function scoreEntry(entry, query) {
  const q = normalizeText(query);
  if (!q) return 0;
  const name = normalizeText(entry.room.name);
  const tags = (entry.room.tags ?? []).map(normalizeText);
  const typeLabel = normalizeText(entry.type.label);

  if (entry.id === q) return 100;
  if (name === q) return 95;
  if (name.startsWith(q)) return 80;
  if (tags.includes(q)) return 70;
  if (name.includes(q)) return 60;
  if (typeLabel === q || typeLabel.startsWith(q)) return 50;
  if (tags.some((t) => t.includes(q))) return 40;
  if (typeLabel.includes(q)) return 35;

  const haystack = `${name} ${tags.join(" ")} ${typeLabel} ${normalizeText(entry.typeKey)}`;
  const tokens = q.split(" ").filter((t) => t.length > 1);
  if (tokens.length > 1 && tokens.every((t) => haystack.includes(t))) return 30;
  return 0;
}

/** Proximity cost used to break ties: floors dominate, then planar distance. */
export function proximityCost(from, to) {
  if (!from) return 0;
  return Math.abs(from.level - to.level) * 1000 + distance(from.room, to.room);
}

export function searchRooms(model, query, { limit = 10, near = null, types = null } = {}) {
  const pool = types ? model.entries.filter((e) => types.includes(e.typeKey)) : model.entries;
  const seen = new Set();
  return pool
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ entry, score }) => score > 0 && !seen.has(entry.id) && seen.add(entry.id))
    .sort(
      (a, b) =>
        b.score - a.score ||
        proximityCost(near, a.entry) - proximityCost(near, b.entry) ||
        a.entry.level - b.entry.level ||
        a.entry.room.name.localeCompare(b.entry.room.name)
    )
    .slice(0, limit);
}

export function sortByProximity(entries, near) {
  return [...entries].sort(
    (a, b) =>
      proximityCost(near, a) - proximityCost(near, b) ||
      a.level - b.level ||
      a.room.name.localeCompare(b.room.name)
  );
}
