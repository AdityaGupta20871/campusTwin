import "./fonts.js";
import qrcode from "qrcode-generator";
import { createElement, ZoomIn, ZoomOut, RotateCcw, Building2 } from "lucide";
import { createRuntime } from "../core/runtime.js";
import { readBuildingDraft } from "../core/building-draft.js";
import { building as starterBuilding } from "../data/building-data.js";
import { createConciergeAgent } from "../core/agent.js";
import { createStore, appendActivity } from "../core/store.js";
import { searchRooms } from "../core/search.js";
import { validateLayout } from "../core/validation.js";
import { spaceMetrics } from "../core/metrics.js";
import { formatDuration } from "../core/wayfinding.js";
import { VIEWS } from "../core/tools.js";
import { createPlan2D } from "../ui/plan2d.js";
import { h, s, $, hexColor, tint, isTypingTarget } from "../ui/dom.js";
import { registerWebMcpTools } from "./webmcp.js";

const VIEW_LABEL = Object.freeze({ plan: "Floor plan", orbit: "3D orbit", walk: "Walk" });
const ROUTE_LABEL = Object.freeze({ route: "ROUTE", emergency: "EVACUATION", itinerary: "ITINERARY" });
const FILTERS = Object.freeze([
  { type: null, label: "All" },
  { type: "restroom", label: "Restroom" },
  { type: "pantry", label: "Pantry" },
  { type: "cafeteria", label: "Cafeteria" },
  { type: "firstaid", label: "First Aid" },
]);
let facility = null;
const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

// ---------- State ----------
const store = createStore({
  view: "orbit",
  activeLevel: null,
  selectedId: null,
  hereId: null,
  route: null,
  routeMeta: null,
  cameraCmd: null,
  activity: [],
  lastEvent: null,
  tab: "agent",
});
let cameraSeq = 0;
const camera = (cmd) => ({ ...cmd, seq: ++cameraSeq });

const session = {
  getHereId: () => store.getState().hereId,
  setHereId: (id) => store.setState({ hereId: id }),
};

let model = null;

function effectiveLevel(s = store.getState()) {
  if (s.activeLevel !== null) return s.activeLevel;
  const sel = s.selectedId && model.getRoom(s.selectedId);
  return s.route?.legs[0]?.level ?? sel?.level ?? model.getRoom(s.hereId)?.level ?? model.floors[0].level;
}

/** Presenter: the only way tools change what the user sees. */
const presenter = {
  getState() {
    const s = store.getState();
    return {
      view: s.view,
      activeLevel: s.activeLevel,
      activeFloor: s.activeLevel === null ? "All floors" : model.getFloor(s.activeLevel)?.name ?? null,
      selectedRoomId: s.selectedId,
      hereRoomId: s.hereId,
      route: s.routeMeta ? { kind: s.routeMeta.kind, title: s.routeMeta.title } : null,
    };
  },
  setView(view) {
    const s = store.getState();
    store.setState({ view, ...(view !== "orbit" && s.activeLevel === null && { activeLevel: effectiveLevel(s) }) });
  },
  setActiveFloor(level) {
    store.setState({ activeLevel: level, cameraCmd: camera({ type: "level", level }) });
  },
  focusRoom(id) {
    store.setState({ selectedId: id, activeLevel: model.getRoom(id).level, cameraCmd: camera({ type: "room", id }) });
  },
  showRoute(route, meta) {
    const s = store.getState();
    const levels = [...new Set(route.legs.map((l) => l.level))];
    const destination = route.to?.id ?? route.stops?.at(-1)?.id ?? null;
    const activeLevel = levels.length === 1 ? levels[0] : s.view === "orbit" ? null : levels[0] ?? null;
    store.setState({ route, routeMeta: meta, selectedId: destination, activeLevel, cameraCmd: camera({ type: s.view === "walk" ? "room" : "route", id: route.from?.id }) });
  },
  clear() {
    store.setState({ selectedId: null, route: null, routeMeta: null });
  },
};

// ---------- Runtime ----------
const building = readBuildingDraft(starterBuilding);
// The API only knows the bundled building, so custom drafts must use the in-browser agent.
const usingCustomDraft = building !== starterBuilding;
const runtime = createRuntime({
  building,
  session,
  presenter,
  onEvent: (e) => {
    if (e.cause) console.error(`[tool:${e.tool}]`, e.cause);
    const entry = { id: e.id, at: Date.now(), actor: e.actor, tool: e.tool, ok: e.ok, summary: e.summary, readOnly: e.readOnly };
    store.setState((s) => ({ activity: appendActivity(s.activity, entry), lastEvent: entry }));
  },
});
model = runtime.model;
if (!isMobile()) {
  const startFloor = model.getFloor(2) ?? model.floors[0];
  const suggestedRoom = model.roomsOnFloor(startFloor.level).find((entry) => ["meeting", "training", "reception"].includes(entry.typeKey));
  if (suggestedRoom) store.setState({ selectedId: suggestedRoom.id });
}
const { executor } = runtime;
const human = (tool, args = {}) => executor.execute(tool, args, { actor: "human" });
const agent = createConciergeAgent({ model, executor, presentation: true, getHereId: session.getHereId });

