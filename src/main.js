import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CHARACTERS, MAJLIS_SCENES } from "./characters.js";
import { buildWorld, OBJECTS } from "./world.js";
import { Sim } from "./sim.js";
import { initUI, updateUI, setClock } from "./ui.js";

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0e8);
scene.fog = new THREE.Fog(0x9fd0e8, 70, 140);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(26, 24, 30);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance = 10;
controls.maxDistance = 70;
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x55663f, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45;
sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 140;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------- world & sims
const world = buildWorld(scene);

const spawnRing = (i, n) => new THREE.Vector3(Math.cos((i / n) * Math.PI * 2) * 8, 0, 10 + Math.sin((i / n) * Math.PI * 2) * 4);
const sims = CHARACTERS.map((def, i) => new Sim(def, scene, spawnRing(i, CHARACTERS.length)));

// plumbob (selection diamond)
const plumbob = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.32),
  new THREE.MeshStandardMaterial({ color: 0x4be38a, emissive: 0x1d7a45, roughness: 0.3 })
);
plumbob.visible = false;
scene.add(plumbob);

let selected = null;
function select(sim) {
  selected = sim;
  plumbob.visible = !!sim;
  const cb = document.getElementById("btn-control");
  if (cb) cb.classList.toggle("active", !!sim && sim.autonomy === false);
}

initUI(sims, select);

const simById = id => sims.find(s => s.id === id);

// ---------------------------------------------------------------- toast
const toastEl = document.getElementById("toast");
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastTimer = 2.2;
}

// ---------------------------------------------------------------- مجلس scene
// Gathers everyone onto the rug cushions and walks a scripted dialogue.
const majlis = { active: false, queue: [], timer: 0 };

function startMajlis() {
  if (majlis.active) { stopMajlis(); return; }
  majlis.active = true;
  document.getElementById("btn-majlis").classList.add("active");
  // seat each sim on the nearest free cushion, facing the fire
  const seats = world.majlisSeats.slice();
  for (const sim of sims) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < seats.length; i++) {
      if (!seats[i]) continue;
      const d = seats[i].distanceToSquared(sim.mesh.position);
      if (d < bestD) { bestD = d; best = i; }
    }
    sim.gatherTo(seats[best], world.majlisCenter);
    seats[best] = null;
  }
  // pick a scene and build the dialogue queue (after a beat to let them sit)
  const scene = MAJLIS_SCENES[Math.floor(Math.random() * MAJLIS_SCENES.length)];
  majlis.queue = scene.map(([id, text]) => ({ id, text }));
  majlis.timer = 3.0;
  toast("🪔 المجلس بدأ — the hangout begins");
}

function stopMajlis() {
  majlis.active = false;
  majlis.queue = [];
  document.getElementById("btn-majlis").classList.remove("active");
  for (const sim of sims) sim.unsetGather();
  toast("المجلس انتهى — back to free will");
}

function updateMajlis(dt) {
  if (!majlis.active) return;
  majlis.timer -= dt;
  if (majlis.timer <= 0) {
    const next = majlis.queue.shift();
    if (next) {
      const sim = simById(next.id);
      if (sim) sim.sayText(next.text);
      majlis.timer = 2.4 + Math.min(2.5, next.text.length * 0.045);
    } else {
      stopMajlis(); // scene finished
    }
  }
}

// ---------------------------------------------------------------- follow cam
let followCam = false;
function toggleFollow() {
  followCam = !followCam;
  document.getElementById("btn-follow").classList.toggle("active", followCam);
  if (followCam && !selected) toast("Pick a friend first, then Follow");
}

