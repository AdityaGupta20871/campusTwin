import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { building, roomTypes } from "./building-data.js";

const $ = (id) => document.getElementById(id);
const typeOf = (room) => roomTypes[room.type] ?? roomTypes.other;
const toCss = (color) => `#${color.toString(16).padStart(6, "0")}`;

const viewer = $("viewer");
const loading = $("loading");
const spacing = building.floorSpacing;
const { width, depth } = building.footprint;

document.title = `${building.name} – 3D Floor Guide`;
$("building-name").textContent = building.name;
$("building-subtitle").textContent = building.subtitle;

// ---------- Scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  loading.textContent = "Sorry, 3D is not supported on this browser. Please try Chrome or Safari.";
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = "label-layer";
viewer.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f6);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(90, 80, 110);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 8;
controls.maxDistance = 220;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(40, 90, 30);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshLambertMaterial({ color: 0xdfe4ea })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.4;
scene.add(ground);

// ---------- Building ----------
const floorGroups = new Map(); // level -> { floor, materials, roomLabels, floorLabel }
const roomIndex = new Map(); // roomId -> { room, floor, mesh }
const pickables = [];

function fadeable(material, opacity) {
  material.transparent = true;
  material.opacity = opacity;
  material.userData.baseOpacity = opacity;
  return material;
}

function makeLabel(text, className) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return new CSS2DObject(el);
}

for (const floor of building.floors) {
  const group = new THREE.Group();
  group.position.y = floor.level * spacing;
  const materials = [];
  const roomLabels = [];

  const slabMat = fadeable(new THREE.MeshLambertMaterial({ color: 0xffffff }), 0.9);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, depth), slabMat);
  slab.position.y = -0.15;
  group.add(slab);
  materials.push(slabMat);

  const edgeMat = fadeable(new THREE.LineBasicMaterial({ color: 0x1b2a4a }), 0.35);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 3, depth)), edgeMat);
  edges.position.y = 1.35;
  group.add(edges);
  materials.push(edgeMat);

  for (const room of floor.rooms) {
    if (roomIndex.has(room.id)) console.warn(`Duplicate room id: ${room.id}`);
    const height = room.height ?? 2.6;
    const mat = fadeable(new THREE.MeshLambertMaterial({ color: typeOf(room).color }), 0.9);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(room.w, height, room.d), mat);
    mesh.position.set(room.x, height / 2, room.z);
    mesh.userData = { roomId: room.id, level: floor.level, height };
    group.add(mesh);
    pickables.push(mesh);
    materials.push(mat);

    const label = makeLabel(`${typeOf(room).icon} ${room.name}`, "room-label");
    label.position.set(room.x, height + 0.8, room.z);
    group.add(label);
    roomLabels.push(label);

    roomIndex.set(room.id, { room, floor, mesh });
  }

  const floorLabel = makeLabel(floor.name, "floor-label");
  floorLabel.position.set(-width / 2 - 4, 1, depth / 2);
  group.add(floorLabel);

  scene.add(group);
  floorGroups.set(floor.level, { floor, materials, roomLabels, floorLabel });
}

const topLevel = Math.max(...building.floors.map((f) => f.level));
const overviewTarget = new THREE.Vector3(0, (topLevel * spacing) / 2, 0);
controls.target.copy(overviewTarget);

// ---------- Pins ----------
function makePin(color) {
  const pin = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 16), mat);
  head.position.y = 2.2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.8, 20), mat);
  tip.rotation.x = Math.PI;
  tip.position.y = 0.9;
  pin.add(head, tip);
  pin.visible = false;
  scene.add(pin);
  return pin;
}

const selectPin = makePin(0x2563eb);
const herePin = makePin(0xe11d48);
const hereLabel = makeLabel("You are here", "here-label");
hereLabel.position.y = 4;
hereLabel.visible = false;
herePin.add(hereLabel);

function placePin(pin, entry) {
  const p = new THREE.Vector3();
  entry.mesh.getWorldPosition(p);
  pin.userData.baseY = p.y + entry.mesh.userData.height / 2 + 0.2;
  pin.position.set(p.x, pin.userData.baseY, p.z);
  pin.visible = true;
}

// ---------- Camera animation ----------
let anim = null;
const DEFAULT_DIR = new THREE.Vector3(0.9, 1.1, 1.2).normalize();