// ---------- Toast ----------
let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

// ---------- Views ----------
function onPick(id) {
  closeResults();
  if (id) {
    human("focus_room", { roomId: id }).then(() => setTab("details"));
  } else {
    store.setState({ selectedId: null });
  }
}

const plan = createPlan2D($("viewport-plan"), model, { onPick });
const preview = $("plan-preview") ? createPlan2D($("plan-preview"), model, { onPick }) : null;

let scene3d = null;
try {
  const { createScene3D } = await import("../ui/scene3d.js");
  scene3d = createScene3D($("viewport-3d"), model, { onPick });
} catch (err) {
  console.error("3D view unavailable", err);
  $("viewport-3d").replaceChildren(h("p", { className: "empty-state", text: "3D is unavailable on this device or network. Using the 2D plan." }));
  store.setState({ view: "plan", activeLevel: model.floors[0].level });
  toast("3D unavailable — showing the 2D floor plan");
}

// ---------- Static UI ----------
for (const [id, icon, action] of [
  ["model-zoom-in", ZoomIn, () => scene3d?.zoomBy(0.8)],
  ["model-zoom-out", ZoomOut, () => scene3d?.zoomBy(1.25)],
  ["model-reset", RotateCcw, () => scene3d?.resetCamera()],
  ["model-overview", Building2, () => human("set_active_floor", { level: null })],
]) {
  $(id).append(createElement(icon, { width: 18, height: 18, "aria-hidden": "true" }));
  $(id).addEventListener("click", action);
}
$("building-name").textContent = model.building.name;
$("building-sub").textContent = `${model.floors.length} LEVELS · ${model.entries.length} SPACES · ${model.building.dimensionBasis === "measured" ? "MEASURED" : "ESTIMATED"}`;
$("tb-project").textContent = model.building.name;
document.title = `Studio – ${model.building.name}`;

const floorsTopDown = [...model.floors].reverse();

function levelButtons(container, render) {
  container.replaceChildren(
    render(null, "All", "All floors"),
    ...floorsTopDown.map((f) => render(f.level, f.short, f.name, f.rooms.length))
  );
}

levelButtons($("level-list"), (level, short, name, count) =>
  h("li", {}, [
    h("button", { attrs: { type: "button" }, dataset: { level: level ?? "all" }, on: { click: () => human("set_active_floor", { level }) } }, [
      h("span", { className: "lvl", text: short }),
      h("span", { text: name }),
      h("span", { className: "count", text: count === undefined ? "" : `${count}` }),
    ]),
  ])
);

levelButtons($("floor-stack"), (level, short, name) =>
  h("button", { text: short, attrs: { type: "button", title: name, "aria-label": name }, dataset: { level: level ?? "all" }, on: { click: () => human("set_active_floor", { level }) } })
);

function setFacility(type) {
  facility = type;
  for (const b of $("chips").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.type === (type ?? "all")));
  plan.setTypeFilter?.(type);
  preview?.setTypeFilter?.(type);
  scene3d?.setTypeFilter?.(type);
  renderContext(store.getState());
  renderDirectory(store.getState());
}

$("chips").replaceChildren(
  ...FILTERS.filter((q) => !q.type || model.roomsOfType(q.type).length).map((q) =>
    h("button", {
      className: "chip",
      attrs: { type: "button", "aria-pressed": String(!q.type) },
      dataset: { type: q.type ?? "all" },
      on: { click: () => setFacility(q.type) },
    }, [q.label])
  )
);

$("workflow-list").replaceChildren(
  ...model.workflows.map((wf) =>
    h("li", {}, [
      h("button", { attrs: { type: "button" }, on: { click: () => human("show_itinerary", { workflowId: wf.id }) } }, [
        h("strong", { text: wf.name }),
        h("span", { text: wf.description }),
      ]),
    ])
  )
);

// ---------- Directory ----------
function renderDirectory(s) {
  const floors = s.activeLevel === null ? floorsTopDown : floorsTopDown.filter((f) => f.level === s.activeLevel);
  const items = [];
  let count = 0;
  for (const f of floors) {
    items.push(h("li", { className: "group", text: f.name }));
    const entries = model.roomsOnFloor(f.level).sort((a, b) => a.room.name.localeCompare(b.room.name));
    count += entries.length;
    for (const e of entries) {
      const swatch = h("span", { className: "swatch" });
      swatch.style.background = hexColor(tint(e.type.color, 0.2));
      items.push(
        h("li", {}, [
          h("button", { attrs: { type: "button", "aria-current": String(e.id === s.selectedId) }, dataset: { roomId: e.id }, on: { click: () => onPick(e.id) } }, [
            swatch,
            h("span", { text: e.room.name }),
            h("span", { className: "meta", text: e.type.label }),
          ]),
        ])
      );
    }
  }
  $("directory").replaceChildren(...items);
  $("dir-count").textContent = `${count}`;
}

