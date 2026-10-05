import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { rectOf } from "../core/geometry.js";
import { tint } from "./dom.js";

const COLORS = Object.freeze({
  paper: 0xf7f6f2,
  ground: 0xf3f1eb,
  ink: 0x1b1b1b,
  slab: 0xfbfaf7,
  accent: 0x111111,
  route: 0x111111,
  emergency: 0xb42318,
  itinerary: 0x2457a6,
  here: 0x111111,
  select: 0x111111,
});
const WALL_H = 2.6;
const WALL_T = 0.14;
const DOOR_W = 1.6;
const EYE = 1.6;
const WALK_SPEED = 4;

function fade(material, opacity) {
  material.transparent = true;
  material.opacity = opacity;
  material.userData.base = opacity;
  return material;
}

/** Wall segments around a room with a door gap on the side facing the corridor. */
function wallSegments(room, spineZ) {
  const r = rectOf(room);
  const doorWidth = Math.min(DOOR_W, room.w - 0.6);
  const doorEdges = r.minZ >= spineZ
    ? new Set(["north"])
    : r.maxZ <= spineZ
      ? new Set(["south"])
      : new Set(["north", "south"]);
  const edges = {
    north: [r.minX, r.minZ, r.maxX, r.minZ],
    south: [r.minX, r.maxZ, r.maxX, r.maxZ],
    west: [r.minX, r.minZ, r.minX, r.maxZ],
    east: [r.maxX, r.minZ, r.maxX, r.maxZ],
  };
  const out = [];
  for (const [side, [x1, z1, x2, z2]] of Object.entries(edges)) {
    if (!doorEdges.has(side) || doorWidth <= 0.4) {
      out.push({ x1, z1, x2, z2 });
      continue;
    }
    const g0 = Math.max(x1 + 0.3, Math.min(x2 - 0.3 - doorWidth, room.x - doorWidth / 2));
    if (g0 - x1 > 0.05) out.push({ x1, z1, x2: g0, z2 });
    if (x2 - (g0 + doorWidth) > 0.05) out.push({ x1: g0 + doorWidth, z1, x2, z2 });
  }
  return out;
}

function makeLabel(text, className) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return new CSS2DObject(el);
}

/**
 * Three.js view of the building: exploded floors, translucent walls with doorways,
 * orbit camera, first-person walk mode, route tubes and animated agent marker.
 * Throws if WebGL is unavailable — the caller should fall back to the 2D plan.
 */
