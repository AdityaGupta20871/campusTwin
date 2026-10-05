import "./fonts.js";
import qrcode from "qrcode-generator";
import { createElement, GripVertical } from "lucide";
import { building as starterBuilding, roomTypes } from "../data/building-data.js";
import { parseBuilderCommand } from "../core/builder-commands.js";
import { createModel } from "../core/model.js";
import { clearBuildingDraft, isValidBuildingDraft, readBuildingDraft, saveBuildingDraft } from "../core/building-draft.js";
import { buildShareUrl, decodeBuildingShare, readShareToken } from "../core/building-share.js";
import { createPlan2D } from "../ui/plan2d.js";
import { $, h, hexColor, tint } from "../ui/dom.js";
import { registerWebMcpTools } from "./webmcp.js";

let building = structuredClone(readBuildingDraft(starterBuilding));
let model = createModel(building, roomTypes);
let activeLevel = model.floors[0].level;
let selectedRoomId = model.floors[0].rooms[0]?.id ?? null;
let plan = null;
let placingRoom = false;

const currentFloor = () => building.floors.find((floor) => floor.level === activeLevel);
const selectedRoom = () => currentFloor()?.rooms.find((room) => room.id === selectedRoomId) ?? null;
const allRooms = () => building.floors.flatMap((floor) => floor.rooms);