// ---------- Details ----------
function areaLabel(room) {
  const estimated = model.building.dimensionBasis === "measured" ? "" : " est.";
  return `${(room.w * room.d).toFixed(0)} m²${estimated}`;
}

function renderDetails(s) {
  const root = $("details");
  const entry = s.selectedId && model.getRoom(s.selectedId);
  document.body.classList.toggle("has-room", Boolean(entry));
  if (!entry) {
    root.replaceChildren();
    return;
  }
  const { room, type, floor } = entry;
  const isHere = s.hereId === room.id;
  const facts = [room.capacity, room.hours, room.contact, room.tags?.join(", ")].filter(Boolean);
  root.replaceChildren(
    h("article", { className: "detail" }, [
      h("div", { className: "detail-scene", attrs: { "aria-label": entry.typeKey === "lift" ? "Reference photograph of an elevator lobby, not this building" : `${type.label} room preview`, role: "img" }, dataset: { type: entry.typeKey } }, [
        h("span", { className: "scene-caption", text: entry.typeKey === "lift" ? `${type.label} · reference photo` : `${type.label}  ·  ${floor.name}` }),
        entry.typeKey === "lift" ? h("a", { className: "photo-credit", text: "w_lemay · CC BY-SA 2.0", attrs: { href: "https://commons.wikimedia.org/wiki/File:Elevator_Lobby,_Renaissance_Center,_Jefferson_Avenue,_Detroit,_MI.jpg", target: "_blank", rel: "noopener noreferrer" } }) : null,
      ]),
      h("p", { className: "detail-kicker", text: type.label }),
      h("h2", { text: room.name }),
      isHere ? h("p", {}, [h("span", { className: "here-pill", text: "You are here" })]) : null,
      h("p", { className: "detail-meta", text: `${floor.name}  ·  ${areaLabel(room)}` }),
      room.info ? h("p", { text: room.info }) : null,
      facts.length ? h("p", { className: "muted", text: facts.join(" · ") }) : null,
      h("p", { className: "muted", text: `${floor.name}, ${model.building.name}` }),
      h("div", { className: "actions" }, [
        h("button", { className: "btn", text: isHere ? "Location set" : "Set as my location", attrs: { type: "button", disabled: isHere }, on: { click: () => human("set_my_location", { roomId: room.id }) } }),
        h("button", { className: "btn", text: "Show indicative route", attrs: { type: "button", disabled: isHere }, on: { click: () => human("navigate_to", { toRoomId: room.id }) } }),
      ]),
    ])
  );
}

function floorQrUrl(level) {
  const url = new URL("qr.html", location.href);
  url.searchParams.set("floor", String(level));
  return url;
}

function studioFloorUrl(level) {
  const url = new URL("studio.html", location.href);
  url.searchParams.set("floor", String(level));
  return url;
}

