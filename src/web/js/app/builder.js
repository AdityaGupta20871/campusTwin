import "./fonts.js";
import { building as starterBuilding, roomTypes } from "../data/building-data.js";
import { createModel } from "../core/model.js";
import { clearBuildingDraft, readBuildingDraft, saveBuildingDraft } from "../core/building-draft.js";
import { createPlan2D } from "../ui/plan2d.js";
import { $, h, hexColor, tint } from "../ui/dom.js";

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

  const { width, depth } = building.footprint;
  const clampCenter = (value, envelopeSize, roomSize) => {
    const min = -envelopeSize / 2 + roomSize / 2;
    const max = envelopeSize / 2 - roomSize / 2;
    return min > max ? 0 : Math.min(max, Math.max(min, Math.round(value * 2) / 2));
  };
  room.x = clampCenter(position.x, width, room.w);
  room.z = clampCenter(position.y, depth, room.d);
  placingRoom = false;
  saveAndRender();
}

function renderPlan() {
  plan?.destroy();
  const canvas = $("plan-canvas");
  canvas.replaceChildren();
  plan = createPlan2D(canvas, model, { onPick: handlePlanPick });
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

function addRoom() {
  const floor = currentFloor();
  const name = `New space ${floor.rooms.length + 1}`;
  const width = Math.min(5, building.footprint.width);
  const depth = Math.min(4, building.footprint.depth);
  const position = findFreePosition(floor, width, depth);
  const room = { id: createRoomId(floor, name), name, type: "other", ...position, w: width, d: depth };
  floor.rooms.push(room);
  selectedRoomId = room.id;
  placingRoom = true;
  saveAndRender();
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
$("add-space").addEventListener("click", addRoom);
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

render();