// ---------------------------------------------------------------- save / load
const SAVE_KEY = "mbti-house-save-v1";
function saveGame() {
  const data = {
    gameMinutes, day,
    sims: sims.map(s => ({ id: s.id, needs: s.needs, rel: s.relationships,
      x: s.mesh.position.x, z: s.mesh.position.z }))
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); toast("💾 Saved"); }
  catch { toast("Couldn't save (storage blocked)"); }
}
function loadGame() {
  let raw; try { raw = localStorage.getItem(SAVE_KEY); } catch { return false; }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    gameMinutes = data.gameMinutes ?? gameMinutes;
    day = data.day ?? day;
    for (const sd of data.sims || []) {
      const sim = simById(sd.id);
      if (!sim) continue;
      Object.assign(sim.needs, sd.needs || {});
      sim.relationships = sd.rel || {};
      if (typeof sd.x === "number") sim.mesh.position.set(sd.x, 0, sd.z);
    }
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- time
let gameMinutes = 8 * 60; // start 8:00 AM
let day = 1;
let speed = 1; // game-minutes per real second (x60 feels right at "1x")
const SPEEDS = { 0: 0, 1: 1, 3: 3 };

document.querySelectorAll("#clock button").forEach(btn => {
  btn.addEventListener("click", () => {
    speed = SPEEDS[btn.dataset.speed];
    document.querySelectorAll("#clock button").forEach(b => b.classList.toggle("active", b === btn));
  });
});

function setSpeed(v) {
  speed = v;
  document.querySelectorAll("#clock button").forEach(b => b.classList.toggle("active", SPEEDS[b.dataset.speed] === v));
}

// toolbar buttons
document.getElementById("btn-majlis").addEventListener("click", startMajlis);
document.getElementById("btn-follow").addEventListener("click", toggleFollow);
document.getElementById("btn-save").addEventListener("click", saveGame);
document.getElementById("btn-reset").addEventListener("click", () => {
  gameMinutes = 8 * 60; day = 1; toast("↺ New day");
});
const controlBtn = document.getElementById("btn-control");
controlBtn.addEventListener("click", () => {
  if (!selected) { toast("Pick a friend to control"); return; }
  selected.autonomy = selected.autonomy === false ? true : false;
  controlBtn.classList.toggle("active", selected.autonomy === false);
  toast(selected.autonomy === false
    ? `🎮 You control ${selected.def.name} — click to move them`
    : `${selected.def.name} has free will again`);
});

// keyboard shortcuts
window.addEventListener("keydown", e => {
  if (e.key >= "1" && e.key <= "8") {
    const sim = sims[parseInt(e.key, 10) - 1];
    if (sim) select(sim);
  } else if (e.code === "Space") {
    e.preventDefault();
    setSpeed(speed > 0 ? 0 : 1);
  } else if (e.key === "g" || e.key === "G") {
    startMajlis();
  } else if (e.key === "f" || e.key === "F") {
    toggleFollow();
  }
});

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

canvas.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", e => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return; // it was a camera drag

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);

  for (const hit of hits) {
    // 1) clicked a sim → select them
    const simId = hit.object.userData.simId;
    if (simId) { select(sims.find(s => s.id === simId)); return; }

    // 2) clicked furniture → command selected sim to use it
    const objId = hit.object.userData.objectId;
    if (objId && selected) {
      const obj = OBJECTS.find(o => o.id === objId);
      if (obj) { selected.commandUse(obj); return; }
    }

    // 3) clicked ground → send selected sim walking
    if (hit.object.userData.ground && selected) {
      const p = hit.point.clone();
      p.y = 0;
      p.x = THREE.MathUtils.clamp(p.x, -26, 26);
      p.z = THREE.MathUtils.clamp(p.z, -14, 22);
      selected.commandMove(p);
      return;
    }
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- day/night
function updateDayNight() {
  const t = (gameMinutes % 1440) / 1440; // 0..1 over the day
  const sunAngle = (t - 0.25) * Math.PI * 2; // sunrise ~6am
  const elev = Math.sin(sunAngle);
  sun.position.set(Math.cos(sunAngle) * 60, Math.max(elev, 0.02) * 60, 25);
  const dayAmount = THREE.MathUtils.clamp(elev * 2.2, 0, 1);
  sun.intensity = 0.15 + dayAmount * 1.5;
  hemi.intensity = 0.25 + dayAmount * 0.65;
  const sky = new THREE.Color(0x101a30).lerp(new THREE.Color(0x9fd0e8), dayAmount);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);

  // fire pit comes alive at night
  const night = 1 - dayAmount;
  if (world.fireLight) {
    const flicker = 0.85 + Math.sin(performance.now() * 0.012) * 0.15;
    world.fireLight.intensity = night * 2.4 * flicker;
    world.flame.visible = night > 0.25;
    world.flame.scale.y = 0.85 + flicker * 0.25;
    world.flame.material.emissiveIntensity = 1.0 + night * 0.8;
  }
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // 1 real second = `speed` game-minutes... scaled so 1x ≈ 1 game-min/sec
  const dm = dt * speed * 1.0 * 60 / 60 * 10; // 10 game-min per real sec at 1x
  if (dm > 0) {
    gameMinutes += dm;
    if (gameMinutes >= 1440) { gameMinutes -= 1440; day++; }
    for (const sim of sims) sim.update(dt * (speed > 0 ? 1 : 0), dm, sims);
  }

  updateMajlis(speed > 0 ? dt : 0);
  updateDayNight();
  setClock(gameMinutes, day);

  if (selected) {
    plumbob.position.copy(selected.mesh.position);
    plumbob.position.y = selected.mesh.position.y + 2.75;
    plumbob.rotation.y += dt * 2;
  }

  // follow camera: ease the orbit target toward the selected friend
  if (followCam && selected) {
    controls.target.lerp(selected.mesh.position, Math.min(1, dt * 3));
  }

  // toast fade
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.remove("show");
  }

  // autosave every ~20s of real time
  autosaveAcc += dt;
  if (autosaveAcc > 20) { autosaveAcc = 0; try { localStorage.setItem(SAVE_KEY, JSON.stringify({
    gameMinutes, day,
    sims: sims.map(s => ({ id: s.id, needs: s.needs, rel: s.relationships, x: s.mesh.position.x, z: s.mesh.position.z }))
  })); } catch {} }

  controls.update();
  renderer.render(scene, camera);
  updateUI(sims, selected, camera);
}

let autosaveAcc = 0;
if (loadGame()) toast("Resumed your saved house");
tick();