function paintQr(el, text) {
  if (!el || typeof qrcode !== "function") return;
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

const SPACE_ICON_SHAPES = Object.freeze({
  reception: [["path", { d: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" }], ["path", { d: "M10 21h4" }]],
  cafeteria: [["path", { d: "M4 3v7a3 3 0 0 0 6 0V3M7 3v18M17 3v18M17 3c3 2 3 6 0 8" }]],
  pantry: [["path", { d: "M5 8h14l-1 12H6L5 8Z" }], ["path", { d: "M8 8V5a4 4 0 0 1 8 0v3M19 11h1a2 2 0 0 1 0 4h-2" }]],
  restroom: [["circle", { cx: "8", cy: "6", r: "2.5" }], ["circle", { cx: "16", cy: "6", r: "2.5" }], ["path", { d: "M3 20v-2a5 5 0 0 1 10 0v2M13 13a5 5 0 0 1 8 4v3" }]],
  firstaid: [["path", { d: "M12 3v18M3 12h18" }], ["circle", { cx: "12", cy: "12", r: "9" }]],
  security: [["path", { d: "m12 3 8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z" }]],
  lounge: [["path", { d: "M4 12V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M3 12a2 2 0 0 1 2 2v4h14v-4a2 2 0 0 1 2-2M5 18v2M19 18v2" }]],
  workspace: [["rect", { x: "3", y: "4", width: "18", height: "13", rx: "2" }], ["path", { d: "M8 21h8M12 17v4" }]],
  meeting: [["circle", { cx: "9", cy: "7", r: "3" }], ["circle", { cx: "17", cy: "8", r: "2.5" }], ["path", { d: "M3 20v-2a6 6 0 0 1 12 0v2M15 14a5 5 0 0 1 6 5v1" }]],
  training: [["circle", { cx: "9", cy: "7", r: "3" }], ["circle", { cx: "17", cy: "8", r: "2.5" }], ["path", { d: "M3 20v-2a6 6 0 0 1 12 0v2M15 14a5 5 0 0 1 6 5v1" }]],
  lift: [["path", { d: "M5 3h14v18H5zM9 7l3-2 3 2M12 5v5M9 17l3 2 3-2M12 19v-5" }]],
  stairs: [["path", { d: "M4 20h5v-5h5v-5h5V5h2M20 5h-5M20 5v5" }]],
});

function spaceIcon(typeKey) {
  const svg = s("svg", {
    viewBox: "0 0 24 24",
    class: "space-icon",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  for (const [tag, attrs] of SPACE_ICON_SHAPES[typeKey] ?? SPACE_ICON_SHAPES.workspace) svg.append(s(tag, attrs));
  return h("span", { className: "space-mark" }, [svg]);
}

function renderContext(s) {
  const level = s.activeLevel ?? (s.selectedId && model.getRoom(s.selectedId)?.level) ?? (model.getFloor(2) ? 2 : model.floors[0].level);
  const floor = model.getFloor(level);
  if (!floor) return;
  $("floor-title").textContent = floor.name;
  const qrTitle = $("qr-floor-title");
  if (qrTitle) qrTitle.textContent = floor.name;
  const place = $("qr-place");
  if (place) place.textContent = `${floor.name} · ${model.building.name}`;
  const href = floorQrUrl(level);
  $("floor-qr-link").href = href.toString();
  const print = $("print-qr");
  if (print) print.href = href.toString();
  const moreQr = $("more-qr");
  if (moreQr) moreQr.href = href.toString();
  paintQr($("floor-qr-code"), studioFloorUrl(level).toString());

  let entries = model.roomsOnFloor(level);
  if (facility) entries = entries.filter((e) => e.typeKey === facility);
  const cards = entries.map((e) => {
    const card = h("button", {
      className: "space-card",
      attrs: { type: "button", "aria-current": String(e.id === s.selectedId) },
      on: { click: () => onPick(e.id) },
    }, [
      spaceIcon(e.typeKey),
      h("strong", { text: e.room.name }),
      h("span", { text: areaLabel(e.room) }),
    ]);
    card.style.setProperty("--space-color", hexColor(e.type.color));
    card.style.background = hexColor(tint(e.type.color, 0.87));
    return card;
  });
  $("spaces").replaceChildren(...(cards.length ? cards : [h("p", { className: "empty", text: facility ? "No rooms of this type on this floor." : "No rooms on this floor." })]));

  const selected = s.selectedId && model.getRoom(s.selectedId);
  const pool = model.roomsOnFloor(selected?.level ?? level).filter((e) => e.id !== selected?.id);
  const origin = selected?.room ?? { x: 0, z: 0 };
  const near = [...pool].sort((a, b) => Math.hypot(a.room.x - origin.x, a.room.z - origin.z) - Math.hypot(b.room.x - origin.x, b.room.z - origin.z)).slice(0, 4);
  $("nearby").replaceChildren(
    ...near.map((e) =>
      h("li", {}, [
        h("button", { attrs: { type: "button" }, on: { click: () => onPick(e.id) } }, [
          spaceIcon(e.typeKey),
          h("span", { className: "nearby-copy" }, [
            h("strong", { text: e.room.name }),
            h("span", { text: areaLabel(e.room) }),
          ]),
          h("span", { text: "›" }),
        ]),
      ])
    )
  );
}

// ---------- Route card ----------
function renderRouteCard(s) {
  const card = $("route-card");
  if (!s.route || !s.routeMeta) {
    card.classList.add("hidden");
    return;
  }
  const r = s.route;
  card.className = `route-card kind-${s.routeMeta.kind}`;
  $("route-kind").textContent = ROUTE_LABEL[s.routeMeta.kind] ?? "ROUTE";
  $("route-title").textContent = s.routeMeta.title;
  const via = r.via && !["walk", "none"].includes(r.via) ? ` · VIA ${r.via.toUpperCase()}` : "";
  $("route-meta").textContent = `${formatDuration(r.etaSeconds)} · ${r.distanceM} M${via}`;
  const steps = r.segments
    ? r.segments.map((seg, i) => `${i + 1}. ${seg.to.name} (${seg.to.floor}) — ${formatDuration(seg.etaSeconds)}`)
    : r.steps;
  const levels = [...new Set(r.legs.map((l) => l.level))];
  $("route-steps").replaceChildren(...steps.map((t) => h("li", { text: t })));
  if (levels.length > 1) {
    $("route-steps").append(
      h("li", { className: "suggestions" }, levels.map((lvl) => h("button", { className: "chip", text: `Show ${model.getFloor(lvl).name}`, attrs: { type: "button" }, on: { click: () => human("set_active_floor", { level: lvl }) } })))
    );
  }
  card.classList.remove("hidden");
}
$("route-close").addEventListener("click", () => human("clear_map"));

// ---------- Checks ----------
function renderChecks(result) {
  const { summary, issues } = result;
  const bad = summary.errors > 0;
  const sumEl = $("checks-summary");
  sumEl.className = `checks-summary ${bad ? "bad" : "ok"}`;
  sumEl.textContent = issues.length ? `${summary.errors} error(s) · ${summary.warnings} warning(s)` : "All checks passed";
  $("checks-list").replaceChildren(
    ...(issues.length
      ? issues.map((i) =>
          h("li", { className: i.severity }, [h("code", { text: `${i.severity.toUpperCase()} · ${i.code}` }), i.message])
        )
      : [h("li", { className: "pass", text: "No overlaps, footprint breaches, missing exits or broken workflows." })])
  );
  const count = $("checks-count");
  count.textContent = String(issues.length);
  count.classList.toggle("bad", bad);
  const status = $("status-issues");
  status.textContent = issues.length ? `${summary.errors} ERR · ${summary.warnings} WARN` : "CHECKS PASS";
  status.className = bad ? "bad" : "ok";
}

function renderSchedule() {
  const m = spaceMetrics(model);
  const row = (cells, tag = "td") => h("tr", {}, cells.map((c) => h(tag, { text: c })));
  $("schedule").replaceChildren(
    h("thead", {}, [row(["LEVEL", "ROOMS", "NET M²", "GROSS M²", "DESKS"], "th")]),
    h("tbody", {}, m.floors.map((f) => row([f.floor, f.rooms, f.netAreaM2, f.grossAreaM2, f.workstations]))),
    h("tfoot", {}, [row(["Total", m.totals.rooms, m.totals.netAreaM2, m.totals.grossAreaM2, m.totals.workstations])])
  );
  $("status-metrics").textContent = `${m.totals.grossAreaM2.toLocaleString()} M² GFA · ${m.totals.floors} LEVELS · ${m.totals.rooms} SPACES`;
}

$("run-checks").addEventListener("click", async () => {
  const res = await human("validate_layout");
  if (res.ok) renderChecks(res.data);
});

// ---------- Activity ----------
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
function renderActivity(s) {
  $("activity").replaceChildren(
    ...s.activity.slice(0, 80).map((a) =>
      h("li", { className: a.ok ? "" : "fail" }, [
        h("span", { className: `actor actor-${a.actor}`, text: a.actor === "human" ? "YOU" : a.actor }),
        h("span", {}, [h("span", { className: "tool", text: a.tool }), h("span", { className: "sum", text: a.summary })]),
        h("span", { className: "time", text: timeFmt.format(a.at) }),
      ])
    )
  );
}

function renderLastAction(e) {
  const el = $("tb-action");
  if (!e) {
    el.textContent = "—";
    return;
  }
  el.replaceChildren(h("span", { className: `actor actor-${e.actor}`, text: e.actor === "human" ? "YOU" : e.actor }), ` ${e.tool} — ${e.summary}`);
}

// ---------- Tabs & panels ----------
const workspace = document.querySelector(".workspace");
const resizeHandles = [
  { element: document.querySelector(".resize-left"), property: "--rail-width", min: 104, max: 320 },
  { element: document.querySelector(".resize-right"), property: "--context-width", min: 320, max: 960 },
];

function sidebarWidth(side) {
  const bounds = workspace.getBoundingClientRect();
  const stage = $("stage").getBoundingClientRect();
  return side.property === "--rail-width" ? stage.left - bounds.left : bounds.right - stage.right;
}

function resizeSidebar(side, width) {
  const other = resizeHandles.find((handle) => handle !== side);
  const available = workspace.clientWidth - sidebarWidth(other) - 320;
  const next = Math.round(Math.max(side.min, Math.min(width, side.max, available)));
  workspace.style.setProperty(side.property, `${next}px`);
  side.element.setAttribute("aria-valuenow", String(next));
}

for (const side of resizeHandles) {
  side.element.setAttribute("aria-valuemin", String(side.min));
  side.element.setAttribute("aria-valuemax", String(side.max));
  side.element.setAttribute("aria-valuenow", String(Math.round(sidebarWidth(side))));
  side.element.addEventListener("pointerdown", (event) => {
    if (isMobile()) return;
    side.element.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
    event.preventDefault();
  });
  side.element.addEventListener("pointermove", (event) => {
    if (!side.element.hasPointerCapture(event.pointerId)) return;
    const bounds = workspace.getBoundingClientRect();
    resizeSidebar(side, side.property === "--rail-width" ? event.clientX - bounds.left : bounds.right - event.clientX);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    side.element.addEventListener(name, () => document.body.classList.remove("is-resizing"));
  }
  side.element.addEventListener("keydown", (event) => {
    if (isMobile() || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    resizeSidebar(side, sidebarWidth(side) + direction * (side.property === "--rail-width" ? 16 : -16));
  });
}
window.addEventListener("resize", () => {
  requestAnimationFrame(() => {
    if (isMobile()) return;
    for (const side of [...resizeHandles].reverse()) {
      if (workspace.style.getPropertyValue(side.property)) resizeSidebar(side, sidebarWidth(side));
      else side.element.setAttribute("aria-valuenow", String(Math.round(sidebarWidth(side))));
    }
  });
});

function setTab(tab) {
  store.setState({ tab });
  if (isMobile()) document.body.dataset.right = "open";
}
for (const btn of $("tabs").querySelectorAll("button")) {
  btn.addEventListener("click", () => {
    if (isMobile() && document.body.dataset.right === "open" && store.getState().tab === btn.dataset.tab) {
      document.body.dataset.right = "closed";
      return;
    }
    setTab(btn.dataset.tab);
  });
}
$("toggle-right").addEventListener("click", () => {
  document.body.dataset.right = document.body.dataset.right === "open" ? "closed" : "open";
});
$("toggle-left").addEventListener("click", () => {
  document.body.dataset.left = document.body.dataset.left === "open" ? "closed" : "open";
});
$("left-panel").addEventListener("click", (e) => {
  if (isMobile() && e.target.closest("button")) document.body.dataset.left = "closed";
});
if (isMobile()) document.body.dataset.right = "closed";

// ---------- View switch & plan tools ----------
for (const btn of $("view-switch").querySelectorAll("button")) {
  btn.addEventListener("click", () => human("switch_view", { view: btn.dataset.view }));
}
$("zoom-in").addEventListener("click", () => { plan.zoomIn(); preview?.zoomIn(); });
$("zoom-out").addEventListener("click", () => { plan.zoomOut(); preview?.zoomOut(); });
$("zoom-fit").addEventListener("click", () => { plan.fit(); preview?.fit(); });
$("emergency")?.addEventListener("click", () => human("show_emergency_exit"));
$("emergency-off")?.addEventListener("click", () => human("clear_map"));
$("view-plan")?.addEventListener("click", async () => {
  await human("switch_view", { view: "plan" });
  document.body.dataset.screen = "map";
});
$("view-all-spaces")?.addEventListener("click", () => {
  setFacility(null);
  if (isMobile()) document.body.dataset.screen = "rooms";
});
$("sheet-close")?.addEventListener("click", () => human("clear_map"));
for (const btn of document.querySelectorAll(".tabbar button")) {
  btn.addEventListener("click", () => {
    document.body.dataset.screen = btn.dataset.screen;
    for (const b of document.querySelectorAll(".tabbar button")) b.setAttribute("aria-current", b === btn ? "page" : "false");
  });
}

// ---------- Search ----------
const searchEl = $("search");
const resultsEl = $("results");
let resultButtons = [];
let resultIndex = -1;

function closeResults() {
  resultsEl.classList.add("hidden");
  resultIndex = -1;
}

function renderResults(query) {
  const near = model.getRoom(store.getState().hereId);
  const hits = searchRooms(model, query, { limit: 8, near });
  const items = hits.map(({ entry }) =>
    h("li", {}, [
      h("button", { attrs: { type: "button", role: "option" }, on: { click: () => pickResult(entry.id) } }, [
        h("span", { text: entry.type.icon }),
        h("span", { text: entry.room.name }),
        h("span", { className: "floor", text: entry.floor.short === "G" ? "GF" : `L${entry.level}` }),
      ]),
    ])
  );
  if (!hits.length) items.push(h("li", { className: "empty", text: "No matching rooms." }));
  items.push(
    h("li", {}, [
      h("button", { className: "ask", attrs: { type: "button", role: "option" }, on: { click: () => askFromSearch(query) } }, [
        h("span", { text: "✦" }),
        h("span", { text: `Ask the agent: “${query}”` }),
        h("span", { className: "floor", text: "↵" }),
      ]),
    ])
  );
  resultsEl.replaceChildren(...items);
  resultButtons = [...resultsEl.querySelectorAll("button")];
  resultIndex = -1;
  resultsEl.classList.remove("hidden");
}

function pickResult(id) {
  closeResults();
  searchEl.value = "";
  searchEl.blur();
  onPick(id);
}

function askFromSearch(query) {
  closeResults();
  searchEl.value = "";
  searchEl.blur();
  sendToAgent(query);
}

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim();
  if (q) renderResults(q);
  else closeResults();
});
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeResults();
    searchEl.blur();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!resultButtons.length) return;
    e.preventDefault();
    resultIndex = (resultIndex + (e.key === "ArrowDown" ? 1 : -1) + resultButtons.length) % resultButtons.length;
    resultButtons.forEach((b, i) => b.setAttribute("aria-selected", String(i === resultIndex)));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const q = searchEl.value.trim();
    if (!q) return;
    const target = resultButtons[resultIndex] ?? (resultButtons.length > 1 ? resultButtons[0] : resultButtons.at(-1));
    target?.click();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".search")) closeResults();
});

// ---------- Agent chat ----------
const chatLog = $("chat-log");
let agentBusy = false;

function renderAgentMessage(res) {
  const { reply, trace, intent } = res;
  const node = h("div", { className: `msg agent${reply.tone ? ` tone-${reply.tone}` : ""}` }, [
    h("div", { className: "msg-head" }, [h("span", { className: "actor actor-agent", text: "AGENT" }), h("span", { text: `INTENT · ${intent.toUpperCase()}` })]),
    h("p", { text: reply.text }),
  ]);
  if (reply.steps?.length) node.append(h("ol", {}, reply.steps.map((st) => h("li", { text: st }))));
  if (trace.length) {
    node.append(
      h("details", { className: "trace", attrs: { open: true } }, [
        h("summary", { text: `TOOL TRACE · ${trace.length} CALL${trace.length > 1 ? "S" : ""}` }),
        h(
          "ol",
          {},
          trace.map((t) =>
            h("li", { className: t.ok ? "" : "err" }, [
              h("span", { text: t.ok ? "✓" : "✕" }),
              h("span", {}, [h("span", { className: "fn", text: t.tool }), h("span", { className: "args", text: `(${JSON.stringify(t.args)})` }), h("span", { className: "res", text: `→ ${t.summary}` })]),
            ])
          )
        ),
      ])
    );
  }
  if (reply.suggestions?.length) {
    node.append(h("div", { className: "suggestions" }, reply.suggestions.map((sg) => h("button", { className: "chip agent", text: sg, attrs: { type: "button" }, on: { click: () => sendToAgent(sg) } }))));
  }
  chatLog.append(node);
  for (const d of chatLog.querySelectorAll("details.trace")) if (!node.contains(d)) d.open = false;
  node.scrollIntoView({ block: "end", behavior: "smooth" });
}

async function sendToAgent(text) {
  const message = String(text ?? "").trim();
  if (!message || agentBusy) return;
  agentBusy = true;
  setTab("agent");
  chatLog.append(h("div", { className: "msg user", text: message }));
  try {
    let response;
    try {
      if (usingCustomDraft) throw new Error("Custom building drafts are answered locally.");
      const hereRoomId = store.getState().hereId;
      const apiResponse = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, ...(hereRoomId && { hereRoomId }) }),
      });
      if (apiResponse.status === 404) throw new Error("Chat API is not deployed.");
      const body = await apiResponse.json();
      if (!apiResponse.ok) {
        const error = new Error(body.error?.message ?? "The agent request could not be processed.");
        error.status = apiResponse.status;
        throw error;
      }
      response = body;
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      response = await agent.respond(message);
    }

    for (const action of response.clientActions ?? []) {
      const { type, ...args } = action;
      const result = await executor.execute(type, args, { actor: "agent" });
      if (!result.ok) toast(result.error.message);
    }
    renderAgentMessage(response);
  } catch (err) {
    console.error(err);
    renderAgentMessage({ intent: "error", trace: [], reply: { text: err.status && err.status < 500 ? err.message : "Something went wrong while running the agent. Please try again.", tone: "danger" } });
  } finally {
    agentBusy = false;
  }
}