function setStatus(message, isError = false) {
  const status = $("save-state");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function persist() {
  try {
    if (saveBuildingDraft(building)) setStatus("Draft saved in this browser");
    else setStatus("Browser storage unavailable; download the JSON draft", true);
  } catch (error) {
    setStatus(error.message || "Draft could not be saved", true);
  }
}

function renderHeader() {
  const estimated = building.dimensionBasis !== "measured";
  $("project-name").textContent = building.name;
  $("dimension-status").textContent = estimated ? "Estimated dimensions" : "Measured dimensions";
  $("dimension-status").classList.toggle("measured", !estimated);
  $("dimension-note").textContent = estimated
    ? "Starter geometry is approximate. Replace it with verified drawing or site measurements before relying on dimensions."
    : "Marked as measured. Keep the source note with the dimensions used for this plan.";
  $("footprint-width").value = String(building.footprint.width);
  $("footprint-depth").value = String(building.footprint.depth);
  $("dimension-basis").value = estimated ? "estimated" : "measured";
  $("dimension-source").value = building.dimensionSource ?? "";
}

function renderFloorControls() {
  const floorSelect = $("floor-select");
  floorSelect.replaceChildren(
    ...model.floors.map((floor) => {
      const option = document.createElement("option");
      option.value = String(floor.level);
      option.textContent = `${floor.short || floor.level} · ${floor.name}`;
      return option;
    })
  );
  floorSelect.value = String(activeLevel);
  $("floor-count").textContent = `${building.floors.length} TOTAL`;
  $("floor-name").value = currentFloor()?.name ?? "";
  $("floor-short").value = currentFloor()?.short ?? "";
  $("delete-floor").disabled = building.floors.length <= 1;
}

function renderRoomList() {
  const entries = model.roomsOnFloor(activeLevel);
  const items = entries.map(({ room, type }) => {
    const swatch = h("span", { className: "room-swatch" });
    swatch.style.backgroundColor = hexColor(tint(type.color, 0.15));
    return h("li", {}, [
      h("button", {
        attrs: { type: "button", "aria-pressed": String(room.id === selectedRoomId) },
        on: { click: () => { selectedRoomId = room.id; render(); } },
      }, [
        swatch,
        h("span", { className: "room-name", text: room.name }),
        h("span", { className: "room-size", text: `${room.w.toFixed(1)} × ${room.d.toFixed(1)} m` }),
      ]),
    ]);
  });
  if (!items.length) items.push(h("li", { className: "list-empty", text: "No spaces on this floor." }));
  $("room-list").replaceChildren(...items);
}

function renderRoomForm() {
  const room = selectedRoom();
  $("room-form").hidden = !room;
  $("room-empty").hidden = Boolean(room);
  if (!room) return;

  $("room-name").value = room.name;
  $("room-type").value = room.type;
  $("room-width").value = String(room.w);
  $("room-depth").value = String(room.d);
  $("room-x").value = String(room.x);
  $("room-z").value = String(room.z);
  $("room-area").textContent = `${(room.w * room.d).toFixed(1)} m²${building.dimensionBasis === "measured" ? "" : " · estimated"}`;
  $("delete-room").disabled = allRooms().length <= 1;
}

function syncPlacementUi() {
  $("plan-canvas").classList.toggle("placing", placingRoom);
  $("place-room").textContent = placingRoom ? "Cancel placement" : "Place on plan";
  $("place-room").setAttribute("aria-pressed", String(placingRoom));
  $("placement-state").textContent = placingRoom ? "PLACE SPACE · CLICK PLAN" : "READY";
}

function handlePlanPick(id) {
  if (placingRoom) return;
  selectedRoomId = id;
  plan?.setSelected(id);
  renderRoomList();
  renderRoomForm();
}

function moveRoom(room, x, z) {
  const { width, depth } = building.footprint;
  const clampCenter = (value, envelopeSize, roomSize) => {
    const min = -envelopeSize / 2 + roomSize / 2;
    const max = envelopeSize / 2 - roomSize / 2;
    return min > max ? 0 : Math.min(max, Math.max(min, Math.round(value * 2) / 2));
  };
  const nextX = clampCenter(x, width, room.w);
  const nextZ = clampCenter(z, depth, room.d);
  if (currentFloor().rooms.some((other) => other !== room &&
    Math.abs(nextX - other.x) < (room.w + other.w) / 2 &&
    Math.abs(nextZ - other.z) < (room.d + other.d) / 2)) {
    setStatus("Space overlaps another room; choose a clear location", true);
    render();
    return false;
  }
  room.x = nextX;
  room.z = nextZ;
  selectedRoomId = room.id;
  placingRoom = false;
  saveAndRender();
  return true;
}

function placeSelectedRoom(event) {
  if (!placingRoom || !plan) return;
  const matrix = plan.svg.getScreenCTM();
  if (!matrix) return;
  const point = plan.svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const position = point.matrixTransform(matrix.inverse());
  const room = selectedRoom();
  if (!room) return;

  moveRoom(room, position.x, position.y);
}

function renderPlan() {
  plan?.destroy();
  const canvas = $("plan-canvas");
  canvas.replaceChildren();
  plan = createPlan2D(canvas, model, {
    onPick: handlePlanPick,
    onMoveRoom(id, dx, dz) {
      const room = currentFloor().rooms.find((entry) => entry.id === id);
      if (room) moveRoom(room, room.x + dx, room.z + dz);
    },
  });
  plan.setLevel(activeLevel);
  plan.setSelected(selectedRoomId);
  plan.svg.setAttribute("aria-label", `${currentFloor().name} floor plan`);
  plan.svg.addEventListener("click", placeSelectedRoom);
}

function render() {
  model = createModel(building, roomTypes);
  if (!model.getFloor(activeLevel)) activeLevel = model.floors[0].level;
  if (selectedRoomId && !model.getRoom(selectedRoomId)) selectedRoomId = null;
  renderHeader();
  renderFloorControls();
  renderRoomList();
  renderRoomForm();
  const floor = currentFloor();
  $("canvas-title").textContent = floor.name;
  const basis = building.dimensionBasis === "measured" ? "MEASURED" : "ESTIMATED";
  $("canvas-meta").textContent = `${basis} · ${floor.rooms.length} SPACES`;
  $("canvas-size").textContent = `${building.footprint.width.toFixed(1)} × ${building.footprint.depth.toFixed(1)} M`;
  renderPlan();
  syncPlacementUi();
}

function saveAndRender() {
  persist();
  render();
}

function createRoomId(floor, name) {
  const prefix = (floor.short || String(floor.level)).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "space";
  const base = `${prefix}-${slug}`;
  let candidate = base;
  let suffix = 2;
  while (allRooms().some((room) => room.id === candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function findFreePosition(floor, width, depth) {
  const envelope = building.footprint;
  const startX = -envelope.width / 2 + width / 2;
  const endX = envelope.width / 2 - width / 2;
  const startZ = -envelope.depth / 2 + depth / 2;
  const endZ = envelope.depth / 2 - depth / 2;
  if (startX > endX || startZ > endZ) return { x: 0, z: 0 };

  for (let z = startZ; z <= endZ; z += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const occupied = floor.rooms.some((room) =>
        Math.abs(x - room.x) < (width + room.w) / 2 + 0.25 &&
        Math.abs(z - room.z) < (depth + room.d) / 2 + 0.25
      );
      if (!occupied) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

function addRoom(type = "other", location = null, options = {}) {
  const floor = currentFloor();
  const name = options.name ?? `New ${type === "other" ? "space" : roomTypes[type].label} ${floor.rooms.length + 1}`;
  const width = options.width ?? Math.min(5, building.footprint.width);
  const depth = options.depth ?? Math.min(4, building.footprint.depth);
  if (width < 0.5 || depth < 0.5 || width > building.footprint.width || depth > building.footprint.depth) {
    throw new Error("Space dimensions must fit inside the building footprint.");
  }
  const position = findFreePosition(floor, width, depth);
  if (floor.rooms.some((other) => Math.abs(position.x - other.x) < (width + other.w) / 2 &&
    Math.abs(position.z - other.z) < (depth + other.d) / 2)) {
    throw new Error("No clear area for that space on this floor.");
  }
  const room = { id: createRoomId(floor, name), name, type, ...position, w: width, d: depth };
  floor.rooms.push(room);
  selectedRoomId = room.id;
  placingRoom = true;
  if (location) {
    if (!moveRoom(room, location.x, location.z)) {
      floor.rooms.pop();
      selectedRoomId = null;
      placingRoom = false;
      saveAndRender();
      return null;
    }
    return room;
  }
  saveAndRender();
  return room;
}

function duplicateRoom(room) {
  const floor = currentFloor();
  const name = `${room.name} copy`;
  const position = findFreePosition(floor, room.w, room.d);
  if (floor.rooms.some((other) => Math.abs(position.x - other.x) < (room.w + other.w) / 2 &&
    Math.abs(position.z - other.z) < (room.d + other.d) / 2)) {
    setStatus("No clear space for a copy on this floor", true);
    return;
  }
  const copy = { ...room, id: createRoomId(floor, name), name, ...position };
  floor.rooms.push(copy);
  selectedRoomId = copy.id;
  placingRoom = false;
  saveAndRender();
  return copy;
}

function removeWorkflowReferences(removedIds) {
  if (!Array.isArray(building.workflows)) return;
  building.workflows = building.workflows
    .map((workflow) => ({ ...workflow, stops: workflow.stops.filter((id) => !removedIds.has(id)) }))
    .filter((workflow) => workflow.stops.length >= 2);
  if (removedIds.has(building.defaultOriginId)) {
    const replacement = allRooms().find((room) => room.type === "reception") ?? allRooms()[0];
    if (replacement) building.defaultOriginId = replacement.id;
    else delete building.defaultOriginId;
  }
}

function deleteSelectedRoom() {
  const room = selectedRoom();
  if (!room || !window.confirm(`Delete ${room.name}?`)) return;
  const floor = currentFloor();
  const removedIds = new Set([room.id]);
  floor.rooms = floor.rooms.filter((entry) => entry.id !== room.id);
  removeWorkflowReferences(removedIds);
  selectedRoomId = floor.rooms[0]?.id ?? null;
  placingRoom = false;
  saveAndRender();
}

function addFloor() {
  const level = Math.max(...building.floors.map((floor) => floor.level)) + 1;
  const floor = { level, short: String(level), name: `Floor ${level}`, rooms: [] };
  building.floors.push(floor);
  activeLevel = level;
  selectedRoomId = null;
  placingRoom = false;
  saveAndRender();
}

function deleteFloor() {
  if (building.floors.length <= 1) return;
  const floor = currentFloor();
  if (floor.rooms.length === allRooms().length) {
    setStatus("Keep at least one space in the building", true);
    return;
  }
  if (!window.confirm(`Delete ${floor.name} and its ${floor.rooms.length} spaces?`)) return;
  const removedIds = new Set(floor.rooms.map((room) => room.id));
  building.floors = building.floors.filter((entry) => entry.level !== floor.level);
  removeWorkflowReferences(removedIds);
  activeLevel = [...building.floors].sort((a, b) => a.level - b.level)[0].level;
  selectedRoomId = null;
  placingRoom = false;
  saveAndRender();
}

function updateRoom(field) {
  const room = selectedRoom();
  if (!room) return;
  const input = $(field);
  const value = input.type === "number" ? input.valueAsNumber : input.value.trim();
  if ((field === "room-name" && !value) || (input.type === "number" && !Number.isFinite(value))) {
    setStatus("Enter a valid room value", true);
    render();
    return;
  }
  const key = {
    "room-name": "name",
    "room-type": "type",
    "room-width": "w",
    "room-depth": "d",
    "room-x": "x",
    "room-z": "z",
  }[field];
  if ((key === "w" || key === "d") && value <= 0) {
    setStatus("Room dimensions must be greater than zero", true);
    render();
    return;
  }
  if (key === "type" && !roomTypes[value]) return;
  room[key] = value;
  saveAndRender();
}

function updateFootprint(field, key) {
  const value = $(field).valueAsNumber;
  if (!Number.isFinite(value) || value <= 0) {
    setStatus("Building dimensions must be greater than zero", true);
    render();
    return;
  }
  building.footprint[key] = value;
  saveAndRender();
}

for (const [key, info] of Object.entries(roomTypes)) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = info.label;
  $("room-type").append(option);
}

$("floor-select").addEventListener("change", (event) => {
  activeLevel = Number(event.target.value);
  selectedRoomId = null;
  placingRoom = false;
  render();
});
$("add-floor").addEventListener("click", addFloor);
$("delete-floor").addEventListener("click", deleteFloor);
$("floor-name").addEventListener("change", (event) => {
  const name = event.target.value.trim();
  if (!name) return render();
  currentFloor().name = name;
  saveAndRender();
});
$("floor-short").addEventListener("change", (event) => {
  currentFloor().short = event.target.value.trim();
  saveAndRender();
});
$("footprint-width").addEventListener("change", () => updateFootprint("footprint-width", "width"));
$("footprint-depth").addEventListener("change", () => updateFootprint("footprint-depth", "depth"));
$("dimension-basis").addEventListener("change", (event) => {
  building.dimensionBasis = event.target.value;
  saveAndRender();
});
$("dimension-source").addEventListener("change", (event) => {
  building.dimensionSource = event.target.value.trim();
  saveAndRender();
});
for (const field of ["room-name", "room-type", "room-width", "room-depth", "room-x", "room-z"]) {
  $(field).addEventListener("change", () => updateRoom(field));
}
$("room-form").addEventListener("submit", (event) => event.preventDefault());
$("add-space").addEventListener("click", () => addRoom());
$("delete-room").addEventListener("click", deleteSelectedRoom);
$("place-room").addEventListener("click", () => {
  if (!selectedRoom()) return;
  placingRoom = !placingRoom;
  syncPlacementUi();
});
$("zoom-out").addEventListener("click", () => plan?.zoomOut());
$("zoom-in").addEventListener("click", () => plan?.zoomIn());
$("zoom-fit").addEventListener("click", () => plan?.fit());

$("export-layout").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(building, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${building.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "floor-plan"}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

$("import-layout").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const draft = JSON.parse(await file.text());
    if (!isValidBuildingDraft(draft)) throw new Error("JSON does not contain a valid building draft.");
    building = structuredClone(draft);
    activeLevel = building.floors[0].level;
    selectedRoomId = building.floors[0].rooms[0]?.id ?? null;
    placingRoom = false;
    saveAndRender();
  } catch (error) {
    setStatus(error.message || "Could not import building JSON", true);
  } finally {
    event.target.value = "";
  }
});

$("reset-layout").addEventListener("click", () => {
  if (!window.confirm("Reset this browser draft to the synthetic starter layout?")) return;
  clearBuildingDraft();
  building = structuredClone(starterBuilding);
  activeLevel = building.floors[0].level;
  selectedRoomId = building.floors[0].rooms[0]?.id ?? null;
  placingRoom = false;
  setStatus("Starter layout restored");
  render();
});

const menu = $("builder-menu");

async function publishModel() {
  let url;
  try {
    url = await buildShareUrl(building);
  } catch (error) {
    setStatus(error.message || "Model could not be published", true);
    return;
  }
  $("publish-name").textContent = building.name;
  $("publish-url").value = url;
  $("publish-open").href = url;
  $("publish-copy").textContent = "Copy";
  const qrHost = $("publish-qr");
  try {
    const qr = qrcode(0, "L");
    qr.addData(url);
    qr.make();
    qrHost.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  } catch {
    qrHost.replaceChildren(h("p", { text: "This model is too large for a QR code. Share the link instead." }));
  }
  $("publish-meta").textContent = `${building.floors.length} floors · ${allRooms().length} spaces · ${(url.length / 1024).toFixed(1)} KB link`;
  $("publish-share").hidden = typeof navigator.share !== "function";
  $("publish-dialog").showModal();
  $("publish-url").select();
}

$("publish-model").addEventListener("click", publishModel);
$("publish-close").addEventListener("click", () => $("publish-dialog").close());
$("publish-copy").addEventListener("click", async () => {
  const input = $("publish-url");
  try {
    await navigator.clipboard.writeText(input.value);
    $("publish-copy").textContent = "Copied";
  } catch {
    input.select();
    $("publish-copy").textContent = "Press Ctrl+C";
  }
});
$("publish-share").addEventListener("click", async () => {
  try {
    await navigator.share({ title: `${building.name} – Campus Twin`, url: $("publish-url").value });
  } catch {
    // Share sheet dismissed or unavailable; the link stays in the dialog.
  }
});

async function importSharedModel() {
  const token = readShareToken();
  if (!token) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const shared = await decodeBuildingShare(token);
    if (!window.confirm(`Replace the draft in this browser with the shared model "${shared.name}"?`)) return;
    building = structuredClone(shared);
    activeLevel = building.floors[0].level;
    selectedRoomId = building.floors[0].rooms[0]?.id ?? null;
    placingRoom = false;
    saveAndRender();
    setStatus("Shared model copied into this browser");
  } catch (error) {
    setStatus(error.message || "Shared model link could not be opened", true);
  }
}
const closeMenu = () => { menu.hidden = true; };
$("plan-canvas").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const roomId = event.target.closest?.("[data-room-id]")?.dataset.roomId;
  const room = currentFloor().rooms.find((entry) => entry.id === roomId);
  const matrix = plan.svg.getScreenCTM();
  const point = plan.svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const position = matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
  const location = { x: position.x, z: position.y };
  const actions = room ? [
    ["Select space", () => { selectedRoomId = room.id; render(); }],
    ["Move on plan", () => { selectedRoomId = room.id; placingRoom = true; render(); }],
    ["Duplicate space", () => duplicateRoom(room)],
    ["Delete space", () => { selectedRoomId = room.id; deleteSelectedRoom(); }],
  ] : [
    ["Add space here", () => addRoom("other", location)],
    ["Add lift here", () => addRoom("lift", location)],
    ["Add stairs here", () => addRoom("stairs", location)],
    ["Add floor", addFloor],
  ];
  menu.replaceChildren(...actions.map(([label, action]) => h("button", {
    text: label,
    attrs: { type: "button", role: "menuitem" },
    on: { click: () => { closeMenu(); action(); } },
  })));
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - 188))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - actions.length * 40 - 12))}px`;
  menu.querySelector("button")?.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest?.("#builder-menu")) closeMenu();
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

const layout = document.querySelector(".builder-layout");
for (const panel of document.querySelectorAll(".builder-panel")) {
  const handle = panel.querySelector(".panel-move");
  handle.replaceChildren(createElement(GripVertical, { width: 18, height: 18, "aria-hidden": "true" }));
  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 1120) return;
    const bounds = panel.getBoundingClientRect();
    const workspace = layout.getBoundingClientRect();
    panel.classList.add("floating");
    panel.style.left = `${bounds.left - workspace.left}px`;
    panel.style.top = `${bounds.top - workspace.top}px`;
    drag = { x: event.clientX, y: event.clientY, left: bounds.left - workspace.left, top: bounds.top - workspace.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || !handle.hasPointerCapture(event.pointerId)) return;
    const left = Math.max(0, Math.min(layout.clientWidth - panel.offsetWidth, drag.left + event.clientX - drag.x));
    const top = Math.max(0, Math.min(layout.clientHeight - panel.offsetHeight, drag.top + event.clientY - drag.y));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  handle.addEventListener("pointerup", () => { drag = null; });
  handle.addEventListener("pointercancel", () => { drag = null; });
  handle.addEventListener("dblclick", () => {
    drag = null;
    panel.classList.remove("floating");
    panel.style.left = "";
    panel.style.top = "";
  });
}

function selectCommandFloor(reference) {
  const floor = building.floors.find((entry) =>
    String(entry.level) === reference ||
    entry.short.toLowerCase() === reference ||
    entry.name.toLowerCase() === reference ||
    (reference.startsWith("ground") && entry.level === 0)
  );
  if (!floor) throw new Error(`Floor ${reference} was not found.`);
  activeLevel = floor.level;
  selectedRoomId = null;
  placingRoom = false;
  render();
  return floor;
}

function commandRoom(name) {
  const room = currentFloor().rooms.find((entry) =>
    entry.name.toLowerCase() === name.toLowerCase() || entry.id.toLowerCase() === name.toLowerCase()
  );
  if (!room) throw new Error(`No space named ${name} on ${currentFloor().name}.`);
  return room;
}

function executeBuilderCommand(command) {
  if (!command) throw new Error("Try adding a floor, adding a room, or moving a named room.");
  if (command.type === "add_floor") {
    addFloor();
    if (command.name) { currentFloor().name = command.name; saveAndRender(); }
    return `Added ${currentFloor().name}.`;
  }
  if (command.type === "rename_floor") {
    currentFloor().name = command.name;
    saveAndRender();
    return `Renamed active floor to ${command.name}.`;
  }
  if (command.type === "rename_building") {
    building.name = command.name;
    saveAndRender();
    return `Building is now ${command.name}.`;
  }
  if (command.type === "set_dimension") {
    if (command.value < 1 || command.value > 1000) throw new Error("Building dimensions must be between 1 and 1000 metres.");
    const axis = command.field === "width" ? "x" : "z";
    const size = command.field === "width" ? "w" : "d";
    if (allRooms().some((room) => 2 * (Math.abs(room[axis]) + room[size] / 2) > command.value)) {
      throw new Error("Existing rooms would extend outside that building dimension.");
    }
    building.footprint[command.field] = command.value;
    saveAndRender();
    return `Building ${command.field} set to ${command.value} m.`;
  }
  if (command.type === "select_floor") {
    return `Showing ${selectCommandFloor(command.floor).name}.`;
  }
  if (command.type === "add_room") {
    if (command.floor) selectCommandFloor(command.floor);
    const room = addRoom(command.roomType, null, { name: command.name, width: command.width, depth: command.depth });
    return `Added ${room.name} on ${currentFloor().name}. Drag it on the plan to reposition it.`;
  }
  const room = commandRoom(command.name);
  selectedRoomId = room.id;
  if (command.type === "move_room") {
    if (!moveRoom(room, command.x, command.z)) throw new Error("That position overlaps another space.");
    return `Moved ${room.name} to (${room.x}, ${room.z}) m.`;
  }
  if (command.type === "rename_room") {
    room.name = command.newName;
    saveAndRender();
    return `Renamed space to ${room.name}.`;
  }
  if (command.type === "duplicate_room") {
    const copy = duplicateRoom(room);
    if (!copy) throw new Error("No clear area for a copy on this floor.");
    return `Added ${copy.name}.`;
  }
  if (command.type === "delete_room") {
    if (allRooms().length <= 1) throw new Error("Keep at least one space in the building.");
    if (!window.confirm(`Delete ${room.name}?`)) return "Deletion cancelled.";
    const removedIds = new Set([room.id]);
    currentFloor().rooms = currentFloor().rooms.filter((entry) => entry !== room);
    removeWorkflowReferences(removedIds);
    selectedRoomId = null;
    saveAndRender();
    return `Deleted ${room.name}.`;
  }
  throw new Error("That edit is not supported by the builder chat.");
}

const chat = $("builder-chat");
const chatToggle = $("builder-chat-toggle");
function showChat(visible) {
  chat.hidden = !visible;
  chatToggle.setAttribute("aria-expanded", String(visible));
  if (visible) $("builder-chat-input").focus();
}
chatToggle.addEventListener("click", () => showChat(chat.hidden));
$("builder-chat-close").addEventListener("click", () => showChat(false));
$("builder-chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("builder-chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const log = $("builder-chat-log");
  log.append(h("p", { className: "user", text }));
  let answer;
  try { answer = executeBuilderCommand(parseBuilderCommand(text)); }
  catch (error) { answer = error.message; }
  log.append(h("p", { text: answer }));
  log.scrollTop = log.scrollHeight;
});

const STRING = { type: "string", minLength: 1 };
const NUMBER = { type: "number" };
const builderTools = [
  { name: "builder_get_draft", title: "Get building draft", description: "Return the building draft in this browser.", readOnly: true, inputSchema: { type: "object", properties: {} } },
  { name: "builder_edit", title: "Edit building", description: "Apply a natural-language building instruction to this browser draft.", readOnly: false, inputSchema: { type: "object", properties: { instruction: STRING }, required: ["instruction"] } },
  { name: "builder_add_floor", title: "Add floor", description: "Add a floor to this browser draft.", readOnly: false, inputSchema: { type: "object", properties: { name: STRING } } },
  { name: "builder_add_room", title: "Add room", description: "Add a room on the active floor.", readOnly: false, inputSchema: { type: "object", properties: { name: STRING, category: STRING, width: NUMBER, depth: NUMBER, floor: STRING }, required: ["name", "category"] } },
  { name: "builder_move_room", title: "Move room", description: "Move a named room on the active floor to centre x and z in metres.", readOnly: false, inputSchema: { type: "object", properties: { name: STRING, x: NUMBER, z: NUMBER }, required: ["name", "x", "z"] } },
];
registerWebMcpTools({
  list: () => builderTools,
  async execute(name, args) {
    try {
      if (name === "builder_get_draft") return { ok: true, data: structuredClone(building) };
      let command;
      if (name === "builder_edit" && typeof args.instruction === "string") command = parseBuilderCommand(args.instruction);
      if (name === "builder_add_floor") command = { type: "add_floor", name: args.name };
      if (name === "builder_add_room") command = { type: "add_room", name: args.name, roomType: args.category, width: args.width, depth: args.depth, floor: args.floor };
      if (name === "builder_move_room") command = { type: "move_room", name: args.name, x: args.x, z: args.z };
      if (command?.type === "add_room" && !roomTypes[command.roomType]) throw new Error("Unknown room category.");
      if (!command || (command.type === "move_room" && (!Number.isFinite(command.x) || !Number.isFinite(command.z)))) throw new Error("Invalid builder instruction.");
      const message = executeBuilderCommand(command);
      return { ok: true, data: { message, building: structuredClone(building) } };
    } catch (error) {
      return { ok: false, error: { code: "INVALID_INPUT", message: error.message } };
    }
  },
});

render();
importSharedModel();
window.addEventListener("hashchange", importSharedModel);