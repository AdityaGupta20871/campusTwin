import { s, hexColor, tint } from "./dom.js";
import { rectOf, areaOf } from "../core/geometry.js";

const MARGIN = 9;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;

/**
 * Architectural 2D floor plan (SVG). One floor at a time; pan (drag), zoom (wheel / buttons), click to pick.
 * Coordinates are metres: x → right (east), z → down (south).
 */
let planSeq = 0;

export function createPlan2D(container, model, { onPick = () => {}, onMoveRoom = null } = {}) {
  const uid = `pl${++planSeq}`;
  const { width: W, depth: D } = model.building.footprint;
  const hw = W / 2;
  const hd = D / 2;
  const gridStep = Math.max(1, Math.ceil(Math.max(W, D) / 64));
  const majorStep = gridStep * 5;
  const gridExtent = Math.max(W, D) + MARGIN * 8;
  const estimateSuffix = model.building.dimensionBasis === "measured" ? "" : " est.";
  const home = { x: -hw - MARGIN, y: -hd - MARGIN, w: W + MARGIN * 2, h: D + MARGIN * 2 };
  let view = { ...home };
  let level = model.floors[0].level;
  let selectedId = null;
  let hereId = null;
  let route = null;
  let routeKind = "route";
  let typeFilter = null;

  const svg = s("svg", { class: "plan-svg", role: "img", "aria-label": "Floor plan" });
  const defs = s("defs");
  const minor = s("pattern", { id: `${uid}-minor`, width: gridStep, height: gridStep, patternUnits: "userSpaceOnUse" }, [s("path", { d: `M${gridStep} 0H0V${gridStep}`, class: "pl-grid-minor" })]);
  const major = s("pattern", { id: `${uid}-major`, width: majorStep, height: majorStep, patternUnits: "userSpaceOnUse", x: -hw, y: -hd }, [
    s("rect", { width: majorStep, height: majorStep, fill: `url(#${uid}-minor)` }),
    s("path", { d: `M${majorStep} 0H0V${majorStep}`, class: "pl-grid-major" }),
  ]);
  defs.append(minor, major);
  svg.append(defs);

  const layers = {
    grid: s("rect", { x: -gridExtent / 2, y: -gridExtent / 2, width: gridExtent, height: gridExtent, fill: `url(#${uid}-major)`, class: "pl-grid" }),
    shell: s("g", { class: "pl-shell" }),
    rooms: s("g", { class: "pl-rooms" }),
    labels: s("g", { class: "pl-labels" }),
    route: s("g", { class: "pl-route" }),
    pins: s("g", { class: "pl-pins" }),
    annot: s("g", { class: "pl-annot" }),
  };
  svg.append(...Object.values(layers));
  container.append(svg);

  // ---------- Static shell: footprint, corridor, dimensions, north arrow ----------
  layers.shell.append(
    s("rect", { x: -hw, y: -hd, width: W, height: D, class: "pl-footprint" }),
    s("line", { x1: -hw + 0.6, y1: model.spineZ, x2: hw - 0.6, y2: model.spineZ, class: "pl-spine" })
  );

  const dimY = -hd - 4;
  const dimX = -hw - 4;
  layers.annot.append(
    s("line", { x1: -hw, y1: dimY, x2: hw, y2: dimY, class: "pl-dim" }),
    s("line", { x1: -hw, y1: dimY - 0.8, x2: -hw, y2: dimY + 0.8, class: "pl-dim" }),
    s("line", { x1: hw, y1: dimY - 0.8, x2: hw, y2: dimY + 0.8, class: "pl-dim" }),
    s("text", { x: 0, y: dimY - 1, class: "pl-dim-text", "text-anchor": "middle", text: `${W.toFixed(1)} m${estimateSuffix}` }),
    s("line", { x1: dimX, y1: -hd, x2: dimX, y2: hd, class: "pl-dim" }),
    s("line", { x1: dimX - 0.8, y1: -hd, x2: dimX + 0.8, y2: -hd, class: "pl-dim" }),
    s("line", { x1: dimX - 0.8, y1: hd, x2: dimX + 0.8, y2: hd, class: "pl-dim" }),
    s("text", { x: dimX - 1, y: 0, class: "pl-dim-text", "text-anchor": "middle", transform: `rotate(-90 ${dimX - 1} 0)`, text: `${D.toFixed(1)} m${estimateSuffix}` }),
    s("g", { class: "pl-north", transform: `translate(${hw + 4.5} ${-hd - 4})` }, [
      s("circle", { r: 2.2 }),
      s("path", { d: "M0 -1.7 L0.9 1 L0 0.4 L-0.9 1 Z" }),
      s("text", { y: -2.8, "text-anchor": "middle", text: "N" }),
    ]),
    s("text", { x: hw - 1, y: model.spineZ - 0.5, class: "pl-spine-text", "text-anchor": "end", text: "MAIN CORRIDOR" })
  );

  // ---------- Rendering ----------
  function renderRooms() {
    layers.rooms.replaceChildren();
    layers.labels.replaceChildren();
    for (const entry of model.roomsOnFloor(level)) {
      const { room, type } = entry;
      const r = rectOf(room);
      const dimmed = typeFilter && entry.typeKey !== typeFilter ? " dimmed" : "";
      const g = s("g", { class: `pl-room${room.id === selectedId ? " selected" : ""}${dimmed}`, "data-room-id": room.id, "data-type": entry.typeKey, tabindex: 0, role: "button", "aria-label": `${room.name}, ${entry.floor.name}` });
      g.append(
        s("rect", { x: r.minX, y: r.minZ, width: room.w, height: room.d, fill: hexColor(tint(type.color, 0.62)), class: "pl-room-fill" }),
        s("rect", { x: r.minX, y: r.minZ, width: room.w, height: room.d, class: "pl-room-wall" })
      );
      layers.rooms.append(g);

      const size = Math.max(0.55, Math.min(1.15, (room.w - 0.8) / Math.max(4, room.name.length * 0.62)));
      const label = s("g", { class: "pl-label", transform: `translate(${room.x} ${room.z})` });
      label.append(s("text", { y: -0.15, "font-size": size.toFixed(2), class: "pl-label-name", "text-anchor": "middle", text: room.name }));
      if (room.d >= 4) {
        label.append(s("text", { y: size + 0.35, "font-size": (size * 0.72).toFixed(2), class: "pl-label-area", "text-anchor": "middle", text: `${areaOf(room).toFixed(0)} m²${estimateSuffix}` }));
      }
      layers.labels.append(label);
    }
  }

  function renderSelection() {
    for (const g of layers.rooms.children) g.classList.toggle("selected", g.dataset.roomId === selectedId);
    layers.pins.replaceChildren();
    const sel = selectedId && model.getRoom(selectedId);
    if (sel && sel.level === level) {
      const r = rectOf(sel.room);
      layers.pins.append(
        s("rect", { x: r.minX - 0.35, y: r.minZ - 0.35, width: sel.room.w + 0.7, height: sel.room.d + 0.7, class: "pl-select-ring" }),
        s("text", { x: sel.room.x, y: r.maxZ + 1.4, class: "pl-select-dims", "text-anchor": "middle", text: `${sel.room.w.toFixed(1)} × ${sel.room.d.toFixed(1)} m${estimateSuffix}` })
      );
    }
    const here = hereId && model.getRoom(hereId);
    if (here && here.level === level) {
      layers.pins.append(
        s("g", { class: "pl-here", transform: `translate(${here.room.x} ${here.room.z})` }, [
          s("circle", { r: 2.2, class: "pl-here-pulse" }),
          s("circle", { r: 0.9, class: "pl-here-dot" }),
          s("text", { y: -1.6, "text-anchor": "middle", text: "YOU ARE HERE" }),
        ])
      );
    }
  }

  function renderRoute() {
    layers.route.replaceChildren();
    layers.route.setAttribute("class", `pl-route kind-${routeKind}`);
    if (!route) return;
    const legs = route.legs.filter((l) => l.level === level && l.points.length > 1);
    for (const leg of legs) {
      const d = `M${leg.points.map((p) => `${p.x.toFixed(2)} ${p.z.toFixed(2)}`).join(" L")}`;
      layers.route.append(s("path", { d, class: "pl-route-halo" }), s("path", { d, class: "pl-route-line" }));
      const a = leg.points[0];
      const b = leg.points.at(-1);
      layers.route.append(s("circle", { cx: a.x, cy: a.z, r: 0.7, class: "pl-route-start" }), s("circle", { cx: b.x, cy: b.z, r: 0.9, class: "pl-route-end" }));
    }
    for (const v of route.verticals) {
      if (v.fromLevel !== level && v.toLevel !== level) continue;
      const leaving = v.fromLevel === level;
      const other = model.getFloor(leaving ? v.toLevel : v.fromLevel);
      const arrow = v.toLevel > v.fromLevel ? "↑" : "↓";
      const text = `${arrow} ${v.via === "lift" ? "LIFT" : "STAIRS"} ${leaving ? "TO" : "FROM"} ${other?.short ?? ""}`;
      layers.route.append(
        s("g", { class: "pl-route-badge", transform: `translate(${v.at.x} ${v.at.z - 2.6})` }, [
          s("rect", { x: -4.4, y: -1, width: 8.8, height: 2, rx: 1 }),
          s("text", { y: 0.42, "text-anchor": "middle", text }),
        ])
      );
    }
  }

  function applyView() {
    svg.setAttribute("viewBox", `${view.x.toFixed(3)} ${view.y.toFixed(3)} ${view.w.toFixed(3)} ${view.h.toFixed(3)}`);
  }

  // ---------- Interaction ----------
  function toWorld(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  function zoomAt(factor, cx, cy) {
    const current = home.w / view.w;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
    const k = current / next;
    const p = cx === undefined ? { x: view.x + view.w / 2, y: view.y + view.h / 2 } : toWorld(cx, cy);
    view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k };
    applyView();
  }

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    },
    { passive: false }
  );

  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    const room = onMoveRoom && e.button === 0 ? e.target.closest?.("[data-room-id]") : null;
    drag = { x: e.clientX, y: e.clientY, start: toWorld(e.clientX, e.clientY), moved: false, view: { ...view }, room };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.room) {
      const point = toWorld(e.clientX, e.clientY);
      const dx = point.x - drag.start.x;
      const dz = point.y - drag.start.y;
      drag.room.setAttribute("transform", `translate(${dx} ${dz})`);
      return;
    }
    const m = svg.getScreenCTM();
    if (!m) return;
    view = { ...drag.view, x: drag.view.x - (e.clientX - drag.x) / m.a, y: drag.view.y - (e.clientY - drag.y) / m.d };
    applyView();
    svg.classList.add("panning");
  });
  svg.addEventListener("pointerup", (e) => {
    const wasDrag = drag?.moved;
    const room = drag?.room;
    const start = drag?.start;
    drag = null;
    svg.classList.remove("panning");
    if (wasDrag && room) {
      const point = toWorld(e.clientX, e.clientY);
      onMoveRoom(room.dataset.roomId, point.x - start.x, point.y - start.y);
      return;
    }
    if (wasDrag) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-room-id]");
    onPick(hit ? hit.dataset.roomId : null);
  });
  svg.addEventListener("dblclick", () => fit());
  svg.addEventListener("keydown", (e) => {
    const hit = e.target.closest?.("[data-room-id]");
    if (hit && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onPick(hit.dataset.roomId);
    }
  });

  function fit() {
    view = { ...home };
    const rect = container.getBoundingClientRect();
    if (rect.width && rect.height) {
      const aspect = rect.width / rect.height;
      if (aspect > home.w / home.h) {
        const w = home.h * aspect;
        view = { x: -w / 2, y: home.y, w, h: home.h };
      } else {
        const hh = home.w / aspect;
        view = { x: home.x, y: -hh / 2, w: home.w, h: hh };
      }
    }
    applyView();
  }

  const resizeObserver = new ResizeObserver(() => fit());
  resizeObserver.observe(container);
  renderRooms();
  fit();

  return {
    destroy() {
      resizeObserver.disconnect();
      svg.remove();
    },
    setLevel(next) {
      if (next === level || !model.getFloor(next)) return;
      level = next;
      renderRooms();
      renderSelection();
      renderRoute();
    },
    getLevel: () => level,
    setSelected(id) {
      selectedId = id;
      renderSelection();
    },
    setHere(id) {
      hereId = id;
      renderSelection();
    },
    setRoute(next, kind = "route") {
      route = next;
      routeKind = kind;
      renderRoute();
    },
    setTypeFilter(type) {
      typeFilter = type || null;
      for (const g of layers.rooms.children) g.classList.toggle("dimmed", Boolean(typeFilter) && g.dataset.type !== typeFilter);
    },
    zoomIn: () => zoomAt(1.3),
    zoomOut: () => zoomAt(1 / 1.3),
    fit,
    svg,
  };
}