$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const value = input.value;
  input.value = "";
  sendToAgent(value);
});

// ---------- Share ----------
async function share({ room } = {}) {
  const s = store.getState();
  const url = new URL(location.pathname, location.origin);
  if (s.hereId) url.searchParams.set("here", s.hereId);
  const roomId = room ?? s.selectedId;
  if (roomId) url.searchParams.set("room", roomId);
  else if (s.activeLevel !== null) url.searchParams.set("floor", String(s.activeLevel));
  if (s.view !== "orbit") url.searchParams.set("view", s.view);
  const title = roomId ? `${model.getRoom(roomId).room.name} – ${model.building.name}` : model.building.name;
  if (navigator.share) {
    try {
      await navigator.share({ title, url: url.toString() });
    } catch {
      /* user cancelled */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url.toString());
    toast("Link copied");
  } catch {
    toast(url.toString());
  }
}
$("share").addEventListener("click", () => share());

// ---------- Keyboard ----------
document.addEventListener("keydown", (e) => {
  if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") {
    e.preventDefault();
    searchEl.focus();
  } else if (["1", "2", "3"].includes(e.key)) {
    human("switch_view", { view: VIEWS[Number(e.key) - 1] });
  } else if (e.key === "Escape") {
    const s = store.getState();
    if (s.route || s.selectedId) human("clear_map");
  }
});