function flyTo(target, distance) {
  let dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.35) dir = DEFAULT_DIR.clone();
  anim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
    toPos: target.clone().addScaledVector(dir, distance),
  };
}
controls.addEventListener("start", () => { anim = null; });

// ---------- Floors ----------
let activeLevel = null;
const floorNav = $("floors");

function setActiveFloor(level, { fly = true } = {}) {
  activeLevel = level;
  for (const [lvl, f] of floorGroups) {
    const active = level === null || lvl === level;
    for (const m of f.materials) {
      m.opacity = active ? m.userData.baseOpacity : lvl > level ? 0.04 : 0.15;
      m.depthWrite = active;
    }
    for (const l of f.roomLabels) l.visible = level !== null && lvl === level;
    f.floorLabel.visible = level === null;
  }
  for (const btn of floorNav.children) {
    btn.classList.toggle("active", btn.dataset.level === String(level ?? "all"));
  }
  if (!fly) return;
  if (level === null) flyTo(overviewTarget, 105);
  else flyTo(new THREE.Vector3(0, level * spacing, 0), 60);
}

function addFloorButton(text, level, title) {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.title = title;
  btn.dataset.level = String(level ?? "all");
  btn.addEventListener("click", () => {
    hideInfo();
    setActiveFloor(level);
  });
  floorNav.appendChild(btn);
}

addFloorButton("All", null, "All floors");
[...building.floors]
  .sort((a, b) => b.level - a.level)
  .forEach((f) => addFloorButton(f.short, f.level, f.name));

// ---------- Info sheet ----------
const infoSheet = $("info");
let currentId = null;
let hereId = null;
let highlighted = null;

function directionsTo({ room, floor }) {
  if (room.directions) return room.directions;
  const here = hereId ? roomIndex.get(hereId) : null;
  if (here && here.room.id === room.id) return "You are here.";
  const fromLevel = here ? here.floor.level : 0;
  const fromText = here ? "" : " from Reception";
  if (floor.level === fromLevel) {
    return here ? `On your floor (${floor.name}).` : `On the ${floor.name}.`;
  }
  const way = floor.level > fromLevel ? "up" : "down";
  return `Take the central lifts or stairs ${way} to ${floor.name}${fromText}.`;
}

function showInfo(entry) {
  const { room, floor } = entry;
  const type = typeOf(room);
  currentId = room.id;

  const badge = $("info-type");
  badge.textContent = `${type.icon} ${type.label}`;
  badge.style.background = toCss(type.color);
  $("info-name").textContent = room.name;
  $("info-floor").textContent = floor.name;
  $("info-desc").textContent = room.info ?? "";

  const meta = $("info-meta");
  meta.replaceChildren();
  for (const [key, value] of [["Capacity", room.capacity], ["Hours", room.hours], ["Contact", room.contact]]) {
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    meta.append(dt, dd);
  }

  $("info-directions").textContent = directionsTo(entry);
  infoSheet.classList.remove("hidden");
}

function hideInfo() {
  infoSheet.classList.add("hidden");
  selectPin.visible = false;
  if (highlighted) highlighted.mesh.material.emissive.setHex(0x000000);
  highlighted = null;
  currentId = null;
}

function focusRoom(id) {
  const entry = roomIndex.get(id);
  if (!entry) return false;
  setActiveFloor(entry.floor.level, { fly: false });

  if (highlighted) highlighted.mesh.material.emissive.setHex(0x000000);
  entry.mesh.material.emissive.setHex(0x2a2a2a);
  highlighted = entry;

  if (id !== hereId) placePin(selectPin, entry);
  else selectPin.visible = false;

  const target = new THREE.Vector3();
  entry.mesh.getWorldPosition(target);
  flyTo(target, Math.max(entry.room.w, entry.room.d) * 1.5 + 22);
  showInfo(entry);
  return true;
}

$("info-close").addEventListener("click", hideInfo);