export function createScene3D(container, model, { onPick = () => {} } = {}) {
  const spacing = model.building.floorSpacing;
  const { width: W, depth: D } = model.building.footprint;
  const spine = model.spineZ;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.append(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "label-layer";
  container.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.paper);
  scene.fog = new THREE.Fog(COLORS.paper, 200, 460);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
  camera.position.set(95, 85, 115);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 6;
  controls.maxDistance = 260;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc5ccd2, 2));
  const fill = new THREE.DirectionalLight(0xddeeff, 1.2);
  fill.position.set(-60, 45, -30);
  scene.add(fill);
  const sun = new THREE.DirectionalLight(0xfff5e8, 2.4);
  sun.position.set(-35, 100, 65);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 320 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: COLORS.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(300, 30, 0xe4e1d8, 0xe7e4dc);
  grid.position.y = -0.6;
  scene.add(grid);
  const plot = new THREE.Mesh(new THREE.BoxGeometry(W + 8, 0.25, D + 8), new THREE.MeshStandardMaterial({ color: 0xe4e5e1, roughness: 1 }));
  plot.position.y = -0.48;
  plot.receiveShadow = true;
  scene.add(plot);

  const fixtures = {
    desk: new THREE.MeshStandardMaterial({ color: 0x77593e, roughness: 0.7 }),
    deskTop: new THREE.MeshStandardMaterial({ color: 0xc5a47d, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x30343b, roughness: 0.62 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x244968, emissive: 0x10263d, emissiveIntensity: 0.65, roughness: 0.24 }),
    chair: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 }),
    upholstery: new THREE.MeshStandardMaterial({ color: 0x52738c, roughness: 0.82 }),
    meeting: new THREE.MeshStandardMaterial({ color: 0xbfa786, roughness: 0.62 }),
    counter: new THREE.MeshStandardMaterial({ color: 0xe7e2d8, roughness: 0.42 }),
    porcelain: new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.28 }),
    medical: new THREE.MeshStandardMaterial({ color: 0xf4f0e9, roughness: 0.78 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x398052, roughness: 0.86 }),
    terracotta: new THREE.MeshStandardMaterial({ color: 0x9b6446, roughness: 0.82 }),
    accentRed: new THREE.MeshStandardMaterial({ color: 0xb83f3a, roughness: 0.72 }),
  };

  function fixtureBox(parent, width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addTable(parent, x, z, width, depth, material = fixtures.meeting, topY = 0.82) {
    fixtureBox(parent, width, 0.13, depth, x, topY, z, material);
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) fixtureBox(parent, 0.09, topY - 0.08, 0.09, x + dx * width * 0.42, (topY - 0.13) / 2, z + dz * depth * 0.34, fixtures.desk);
    }
  }

  function addChair(parent, x, z, rotation = 0, material = fixtures.chair) {
    const chair = new THREE.Group();
    chair.position.set(x, 0, z);
    chair.rotation.y = rotation;
    fixtureBox(chair, 0.52, 0.13, 0.5, 0, 0.55, 0, material);
    fixtureBox(chair, 0.52, 0.57, 0.12, 0, 0.88, -0.19, material);
    for (const dx of [-0.19, 0.19]) {
      for (const dz of [-0.16, 0.16]) fixtureBox(chair, 0.07, 0.5, 0.07, dx, 0.27, dz, fixtures.dark);
    }
    parent.add(chair);
    return chair;
  }

  function addMonitor(parent, x, z, width = 0.76) {
    fixtureBox(parent, width, 0.47, 0.09, x, 1.28, z, fixtures.dark);
    fixtureBox(parent, width * 0.9, 0.36, 0.025, x, 1.29, z + 0.058, fixtures.screen);
    fixtureBox(parent, 0.12, 0.2, 0.13, x, 0.99, z, fixtures.dark);
  }

  function addWorkstation(parent, x, z, width = 1.55, depth = 0.78) {
    addTable(parent, x, z, width, depth, fixtures.deskTop, 0.82);
    addMonitor(parent, x, z - depth * 0.24, Math.min(0.78, width * 0.55));
    addChair(parent, x, z + depth * 0.5 + 0.52, Math.PI);
  }

  function addPlant(parent, x, z, scale = 1) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * scale, 0.26 * scale, 0.42 * scale, 12), fixtures.terracotta);
    pot.position.set(x, 0.23 * scale, z);
    parent.add(pot);
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.44 * scale, 12, 10), fixtures.foliage);
    leaves.position.set(x, 0.72 * scale, z);
    leaves.scale.set(0.9, 1.2, 0.9);
    leaves.castShadow = true;
    parent.add(leaves);
  }

  function addSofa(parent, x, z, width = 2.3, depth = 0.86) {
    fixtureBox(parent, width, 0.38, depth, x, 0.47, z, fixtures.upholstery);
    fixtureBox(parent, width, 0.58, 0.18, x, 0.82, z - depth * 0.38, fixtures.upholstery);
    for (const side of [-1, 1]) fixtureBox(parent, 0.18, 0.54, depth, x + side * (width / 2 - 0.09), 0.68, z, fixtures.upholstery);
  }

  function addScreenPanel(parent, x, z, width = 2.2) {
    fixtureBox(parent, width, 1.25, 0.12, x, 1.75, z, fixtures.dark);
    fixtureBox(parent, width * 0.91, 0.98, 0.025, x, 1.77, z + 0.075, fixtures.screen);
  }

  function furnishRoom(entry, floorGroup) {
    const { room } = entry;
    if (room.w < 2 || room.d < 2) return;
    const left = room.x - room.w / 2;
    const top = room.z - room.d / 2;
    const innerW = Math.max(1, room.w - 1.2);
    const innerD = Math.max(1, room.d - 1.2);

    if (entry.typeKey === "workspace" || entry.typeKey === "office") {
      const columns = Math.min(3, Math.max(1, Math.floor(innerW / 5.2)));
      const rows = Math.min(2, Math.max(1, Math.floor(innerD / 4.2)));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = room.x + (col - (columns - 1) / 2) * Math.min(5.2, innerW / Math.max(1, columns - 1 || 1));
          const z = room.z + (row - (rows - 1) / 2) * Math.min(4.2, innerD / Math.max(1, rows - 1 || 1));
          addWorkstation(floorGroup, x, z, Math.min(1.65, room.w / (columns + 1)), 0.78);
        }
      }
      addPlant(floorGroup, left + 0.75, top + 0.75, 0.72);
      return;
    }

    if (entry.typeKey === "security" || entry.typeKey === "reception") {
      const counterW = Math.min(room.w * (entry.typeKey === "reception" ? 0.62 : 0.58), entry.typeKey === "reception" ? 7.2 : 3.8);
      const deskZ = room.z + (room.z >= spine ? 1 : -1) * Math.min(0.6, room.d * 0.1);
      fixtureBox(floorGroup, counterW, 0.92, 0.9, room.x, 0.58, deskZ, fixtures.counter);
      fixtureBox(floorGroup, counterW + 0.16, 0.12, 1.02, room.x, 1.08, deskZ, fixtures.deskTop);
      const screens = entry.typeKey === "security" ? 2 : Math.min(2, Math.max(1, Math.floor(counterW / 3.2)));
      for (let i = 0; i < screens; i++) {
        const x = room.x + (i - (screens - 1) / 2) * Math.min(1.1, counterW * 0.3);
        addMonitor(floorGroup, x, deskZ - 0.18, 0.68);
      }
      addChair(floorGroup, room.x, deskZ - (room.z >= spine ? 1.15 : -1.15), room.z >= spine ? Math.PI : 0);
      if (entry.typeKey === "security") {
        fixtureBox(floorGroup, Math.min(2.3, room.w * 0.42), 0.62, 0.12, room.x, 1.65, top + 0.22, fixtures.dark);
        for (let i = -1; i <= 1; i++) fixtureBox(floorGroup, 0.56, 0.38, 0.025, room.x + i * 0.66, 1.66, top + 0.3, fixtures.screen);
      } else {
        addSofa(floorGroup, room.x, top + 2.6, Math.min(3.3, room.w * 0.36), 0.82);
        addPlant(floorGroup, left + 0.8, top + 0.85, 0.8);
      }
      return;
    }

    if (entry.typeKey === "meeting") {
      const tableW = Math.min(room.w * 0.52, 7.2);
      const tableD = Math.min(room.d * 0.28, 1.6);
      addTable(floorGroup, room.x, room.z, tableW, tableD, fixtures.meeting);
      const seats = Math.min(4, Math.max(2, Math.floor(tableW / 1.7)));
      for (let i = 0; i < seats; i++) {
        const x = room.x + (i - (seats - 1) / 2) * (tableW / seats);
        addChair(floorGroup, x, room.z - tableD / 2 - 0.55, 0);
        addChair(floorGroup, x, room.z + tableD / 2 + 0.55, Math.PI);
      }
      addScreenPanel(floorGroup, room.x, top + 0.28, Math.min(2.5, room.w * 0.35));
      return;
    }

    if (entry.typeKey === "training") {
      const columns = Math.min(3, Math.max(1, Math.floor(innerW / 5)));
      const rows = Math.min(3, Math.max(1, Math.floor(innerD / 3.2)));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = room.x + (col - (columns - 1) / 2) * Math.min(4.2, innerW / Math.max(columns, 1));
          const z = room.z + (row - (rows - 1) / 2) * Math.min(3.2, innerD / Math.max(rows, 1));
          addTable(floorGroup, x, z, Math.min(2.4, room.w / (columns + 1)), 0.85, fixtures.meeting, 0.76);
          addChair(floorGroup, x, z + 0.78, Math.PI);
        }
      }
      addScreenPanel(floorGroup, room.x, top + 0.24, Math.min(3.2, room.w * 0.3));
      return;
    }

    if (entry.typeKey === "cafeteria") {
      const columns = Math.min(3, Math.max(1, Math.floor(innerW / 6)));
      const rows = Math.min(3, Math.max(1, Math.floor(innerD / 4.6)));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = room.x + (col - (columns - 1) / 2) * Math.min(5.5, innerW / Math.max(columns, 1));
          const z = room.z + (row - (rows - 1) / 2) * Math.min(4.2, innerD / Math.max(rows, 1));
          addTable(floorGroup, x, z, 2.1, 1.05, fixtures.meeting, 0.76);
          for (const side of [-1, 1]) {
            addChair(floorGroup, x + side * 1.35, z, side > 0 ? Math.PI / 2 : -Math.PI / 2);
            addChair(floorGroup, x, z + side * 0.95, side < 0 ? 0 : Math.PI);
          }
        }
      }
      return;
    }

    if (entry.typeKey === "pantry") {
      const counterW = Math.min(innerW, room.w * 0.7);
      fixtureBox(floorGroup, counterW, 0.88, 0.72, room.x, 0.53, top + 0.7, fixtures.counter);
      fixtureBox(floorGroup, counterW + 0.12, 0.12, 0.82, room.x, 1.02, top + 0.7, fixtures.deskTop);
      fixtureBox(floorGroup, 0.56, 0.72, 0.48, room.x - counterW * 0.28, 1.38, top + 0.76, fixtures.dark);
      fixtureBox(floorGroup, 0.42, 0.52, 0.025, room.x - counterW * 0.28, 1.4, top + 1.02, fixtures.accentRed);
      const islandZ = room.z + room.d * 0.18;
      addTable(floorGroup, room.x, islandZ, Math.min(3.2, room.w * 0.42), 0.72, fixtures.deskTop, 0.94);
      for (const side of [-1, 1]) addChair(floorGroup, room.x + side * 1.4, islandZ + 0.84, Math.PI);
      return;
    }

    if (entry.typeKey === "lounge" || entry.typeKey === "wellness") {
      addSofa(floorGroup, room.x, room.z - 0.55, Math.min(3.2, room.w * 0.45));
      addTable(floorGroup, room.x, room.z + 0.75, Math.min(1.6, room.w * 0.24), 0.85, fixtures.meeting, 0.55);
      if (room.w >= 8) addSofa(floorGroup, room.x + room.w * 0.27, room.z + room.d * 0.2, Math.min(2.4, room.w * 0.3), 0.82);
      addPlant(floorGroup, left + 0.7, top + 0.7, 0.8);
      addPlant(floorGroup, left + room.w - 0.7, top + room.d - 0.7, 0.8);
      if (entry.typeKey === "wellness") {
        for (let i = -1; i <= 1; i++) fixtureBox(floorGroup, 1.55, 0.06, 2.2, room.x + i * 1.8, 0.05, top + room.d * 0.73, fixtures.upholstery);
      }
      return;
    }

    if (entry.typeKey === "restroom") {
      const stalls = Math.min(3, Math.max(2, Math.floor(room.w / 2.4)));
      const stallW = Math.min(1.8, innerW / stalls);
      for (let i = 0; i < stalls; i++) {
        const x = room.x + (i - (stalls - 1) / 2) * stallW;
        fixtureBox(floorGroup, 0.08, 1.6, room.d * 0.42, x + stallW * 0.42, 0.82, top + room.d * 0.3, fixtures.porcelain);
        const toilet = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16), fixtures.porcelain);
        toilet.position.set(x, 0.18, top + room.d * 0.34);
        floorGroup.add(toilet);
        fixtureBox(floorGroup, 0.78, 0.34, 0.5, x, 0.4, top + room.d * 0.28, fixtures.porcelain);
      }
      for (let i = 0; i < Math.min(2, stalls); i++) {
        const x = room.x + (i - 0.5) * Math.min(1.8, room.w * 0.22);
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.24, 16), fixtures.porcelain);
        basin.position.set(x, 0.88, top + room.d - 0.7);
        floorGroup.add(basin);
      }
      return;
    }

    if (entry.typeKey === "firstaid") {
      fixtureBox(floorGroup, Math.min(2.1, room.w * 0.42), 0.32, Math.min(3.2, room.d * 0.55), room.x - room.w * 0.2, 0.32, room.z, fixtures.medical);
      fixtureBox(floorGroup, Math.min(1.95, room.w * 0.4), 0.12, Math.min(3.05, room.d * 0.52), room.x - room.w * 0.2, 0.52, room.z, fixtures.porcelain);
      fixtureBox(floorGroup, 0.54, 0.18, 0.54, room.x - room.w * 0.2, 0.67, room.z - room.d * 0.18, fixtures.porcelain);
      fixtureBox(floorGroup, 0.14, 0.78, 0.14, room.x + room.w * 0.27, 0.39, room.z - room.d * 0.26, fixtures.medical);
      fixtureBox(floorGroup, 0.14, 0.78, 0.14, room.x + room.w * 0.27, 0.39, room.z + room.d * 0.02, fixtures.medical);
      fixtureBox(floorGroup, 0.12, 0.38, 0.12, room.x + room.w * 0.27, 0.86, room.z - room.d * 0.12, fixtures.accentRed);
      addChair(floorGroup, room.x + room.w * 0.27, room.z + room.d * 0.25);
      return;
    }

    if (entry.typeKey === "stairs") {
      const steps = 8;
      const stepW = Math.min(room.w * 0.66, 3.4);
      const stepD = Math.max(0.32, (room.d - 1.1) / steps);
      for (let i = 0; i < steps; i++) {
        const height = 0.18 * (i + 1);
        fixtureBox(floorGroup, stepW, height, stepD, room.x, height / 2, top + 0.4 + i * stepD, fixtures.counter);
      }
      for (const side of [-1, 1]) fixtureBox(floorGroup, 0.08, 1.15, 0.08, room.x + side * (stepW / 2 + 0.16), 0.58, room.z, fixtures.dark);
      return;
    }

    if (entry.typeKey === "lift") {
      fixtureBox(floorGroup, 0.14, 1.15, 0.56, room.x + room.w * 0.34, 0.62, top + 0.5, fixtures.dark);
      fixtureBox(floorGroup, 0.06, 0.22, 0.08, room.x + room.w * 0.34, 1.2, top + 0.5, fixtures.screen);
      return;
    }

    addTable(floorGroup, room.x, room.z, Math.min(2.4, room.w * 0.45), Math.min(1.2, room.d * 0.25));
  }

  // ---------- Building ----------
  const floorViews = new Map();
  const roomViews = new Map();
  const pickables = [];

  for (const floor of model.floors) {
    const group = new THREE.Group();
    group.position.y = floor.level * spacing;
    const furniture = new THREE.Group();
    group.add(furniture);
    const mats = [];
    const labels = [];

    const slabMat = fade(new THREE.MeshStandardMaterial({ color: 0xe2e9e6, roughness: 0.85, depthWrite: false }), 0.22);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.22, D), slabMat);
    slab.position.y = -0.15;
    slab.castShadow = false;
    slab.receiveShadow = true;
    group.add(slab);
    const slabEdgeMat = fade(new THREE.LineBasicMaterial({ color: COLORS.ink }), 0.4);
    const slabEdges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), slabEdgeMat);
    slabEdges.position.copy(slab.position);
    group.add(slabEdges);
    mats.push(slabMat, slabEdgeMat);

    for (const entry of model.roomsOnFloor(floor.level)) {
      const { room, type } = entry;
      const height = Math.min(WALL_H, room.height ?? WALL_H);
      const floorColor = tint(type.color, 0.84);
      const wallColor = tint(type.color, 0.76);
      const boxMat = fade(new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.86, metalness: 0, depthWrite: false }), 0.96);
      boxMat.userData.baseColor = floorColor;
      const floorGeo = new THREE.BoxGeometry(Math.max(0.5, room.w - 0.12), 0.12, Math.max(0.5, room.d - 0.12));
      const floorPlate = new THREE.Mesh(floorGeo, boxMat);
      floorPlate.position.set(room.x, 0.015, room.z);
      floorPlate.receiveShadow = true;
      floorPlate.userData = { roomId: room.id, level: floor.level, typeKey: entry.typeKey };
      const edgeMat = fade(new THREE.LineBasicMaterial({ color: COLORS.ink }), 0.52);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(floorGeo), edgeMat);
      edges.position.copy(floorPlate.position);
      group.add(floorPlate, edges);

      const wallMat = fade(new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.8, side: THREE.DoubleSide, depthWrite: false }), 0.19);
      const capMat = fade(new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.75, depthWrite: false }), 0.52);
      for (const segment of wallSegments(room, spine)) {
        const dx = Math.abs(segment.x2 - segment.x1);
        const dz = Math.abs(segment.z2 - segment.z1);
        const horizontal = dx >= dz;
        const length = Math.max(dx, dz);
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? length : WALL_T, height, horizontal ? WALL_T : length),
          wallMat
        );
        wall.position.set((segment.x1 + segment.x2) / 2, height / 2, (segment.z1 + segment.z2) / 2);
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? length : WALL_T, 0.11, horizontal ? WALL_T : length),
          capMat
        );
        cap.position.set(wall.position.x, height - 0.055, wall.position.z);
        group.add(cap);
      }
      const roomFurniture = new THREE.Group();
      furniture.add(roomFurniture);
      furnishRoom(entry, roomFurniture);

      const label = makeLabel(room.name, "room-label");
      label.position.set(room.x, height + 0.38, room.z);
      group.add(label);
      labels.push(label);

      mats.push(boxMat, edgeMat, wallMat, capMat);
      pickables.push(floorPlate);
      roomViews.set(room.id, { entry, type, typeKey: entry.typeKey, boxMat, edgeMat, wallMat, capMat, label, height, furniture: roomFurniture });
    }

    const floorLabel = makeLabel(floor.short, "floor-label");
    floorLabel.position.set(-W / 2 - 3.5, 0.6, D / 2);
    group.add(floorLabel);

    scene.add(group);
    floorViews.set(floor.level, { group, mats, labels, floorLabel, slabEdgeMat, furniture });
  }

  const elevators = [];
  const liftsByShaft = new Map();
  for (const floor of model.floors) {
    for (const entry of model.roomsOnFloor(floor.level).filter((room) => room.typeKey === "lift")) {
      const key = `${Math.round(entry.room.x * 10)}:${Math.round(entry.room.z * 10)}`;
      const shaft = liftsByShaft.get(key) ?? [];
      shaft.push(entry);
      liftsByShaft.set(key, shaft);
    }
  }

  for (const entries of liftsByShaft.values()) {
    const levels = [...new Set(entries.map((entry) => entry.level))].sort((a, b) => a - b);
    if (levels.length < 2) continue;
    const { room } = entries[0];
    const minLevel = levels[0];
    const maxLevel = levels.at(-1);
    const carWidth = Math.min(3.4, room.w * 0.58);
    const carDepth = Math.min(2.6, room.d * 0.58);
    const bottomY = minLevel * spacing - 0.12;
    const topY = maxLevel * spacing + 2.7;
    const shaftHeight = topY - bottomY;
    const shaftMaterial = new THREE.MeshPhysicalMaterial({ color: 0x8eb8cb, roughness: 0.16, transparent: true, opacity: 0.075, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(carWidth + 0.7, shaftHeight, carDepth + 0.7), shaftMaterial);
    shaft.position.set(room.x, bottomY + shaftHeight / 2, room.z);
    shaft.renderOrder = 1;
    scene.add(shaft);
    const shaftEdges = new THREE.LineSegments(new THREE.EdgesGeometry(shaft.geometry), new THREE.LineBasicMaterial({ color: 0x506c7a, transparent: true, opacity: 0.18 }));
    shaftEdges.position.copy(shaft.position);
    scene.add(shaftEdges);

    const car = new THREE.Group();
    const cabinMaterial = new THREE.MeshPhysicalMaterial({ color: 0x73b6d2, roughness: 0.22, transparent: true, opacity: 0.13, depthWrite: false });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(carWidth, 2.2, carDepth), cabinMaterial);
    car.add(cabin);
    car.add(new THREE.LineSegments(new THREE.EdgesGeometry(cabin.geometry), new THREE.LineBasicMaterial({ color: 0x1e5268, transparent: true, opacity: 0.55 })));
    fixtureBox(car, carWidth * 0.78, 0.1, carDepth * 0.78, 0, -1.02, 0, fixtures.deskTop);
    car.position.set(room.x, minLevel * spacing + 1.15, room.z);
    scene.add(car);
    const label = makeLabel("Lift · simulation", "elevator-label");
    label.visible = false;
    label.position.set(room.x, topY + 0.3, room.z);
    scene.add(label);
    elevators.push({ x: room.x, z: room.z, minLevel, maxLevel, car, label });
  }

  const topLevel = model.floors.at(-1).level;
  const overviewTarget = new THREE.Vector3(0, (topLevel * spacing) / 2 + 6, 0);
  controls.target.copy(overviewTarget);

  // ---------- Pins ----------
  function makePin(color) {
    const pin = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), mat);
    head.position.y = 2.1;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 24), mat);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.85;
    pin.add(head, tip);
    pin.visible = false;
    scene.add(pin);
    return pin;
  }
  const selectPin = makePin(COLORS.select);
  const herePin = makePin(COLORS.here);
  const hereLabel = makeLabel("You are here", "here-label");
  hereLabel.position.y = 3.8;
  herePin.add(hereLabel);

  function placePin(pin, id) {
    const v = id && roomViews.get(id);
    if (!v) {
      pin.visible = false;
      return;
    }
    pin.userData.baseY = v.entry.level * spacing + v.height + 0.25;
    pin.position.set(v.entry.room.x, pin.userData.baseY, v.entry.room.z);
    pin.visible = true;
  }

  // ---------- State ----------
  let activeLevel = null;
  let selectedId = null;
  let hoveredId = null;
  let hereId = null;
  let mode = "orbit";
  let anim = null;
  let routeGroup = null;
  let routeCurve = null;
  let routeLength = 0;
  let routeT = 0;
  let routeElapsed = 0;
  let routeDuration = 0;
  let routeVerticals = [];
  let traveler = null;
  let travelerLabel = null;
  let travelerLimbs = [];
  let routeDestinationName = "destination";
  const walk = { level: 0, yaw: 0, pitch: -0.05, keys: new Set(), glide: null };

  // ---------- Camera ----------
  const DEFAULT_DIR = new THREE.Vector3(0.9, 1.05, 1.2).normalize();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let cameraFrame = { level: null };
  function flyTo(target, distance) {
    if (mode === "walk") return;
    let dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.35) dir = DEFAULT_DIR.clone();
    if (reducedMotion.matches) {
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(dir, distance);
      anim = null;
      controls.update();
      return;
    }
    anim = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toTarget: target.clone(), toPos: target.clone().addScaledVector(dir, distance) };
  }
  controls.addEventListener("start", () => {
    anim = null;
    cameraFrame = null;
  });

  function frameLevel(level) {
    const target = level === null ? overviewTarget : new THREE.Vector3(0, level * spacing + 1, 0);
    const height = level === null ? topLevel * spacing + WALL_H : WALL_H;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFit = (W * 0.8 + D * 0.6) / (2 * Math.tan(verticalFov / 2) * camera.aspect);
    const verticalFit = (height * 0.8 + W * 0.4 + D * 0.4) / (2 * Math.tan(verticalFov / 2));
    const distance = Math.max(horizontalFit, verticalFit) * 1.04 + 12;
    controls.maxDistance = Math.max(260, distance * 1.5);
    flyTo(target, distance);
  }

  const roomCenter = (v) => new THREE.Vector3(v.entry.room.x, v.entry.level * spacing + 1, v.entry.room.z);

  // ---------- Floors ----------
  let typeFilter = null;

  function applyFloorVisibility() {
    const focus = routeVerticals.length ? null : (mode === "walk" ? walk.level : activeLevel);
    for (const [lvl, f] of floorViews) {
      const active = focus === null || lvl === focus;
      const factor = active ? 1 : 0.24;
      f.group.visible = mode !== "walk" || lvl === focus;
      f.furniture.visible = active && (focus !== null || mode === "walk");
      for (const m of f.mats) m.opacity = m.userData.base * factor;
      for (const l of f.labels) l.visible = false;
      f.floorLabel.visible = mode !== "walk";
      f.floorLabel.element.classList.toggle("is-current", focus !== null && lvl === focus);
      if (f.slabEdgeMat) f.slabEdgeMat.opacity = focus !== null && lvl === focus ? 0.75 : 0.28;
    }
    const sel = selectedId && roomViews.get(selectedId);
    if (sel) sel.label.visible = floorViews.get(sel.entry.level).group.visible;
    const hovered = hoveredId && roomViews.get(hoveredId);
    if (hovered) hovered.label.visible = true;
    applyTypeFilter();
  }

  function applyTypeFilter() {
    const focus = routeVerticals.length ? null : (mode === "walk" ? walk.level : activeLevel);
    for (const v of roomViews.values()) {
      const match = !typeFilter || v.typeKey === typeFilter;
      const levelFactor = focus !== null && v.entry.level !== focus ? 0.24 : 1;
      const factor = levelFactor * (match ? 1 : 0.18);
      v.boxMat.opacity = v.boxMat.userData.base * factor;
      v.edgeMat.opacity = v.edgeMat.userData.base * factor;
      v.wallMat.opacity = v.wallMat.userData.base * factor;
      v.capMat.opacity = v.capMat.userData.base * factor;
      v.furniture.visible = match;
    }
  }

  // ---------- Selection ----------
  function paintSelection(id, on) {
    const v = id && roomViews.get(id);
    if (!v) return;
    v.boxMat.color.setHex(on ? tint(v.type.color, 0.66) : v.boxMat.userData.baseColor);
    v.edgeMat.color.setHex(on ? 0x111111 : COLORS.ink);
    v.capMat.color.setHex(on ? 0x263b58 : v.type.color);
    v.edgeMat.opacity = on ? 0.92 : v.edgeMat.userData.base;
    v.label.element.classList.toggle("selected", on);
  }

  // ---------- Route ----------
  function disposeRoute() {
    if (routeGroup) {
      routeGroup.traverse((o) => {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((material) => material.dispose());
        else o.material?.dispose();
      });
      scene.remove(routeGroup);
    }
    routeGroup = null;
    routeCurve = null;
    traveler = null;
    travelerLabel = null;
    travelerLimbs = [];
    routeVerticals = [];
    routeDestinationName = "destination";
    routeLength = 0;
    routeT = 0;
    routeElapsed = 0;
    routeDuration = 0;
    for (const lift of elevators) {
      lift.car.position.y = lift.minLevel * spacing + 1.15;
      lift.label.element.textContent = "Lift · simulation";
      lift.label.visible = false;
    }
    applyFloorVisibility();
  }

  function setRoute(route, kind = "route") {
    disposeRoute();
    if (!route || !route.legs?.length) return;
    const color = COLORS[kind] ?? COLORS.route;
    const curve = new THREE.CurvePath();
    let currentPoint = null;
    let routeDistance = 0;
    const verticals = [...(route.verticals ?? [])];
    const usedVerticals = new Set();
    const pointAt = (point, level) => new THREE.Vector3(point.x, level * spacing + 0.35, point.z);
    const appendLine = (nextPoint, metadata = null) => {
      if (currentPoint && currentPoint.distanceTo(nextPoint) > 1e-3) {
        const segment = new THREE.LineCurve3(currentPoint.clone(), nextPoint.clone());
        const length = segment.getLength();
        curve.add(segment);
        if (metadata) routeVerticals.push({ ...metadata, start: routeDistance, end: routeDistance + length });
        routeDistance += length;
      }
      currentPoint = nextPoint.clone();
    };

    for (let i = 0; i < route.legs.length; i++) {
      const leg = route.legs[i];
      const points = (leg.points ?? []).map((point) => pointAt(point, leg.level));
      if (!points.length) continue;
      if (!currentPoint) currentPoint = points[0].clone();
      else appendLine(points[0]);
      for (let p = 1; p < points.length; p++) appendLine(points[p]);

      const nextLeg = route.legs[i + 1];
      if (!nextLeg || nextLeg.level === leg.level) continue;
      const verticalIndex = verticals.findIndex((vertical, index) =>
        !usedVerticals.has(index) && vertical.fromLevel === leg.level && vertical.toLevel === nextLeg.level
      );
      const vertical = verticalIndex >= 0 ? verticals[verticalIndex] : null;
      if (vertical) usedVerticals.add(verticalIndex);
      const at = vertical?.at ?? { x: currentPoint.x, z: currentPoint.z };
      const start = pointAt(at, leg.level);
      const end = pointAt(at, nextLeg.level);
      appendLine(start);
      let elevator = null;
      if (vertical?.via === "lift") {
        elevator = elevators
          .filter((lift) => lift.minLevel <= Math.min(leg.level, nextLeg.level) && lift.maxLevel >= Math.max(leg.level, nextLeg.level))
          .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0] ?? null;
        if (elevator) elevator.label.visible = true;
      }
      const segmentStart = routeDistance;
      appendLine(end, { fromLevel: leg.level, toLevel: nextLeg.level, via: vertical?.via ?? "stairs", elevator });
      if (routeVerticals.length) routeVerticals[routeVerticals.length - 1].start = segmentStart;
    }

    // Emergency routes end at a stair connector on the current floor; their final descent has no second walking leg.
    let tailLevel = route.legs.at(-1)?.level;
    for (let i = 0; i < verticals.length; i++) {
      const vertical = verticals[i];
      if (usedVerticals.has(i) || vertical.fromLevel !== tailLevel) continue;
      usedVerticals.add(i);
      const at = vertical.at ?? { x: currentPoint.x, z: currentPoint.z };
      appendLine(pointAt(at, vertical.fromLevel));
      const elevator = vertical.via === "lift"
        ? elevators
          .filter((lift) => lift.minLevel <= Math.min(vertical.fromLevel, vertical.toLevel) && lift.maxLevel >= Math.max(vertical.fromLevel, vertical.toLevel))
          .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0] ?? null
        : null;
      const segmentStart = routeDistance;
      appendLine(pointAt(at, vertical.toLevel), { fromLevel: vertical.fromLevel, toLevel: vertical.toLevel, via: vertical.via, elevator });
      if (routeVerticals.length) routeVerticals[routeVerticals.length - 1].start = segmentStart;
      tailLevel = vertical.toLevel;
    }
    if (curve.curves.length === 0 || routeDistance <= 0) return;

    routeGroup = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(64, curve.curves.length * 20), 0.18, 10, false), new THREE.MeshBasicMaterial({ color }));
    const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(64, curve.curves.length * 20), 0.38, 10, false), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    const start = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.18, 10, 32), new THREE.MeshBasicMaterial({ color: COLORS.ink }));
    start.rotation.x = Math.PI / 2;
    start.position.copy(curve.getPointAt(0));
    const avatar = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: kind === "itinerary" ? 0x6552bd : 0x1683a8, roughness: 0.56, emissive: kind === "itinerary" ? 0x211745 : 0x062b39, emissiveIntensity: 0.28 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x253248, roughness: 0.72 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc88762, roughness: 0.68 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.64, 4, 8), shirt);
    torso.position.y = 1.27;
    avatar.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), skin);
    head.position.y = 2.04;
    avatar.add(head);
    travelerLimbs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.16, 0.76, 0);
      const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.42, 3, 6), trousers);
      legMesh.position.y = -0.27;
      leg.add(legMesh);
      avatar.add(leg);
      travelerLimbs.push({ pivot: leg, phase: side === -1 ? 0 : Math.PI });
      const arm = new THREE.Group();
      arm.position.set(side * 0.37, 1.55, 0);
      const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.38, 3, 6), shirt);
      armMesh.position.y = -0.25;
      arm.add(armMesh);
      avatar.add(arm);
      travelerLimbs.push({ pivot: arm, phase: side === -1 ? Math.PI : 0 });
    }
    routeDestinationName = route.to?.name ?? "destination";
    const label = makeLabel("Walking to " + routeDestinationName + " · simulation", "traveler-label");
    label.position.y = 2.5;
    avatar.add(label);
    travelerLabel = label.element;
    traveler = avatar;
    routeGroup.add(halo, tube, start, avatar);
    scene.add(routeGroup);
    routeCurve = curve;
    routeLength = routeDistance;
    routeT = 0;
    routeElapsed = 0;
    routeDuration = THREE.MathUtils.clamp(routeLength / 2.8, 8, 28);
    routeCurve.updateArcLengths();
    traveler.position.copy(routeCurve.getPointAt(0));
    applyFloorVisibility();
  }

  function frameRoute() {
    if (!routeCurve || mode === "walk") return;
    cameraFrame = null;
    const box = new THREE.Box3().setFromObject(routeGroup);
    const size = box.getSize(new THREE.Vector3());
    flyTo(box.getCenter(new THREE.Vector3()), Math.max(size.x, size.y * 1.6, size.z) * 1.05 + 28);
  }

  // ---------- Walk mode ----------
  function walkTo(id, { instant = false } = {}) {
    const v = roomViews.get(id);
    if (!v) return;
    const { room } = v.entry;
    const south = room.z > spine;
    const doorZ = south ? room.z - room.d / 2 - 1 : room.z + room.d / 2 + 1;
    const target = new THREE.Vector3(room.x, v.entry.level * spacing + EYE, doorZ);
    if (v.entry.level !== walk.level || instant) {
      walk.level = v.entry.level;
      camera.position.copy(target);
      walk.yaw = south ? Math.PI : 0;
      applyFloorVisibility();
      return;
    }
    walk.glide = { from: camera.position.clone(), to: target, t: 0 };
  }

  function enterWalk() {
    mode = "walk";
    anim = null;
    controls.enabled = false;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    const level = activeLevel ?? model.floors[0].level;
    const startId =
      [hereId, selectedId].find((id) => id && roomViews.get(id) && (activeLevel === null || roomViews.get(id).entry.level === activeLevel)) ??
      model.roomsOnFloor(level).find((e) => e.typeKey === "lift")?.id ??
      model.roomsOnFloor(level)[0]?.id;
    walk.pitch = -0.05;
    if (startId) {
      walk.level = roomViews.get(startId).entry.level;
      walkTo(startId, { instant: true });
      if (roomViews.get(startId).typeKey === "lift") walk.yaw = -Math.PI / 2;
    } else {
      walk.level = level;
      walk.yaw = 0;
      camera.position.set(0, level * spacing + EYE, 0);
    }
    applyFloorVisibility();
  }

  function exitWalk() {
    mode = "orbit";
    walk.keys.clear();
    walk.glide = null;
    controls.enabled = true;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    camera.position.set(95, 85, 115);
    controls.target.copy(overviewTarget);
    applyFloorVisibility();
    cameraFrame = { level: activeLevel };
    frameLevel(activeLevel);
  }

  const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
  const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const onKeyDown = (e) => {
    if (mode !== "walk" || isTyping(e.target) || !MOVE_KEYS.has(e.code)) return;
    walk.keys.add(e.code);
    walk.glide = null;
    if (e.code.startsWith("Arrow")) e.preventDefault();
  };
  const onKeyUp = (e) => walk.keys.delete(e.code);
  const onBlur = () => walk.keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  function updateWalk(dt) {
    const k = walk.keys;
    const speed = WALK_SPEED * (k.has("ShiftLeft") || k.has("ShiftRight") ? 2 : 1) * dt;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const side = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const turn = (k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0);
    walk.yaw += turn * dt * 1.8;
    if (fwd || side) {
      camera.position.x += (-Math.sin(walk.yaw) * fwd + Math.cos(walk.yaw) * side) * speed;
      camera.position.z += (-Math.cos(walk.yaw) * fwd - Math.sin(walk.yaw) * side) * speed;
    }
    if (walk.glide) {
      walk.glide.t = Math.min(1, walk.glide.t + dt / 1.1);
      const e = 1 - Math.pow(1 - walk.glide.t, 3);
      camera.position.lerpVectors(walk.glide.from, walk.glide.to, e);
      if (walk.glide.t === 1) walk.glide = null;
    }
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -W / 2 + 0.5, W / 2 - 0.5);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -D / 2 + 0.5, D / 2 - 0.5);
    camera.position.y = walk.level * spacing + EYE;
    camera.rotation.set(walk.pitch, walk.yaw, 0, "YXZ");
  }

  // ---------- Picking & look ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;

  function pickRoom(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const focus = mode === "walk" ? walk.level : activeLevel;
    const candidates = pickables.filter((mesh) =>
      (focus === null || mesh.userData.level === focus) && (!typeFilter || mesh.userData.typeKey === typeFilter)
    );
    return raycaster.intersectObjects(candidates, false)[0]?.object.userData.roomId ?? null;
  }

  function setHovered(id) {
    if (hoveredId === id) return;
    const previous = hoveredId && roomViews.get(hoveredId);
    if (previous) {
      previous.label.element.classList.remove("hovered");
      paintSelection(hoveredId, hoveredId === selectedId);
    }
    hoveredId = id;
    const current = id && roomViews.get(id);
    if (current) {
      current.label.element.classList.add("hovered");
      current.boxMat.color.setHex(tint(current.type.color, 0.6));
    }
    renderer.domElement.style.cursor = id ? "pointer" : "grab";
    applyFloorVisibility();
  }

  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY };
    if (mode === "walk") renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!down && mode === "orbit" && e.pointerType !== "touch") setHovered(pickRoom(e));
    if (!down || mode !== "walk") return;
    walk.yaw -= (e.clientX - down.lastX) * 0.005;
    walk.pitch = THREE.MathUtils.clamp(walk.pitch - (e.clientY - down.lastY) * 0.004, -1.2, 1.2);
    down.lastX = e.clientX;
    down.lastY = e.clientY;
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    const start = down;
    down = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
    onPick(pickRoom(e));
  });
  renderer.domElement.addEventListener("pointerleave", () => setHovered(null));
  renderer.domElement.addEventListener("pointercancel", () => { down = null; });

  // ---------- Render loop ----------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    if (mode === "orbit" && cameraFrame) frameLevel(cameraFrame.level);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    if (mode === "walk") {
      updateWalk(dt);
    } else {
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / 0.9);
        const k = 1 - Math.pow(1 - anim.t, 3);
        camera.position.lerpVectors(anim.fromPos, anim.toPos, k);
        controls.target.lerpVectors(anim.fromTarget, anim.toTarget, k);
        if (anim.t === 1) anim = null;
      }
      controls.update();
    }

    container.parentElement.style.setProperty("--camera-bearing", `${mode === "walk" ? walk.yaw : controls.getAzimuthalAngle()}rad`);

    [selectPin, herePin].forEach((pin, i) => {
      if (pin.visible) pin.position.y = pin.userData.baseY + (reducedMotion.matches ? 0 : Math.abs(Math.sin(t * 2.4 + i)) * 0.25);
    });

    if (routeCurve && traveler && routeLength > 0) {
      routeElapsed = Math.min(routeDuration, routeElapsed + dt);
      routeT = routeDuration > 0 ? routeElapsed / routeDuration : 1;
      traveler.position.copy(routeCurve.getPointAt(routeT));
      const direction = routeCurve.getTangentAt(routeT);
      if (Math.hypot(direction.x, direction.z) > 1e-3) traveler.rotation.y = Math.atan2(direction.x, direction.z);
      const walking = routeT < 1;
      for (const limb of travelerLimbs) limb.pivot.rotation.x = walking ? Math.sin(t * 7 + limb.phase) * 0.38 : 0;
      if (!walking && travelerLabel) travelerLabel.textContent = "Arrived in " + routeDestinationName + " · simulation";

      const travelled = routeT * routeLength;
      for (const vertical of routeVerticals) {
        if (!vertical.elevator) continue;
        if (travelled >= vertical.start && travelled <= vertical.end) {
          vertical.elevator.car.position.y = traveler.position.y + 0.8;
          const directionText = vertical.toLevel > vertical.fromLevel ? "up" : "down";
          vertical.elevator.label.element.textContent = "Lift going " + directionText + " · simulation";
        } else if (travelled > vertical.end) {
          vertical.elevator.car.position.y = vertical.toLevel * spacing + 1.15;
          vertical.elevator.label.element.textContent = "Lift · Floor " + vertical.toLevel + " · simulation";
        }
      }
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  let running = false;
  function setVisible(visible) {
    if (visible === running) return;
    running = visible;
    labelRenderer.domElement.hidden = !visible;
    if (visible) {
      clock.getDelta();
      resize();
    }
    renderer.setAnimationLoop(visible ? frame : null);
  }

  applyFloorVisibility();

  return {
    zoomBy(factor) {
      if (mode !== "orbit") return;
      cameraFrame = null;
      flyTo(controls.target, THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * factor, controls.minDistance, controls.maxDistance));
    },
    resetCamera() {
      if (mode !== "orbit") return;
      camera.position.copy(controls.target).addScaledVector(DEFAULT_DIR, camera.position.distanceTo(controls.target));
      cameraFrame = { level: activeLevel };
      frameLevel(activeLevel);
    },
    setTypeFilter(type) {
      setHovered(null);
      typeFilter = type || null;
      applyTypeFilter();
    },
    setActiveLevel(level) {
      setHovered(null);
      activeLevel = level;
      if (mode === "walk" && level !== null && level !== walk.level) {
        const lift = model.roomsOnFloor(level).find((e) => e.typeKey === "lift") ?? model.roomsOnFloor(level)[0];
        if (lift) walkTo(lift.id, { instant: true });
      }
      applyFloorVisibility();
    },
    flyToLevel(level) {
      cameraFrame = { level };
      frameLevel(level);
    },
    setSelected(id) {
      paintSelection(selectedId, false);
      selectedId = id;
      paintSelection(selectedId, true);
      placePin(selectPin, id && id !== hereId ? id : null);
      applyFloorVisibility();
    },
    setHere(id) {
      hereId = id;
      placePin(herePin, id);
      placePin(selectPin, selectedId && selectedId !== hereId ? selectedId : null);
    },
    focusRoom(id) {
      const v = roomViews.get(id);
      if (!v) return;
      if (mode === "walk") walkTo(id);
      else {
        cameraFrame = null;
        flyTo(roomCenter(v), (Math.max(v.entry.room.w, v.entry.room.d) * 1.5 + 22) / Math.min(1, camera.aspect));
      }
    },
    setRoute,
    frameRoute,
    setView(view) {
      if (view === "walk" && mode !== "walk") enterWalk();
      else if (view !== "walk" && mode === "walk") exitWalk();
    },
    setVisible,
    dispose() {
      setVisible(false);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      disposeRoute();
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}