// ---------- Reactive rendering ----------
function render(s, prev, changed) {
  const has = (k) => changed.has(k);

  if (has("view")) {
    for (const b of $("view-switch").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.view === s.view));
    $("viewport-plan").classList.toggle("hidden", s.view !== "plan");
    $("viewport-3d").classList.toggle("hidden", s.view === "plan");
    if (s.view === "plan") $("stage").style.setProperty("--camera-bearing", "0rad");
    $("walk-hint").classList.toggle("hidden", s.view !== "walk");
    $("hero-copy")?.classList.toggle("hidden", s.view !== "orbit");
    $("model-tools").hidden = s.view !== "orbit" || !scene3d;
    scene3d?.setView(s.view);
    scene3d?.setVisible(s.view !== "plan");
    if (s.view === "plan") plan.fit();
    $("tb-view").textContent = VIEW_LABEL[s.view];
  }

  if (has("activeLevel") || has("route") || has("selectedId") || has("view")) {
    const level = effectiveLevel(s);
    plan.setLevel(level);
    preview?.setLevel(level);
    scene3d?.setActiveLevel(s.view === "orbit" ? s.activeLevel : level);
    const current = String(s.view === "orbit" ? s.activeLevel ?? "all" : level);
    for (const b of document.querySelectorAll("#level-list button, #floor-stack button")) {
      b.setAttribute("aria-current", String(b.dataset.level === current));
      if (b.dataset.level === "all") b.hidden = s.view !== "orbit";
    }
    const floor = model.getFloor(level);
    const showAll = s.view === "orbit" && s.activeLevel === null;
    const planStatus = model.building.dimensionBasis === "measured" ? "PLAN · MEASURED" : "PLAN · ESTIMATED";
    $("tb-level").textContent = showAll ? "All floors" : floor.name;
    $("sheet-tag").textContent = showAll
      ? `A-000 · ALL LEVELS · ${VIEW_LABEL[s.view].toUpperCase()}`
      : `A-1${String(level).padStart(2, "0")} · ${floor.name.toUpperCase()} · ${s.view === "plan" ? planStatus : VIEW_LABEL[s.view].toUpperCase()}`;
  }

  if (has("activeLevel") || has("selectedId")) {
    renderDirectory(s);
    renderContext(s);
  }

  if (has("selectedId") || has("hereId")) {
    scene3d?.setSelected(s.selectedId);
    plan.setSelected(s.selectedId);
    preview?.setSelected(s.selectedId);
    renderDetails(s);
    renderContext(s);
    const sel = s.selectedId && model.getRoom(s.selectedId);
    $("status-selection").textContent = sel ? `SELECTED · ${sel.room.name.toUpperCase()} · ${sel.floor.name.toUpperCase()}` : "NO ROOM SELECTED";
  }

  if (has("hereId")) {
    scene3d?.setHere(s.hereId);
    plan.setHere(s.hereId);
    preview?.setHere(s.hereId);
    const here = s.hereId && model.getRoom(s.hereId);
    $("status-here").textContent = here ? `📍 YOU · ${here.room.name.toUpperCase()}` : "";
  }

  if (has("route") || has("routeMeta")) {
    scene3d?.setRoute(s.route, s.routeMeta?.kind);
    preview?.setRoute(s.route, s.routeMeta?.kind);
    document.body.classList.toggle("is-emergency", s.routeMeta?.kind === "emergency");
    $("emergency-banner")?.classList.toggle("hidden", s.routeMeta?.kind !== "emergency");
    renderRouteCard(s);
  }

  if (has("cameraCmd") && s.cameraCmd && scene3d) {
    const c = s.cameraCmd;
    if (c.type === "room") scene3d.focusRoom(c.id ?? s.selectedId);
    else if (c.type === "route") scene3d.frameRoute();
    else if (c.type === "level") scene3d.flyToLevel(s.view === "orbit" ? c.level : effectiveLevel(s));
  }

  if (has("activity")) renderActivity(s);
  if (has("lastEvent")) renderLastAction(s.lastEvent);

  if (has("tab")) {
    for (const b of $("tabs").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.tab === s.tab));
    for (const id of ["agent", "details", "checks", "activity"]) $(`tab-${id}`).hidden = id !== s.tab;
  }
}