$("info-share").addEventListener("click", async () => {
  const entry = currentId ? roomIndex.get(currentId) : null;
  if (!entry) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("room", entry.room.id);
  const data = { title: building.name, text: `${entry.room.name} – ${entry.floor.name}`, url: url.toString() };

  if (navigator.share) {
    try { await navigator.share(data); } catch { /* user cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(data.url);
    toast("Link copied");
  } catch {
    toast(data.url);
  }
});

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}

// ---------- Tap to select ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

renderer.domElement.addEventListener("pointerdown", (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener("pointerup", (e) => {
  // Ignore drags (orbit/pan) — only treat short taps as selection.
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const candidates = activeLevel === null ? pickables : pickables.filter((m) => m.userData.level === activeLevel);
  const hit = raycaster.intersectObjects(candidates, false)[0];
  if (hit) focusRoom(hit.object.userData.roomId);
  else hideInfo();
});

// ---------- Search & quick filters ----------
const allRooms = [...roomIndex.values()];
const resultsEl = $("results");
const searchEl = $("search");

function byProximity(list) {
  const ref = hereId ? roomIndex.get(hereId) : null;
  if (!ref) {
    return list.sort((a, b) => a.floor.level - b.floor.level || a.room.name.localeCompare(b.room.name));
  }
  const score = (e) =>
    Math.abs(e.floor.level - ref.floor.level) * 1000 + Math.hypot(e.room.x - ref.room.x, e.room.z - ref.room.z);
  return list.sort((a, b) => score(a) - score(b));
}

function renderResults(list) {
  resultsEl.replaceChildren();
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No matching rooms";
    resultsEl.appendChild(li);
  }
  for (const entry of list.slice(0, 15)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const name = document.createElement("span");
    name.textContent = `${typeOf(entry.room).icon} ${entry.room.name}`;
    const floor = document.createElement("span");
    floor.className = "floor";
    floor.textContent = entry.floor.name;
    btn.append(name, floor);
    btn.addEventListener("click", () => {
      closeResults();
      searchEl.blur();
      focusRoom(entry.room.id);
    });
    li.appendChild(btn);
    resultsEl.appendChild(li);
  }
  resultsEl.classList.remove("hidden");
}

function closeResults() {
  resultsEl.classList.add("hidden");
}

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) return closeResults();
  const matches = allRooms.filter(({ room }) =>
    [room.name, typeOf(room).label, ...(room.tags ?? [])].some((s) => s.toLowerCase().includes(q))
  );
  renderResults(byProximity(matches));
});

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".search, .chips")) closeResults();
});

const quickFilters = [
  { label: "🚻 Restrooms", types: ["restroom"] },
  { label: "👥 Meeting rooms", types: ["meeting"] },
  { label: "🍽️ Food", types: ["cafeteria", "pantry"] },
  { label: "🚪 Fire exits", types: ["stairs"] },
  { label: "⛑️ First aid", types: ["firstaid"] },
  { label: "🛗 Lifts", types: ["lift"] },
];

const chipsEl = $("chips");
for (const f of quickFilters) {
  const btn = document.createElement("button");
  btn.textContent = f.label;
  btn.addEventListener("click", () => {
    renderResults(byProximity(allRooms.filter(({ room }) => f.types.includes(room.type))));
  });
  chipsEl.appendChild(btn);
}

// ---------- Deep links from QR codes ----------
// ?here=<roomId>  → QR posted at a location ("You are here")
// ?room=<roomId>  → open a specific room
// ?floor=<level>  → open a specific floor
const params = new URLSearchParams(location.search);

if (roomIndex.has(params.get("here"))) {
  hereId = params.get("here");
  placePin(herePin, roomIndex.get(hereId));
  hereLabel.visible = true;

  const meBtn = document.createElement("button");
  meBtn.className = "here";
  meBtn.textContent = "📍 Me";
  meBtn.addEventListener("click", () => focusRoom(hereId));
  chipsEl.prepend(meBtn);
}

const startRoom = params.get("room") ?? hereId;
const startFloor = Number(params.get("floor"));
if (!(startRoom && focusRoom(startRoom))) {
  setActiveFloor(params.has("floor") && floorGroups.has(startFloor) ? startFloor : null);
}

// ---------- Render loop ----------
function resize() {
  const w = viewer.clientWidth;
  const h = viewer.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}
new ResizeObserver(resize).observe(viewer);
resize();

const clock = new THREE.Clock();
let firstFrame = true;

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  if (anim) {
    anim.t = Math.min(1, anim.t + dt / 0.9);
    const k = 1 - Math.pow(1 - anim.t, 3);
    camera.position.lerpVectors(anim.fromPos, anim.toPos, k);
    controls.target.lerpVectors(anim.fromTarget, anim.toTarget, k);
    if (anim.t === 1) anim = null;
  }

  for (const [i, pin] of [selectPin, herePin].entries()) {
    if (pin.visible) pin.position.y = pin.userData.baseY + Math.abs(Math.sin(t * 2.5 + i)) * 0.6;
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    loading.classList.add("done");
  }
});
