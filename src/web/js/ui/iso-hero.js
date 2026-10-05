import { s, hexColor, tint } from "./dom.js";
import { findRoute } from "../core/wayfinding.js";
import { rectOf } from "../core/geometry.js";

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const iso = (x, y, z) => [(x - z) * COS, (x + z) * SIN - y];
const pts = (list) => list.map(([x, y, z]) => iso(x, y, z).map((n) => n.toFixed(2)).join(",")).join(" ");

function shade(n, amount) {
  const f = (c) => Math.round(c * (1 - amount));
  return (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
}

/** Extruded box; `color` null leaves fills to CSS. */
function box(r, y0, y1, className, color) {
  const { minX, maxX, minZ, maxZ } = rectOf(r);
  const fill = (amount) => (color === null ? null : hexColor(shade(color, amount)));
  const g = s("g", { class: className });
  g.append(
    s("polygon", { points: pts([[maxX, y0, minZ], [maxX, y0, maxZ], [maxX, y1, maxZ], [maxX, y1, minZ]]), class: "iso-face-e", fill: fill(0.22) }),
    s("polygon", { points: pts([[minX, y0, maxZ], [maxX, y0, maxZ], [maxX, y1, maxZ], [minX, y1, maxZ]]), class: "iso-face-s", fill: fill(0.12) }),
    s("polygon", { points: pts([[minX, y1, minZ], [maxX, y1, minZ], [maxX, y1, maxZ], [minX, y1, maxZ]]), class: "iso-face-top", fill: fill(0) })
  );
  return g;
}

/**
 * Renders an exploded axonometric drawing of the building into an <svg>,
 * with toggleable layers (plan / structure / route / dims) and a live route.
 */
export function renderIsoModel(svg, model, { from = model.defaultOriginId, to, gap = 11 } = {}) {
  const { width: W, depth: D } = model.building.footprint;
  const hw = W / 2;
  const hd = D / 2;
  const yOf = (level) => (level - model.floors[0].level) * gap;
  const top = yOf(model.floors.at(-1).level) + 4;

  const corners = [];
  for (const y of [-1, top]) for (const x of [-hw - 6, hw + 6]) for (const z of [-hd - 6, hd + 6]) corners.push(iso(x, y, z));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  svg.setAttribute("viewBox", `${minX.toFixed(1)} ${minY.toFixed(1)} ${(Math.max(...xs) - minX).toFixed(1)} ${(Math.max(...ys) - minY).toFixed(1)}`);
  svg.replaceChildren();

  // Site grid (ground plane)
  const grid = s("g", { class: "iso-grid layer-structure" });
  for (let x = -hw - 6; x <= hw + 6; x += 6) grid.append(s("polyline", { points: pts([[x, -1, -hd - 6], [x, -1, hd + 6]]) }));
  for (let z = -hd - 6; z <= hd + 6; z += 6) grid.append(s("polyline", { points: pts([[-hw - 6, -1, z], [hw + 6, -1, z]]) }));
  svg.append(grid);

  model.floors.forEach((floor, i) => {
    const y = yOf(floor.level);
    const g = s("g", { class: "iso-floor" });
    g.style.setProperty("--i", String(i));

    g.append(box({ x: 0, z: 0, w: W, d: D }, y - 0.8, y, "iso-slab", null));

    // Flat rooms first, then extruded cores back-to-front (painter's algorithm).
    const isCore = (room) => room.type === "lift" || room.type === "stairs";
    const ordered = [...floor.rooms.filter((r) => !isCore(r)), ...floor.rooms.filter(isCore).sort((a, b) => a.x + a.z - (b.x + b.z))];
    for (const room of ordered) {
      const type = model.roomTypes[room.type] ?? model.roomTypes.other;
      if (isCore(room)) {
        g.append(box(room, y, y + 3.2, "iso-core layer-structure", tint(type.color, 0.15)));
      } else {
        const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = rectOf(room);
        g.append(
          s("polygon", {
            points: pts([[x0 + 0.3, y + 0.05, z0 + 0.3], [x1 - 0.3, y + 0.05, z0 + 0.3], [x1 - 0.3, y + 0.05, z1 - 0.3], [x0 + 0.3, y + 0.05, z1 - 0.3]]),
            class: "iso-room layer-plan",
            fill: hexColor(tint(type.color, 0.3)),
          })
        );
      }
    }

    const [tx, ty] = iso(-hw - 2, y, hd + 2);
    g.append(s("text", { x: tx.toFixed(2), y: ty.toFixed(2), class: "iso-dim layer-dims", "text-anchor": "end", text: `${floor.short === "G" ? "L0" : `L${floor.level}`} · +${(floor.level * 3.5).toFixed(2)}` }));
    svg.append(g);
  });

  // Footprint dimensions on the ground floor
  const dims = s("g", { class: "iso-dims layer-dims" });
  const y0 = yOf(model.floors[0].level);
  dims.append(
    s("polyline", { points: pts([[-hw, y0, hd + 4], [hw, y0, hd + 4]]) }),
    s("polyline", { points: pts([[hw + 4, y0, -hd], [hw + 4, y0, hd]]) })
  );
  const [wx, wy] = iso(0, y0, hd + 6.5);
  const [dx, dy] = iso(hw + 6.5, y0, 0);
  dims.append(
    s("text", { x: wx.toFixed(2), y: wy.toFixed(2), "text-anchor": "middle", class: "iso-dim", text: `${W.toFixed(2)} m` }),
    s("text", { x: dx.toFixed(2), y: dy.toFixed(2), "text-anchor": "middle", class: "iso-dim", text: `${D.toFixed(2)} m` })
  );
  svg.append(dims);

  // Live route computed by the same wayfinding engine the agent uses
  let route = null;
  if (to && from && model.hasRoom(from) && model.hasRoom(to)) {
    route = findRoute(model, from, to);
    const path = route.legs.flatMap((l) => l.points.map((p) => iso(p.x, yOf(l.level) + 0.4, p.z)));
    const d = `M${path.map((p) => p.map((n) => n.toFixed(2)).join(" ")).join(" L")}`;
    const g = s("g", { class: "iso-route layer-route" });
    const marker = s("circle", { r: "1.1", class: "iso-agent" });
    marker.append(s("animateMotion", { dur: "7s", repeatCount: "indefinite", path: d }));
    g.append(
      s("path", { d, class: "iso-route-base" }),
      s("path", { d, class: "iso-route-line" }),
      s("circle", { cx: path[0][0].toFixed(2), cy: path[0][1].toFixed(2), r: "1", class: "iso-route-start" }),
      s("circle", { cx: path.at(-1)[0].toFixed(2), cy: path.at(-1)[1].toFixed(2), r: "1.3", class: "iso-route-end" }),
      marker
    );
    svg.append(g);
  }
  return { route };
}