store.subscribe(render);
render(store.getState(), {}, new Set(Object.keys(store.getState())));
renderChecks(validateLayout(model));
renderSchedule();

// ---------- WebMCP ----------
const webmcp = registerWebMcpTools(executor);
const pill = $("webmcp-pill");
pill.classList.toggle("on", webmcp.registered > 0);
$("webmcp-text").textContent = webmcp.registered > 0 ? `WebMCP · ${webmcp.registered} tools` : "WebMCP · not detected";
pill.title = webmcp.registered > 0 ? "Tools are registered with navigator.modelContext for browser agents." : "This browser does not expose navigator.modelContext. The built-in agent still works.";
$("status-tools").textContent = `${executor.list().length} TOOLS · ${webmcp.registered > 0 ? "WEBMCP ON" : "WEBMCP OFF"}`;

// ---------- Welcome + deep links ----------
renderAgentMessage(await agent.respond("help"));

const params = new URLSearchParams(location.search);
const here = params.get("here");
if (here && model.hasRoom(here)) await human("set_my_location", { roomId: here });
const start = model.getFloor(2) ? 2 : model.floors.at(-1).level;
  store.setState({ activeLevel: start });
  
const view = params.get("view");
if (VIEWS.includes(view) && scene3d) await human("switch_view", { view });

const room = params.get("room");
const floorParam = params.get("floor");
const workflow = params.get("workflow");
const ask = params.get("ask");

if (room && model.hasRoom(room)) {
  await human("focus_room", { roomId: room });
  setTab("details");
} else if (here && model.hasRoom(here)) {
  await human("focus_room", { roomId: here });
} else if (floorParam !== null && /^-?\d{1,3}$/.test(floorParam) && model.getFloor(Number(floorParam))) {
  await human("set_active_floor", { level: Number(floorParam) });
} else {
  scene3d?.flyToLevel(null);
}
if (workflow && model.getWorkflow(workflow)) await human("show_itinerary", { workflowId: workflow });
if (ask && ask.length <= 200) sendToAgent(ask);

requestAnimationFrame(() => requestAnimationFrame(() => $("loading").classList.add("done")));
