#!/usr/bin/env node
// Prints the full tool catalog (core + presentation) as Markdown, e.g. to refresh docs/TOOL_CATALOG.md.
import { listToolCatalog } from "../packages/core/dist/index.js";

const catalog = listToolCatalog();
const lines = [`| Tool | Category | Read-only | Inputs | Description |`, `|---|---|---|---|---|`];
for (const t of catalog) {
  const props = Object.entries(t.inputSchema.properties ?? {})
    .map(([k]) => (t.inputSchema.required?.includes(k) ? `**${k}**` : k))
    .join(", ");
  lines.push(`| \`${t.name}\` | ${t.category} | ${t.readOnly ? "yes" : "no"} | ${props || "–"} | ${t.description} |`);
}
process.stdout.write(`${lines.join("\n")}\n\nTotal: ${catalog.length} tools\n`);
