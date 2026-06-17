// game.js — Diriyah Explorer. Ties the city, the player, the culture cards,
// the collectibles and the HUD together into a playable little world.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCity } from './map.js';
import { createPlayer } from './player.js';
import { INTRO, LANDMARKS, QAHWA_WISDOM } from './culture.js';

const $ = (id) => document.getElementById(id);

// ---------------- renderer / scene ----------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Correct sRGB output across three.js versions (r152+ does this by default;
// older builds need outputEncoding set or the scene looks washed out).
if (!('outputColorSpace' in renderer) && 'outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) {
  renderer.outputEncoding = THREE.sRGBEncoding;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (THREE.ACESFilmicToneMapping !== undefined) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeadbb6);
scene.fog = new THREE.Fog(0xeedcb4, 260, 720);

// gradient sky dome (pale desert blue up top, warm haze at the horizon)
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x8bb8e6) }, bot: { value: new THREE.Color(0xf4e6c6) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float h; void main(){ gl_FragColor = vec4(mix(bot, top, clamp(h*1.4+0.15,0.0,1.0)), 1.0); }',
  })
);
scene.add(sky);

// a few soft drifting clouds
const clouds = new THREE.Group();
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, transparent: true, opacity: 0.7, fog: false });
for (let i = 0; i < 14; i++) {
  const c = new THREE.Group();
  const n = 3 + (i % 3);
  for (let k = 0; k < n; k++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(14 + Math.random() * 14, 8, 6), cloudMat);
    puff.position.set((k - n / 2) * 16, Math.random() * 6, Math.random() * 8);
    puff.scale.y = 0.5; c.add(puff);
  }
  c.position.set((Math.random() - 0.5) * 1600, 180 + Math.random() * 120, (Math.random() - 0.5) * 1600);
  clouds.add(c);
}
scene.add(clouds);

// faint floating dust motes drifting in the sun (follows the player)
const DUST = 140;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 60;
  dustPos[i * 3 + 1] = Math.random() * 12;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff3d8, size: 0.18, transparent: true, opacity: 0.5, depthWrite: false, fog: true }));
scene.add(dust);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(0, 18, 26);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.49;
controls.enablePan = false;

// ---------------- lighting / sky ----------------
const hemi = new THREE.HemisphereLight(0xfff1d4, 0xb08a5a, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
sun.position.set(80, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const S = 140;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.camera.far = 400; sun.shadow.bias = -0.0004;
scene.add(sun);
const sunTarget = new THREE.Object3D(); scene.add(sunTarget); sun.target = sunTarget;

// a soft sun disk in the sky
const sunDisk = new THREE.Mesh(
  new THREE.SphereGeometry(18, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false })
);
sunDisk.position.set(300, 200, -200); scene.add(sunDisk);

// ---------------- state ----------------
let world = null, player = null;
const clock = new THREE.Clock();
const keys = {};
let dateCount = 0, found = 0, total = 0;
let running = false;
const dates = [];
const tmpForward = new THREE.Vector3(), tmpRight = new THREE.Vector3();

// ---------------- audio (tiny WebAudio) ----------------
let actx = null, masterGain = null, muted = false;
function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = actx.createGain(); masterGain.gain.value = 0.5; masterGain.connect(actx.destination);
  // warm ambient pad (two detuned saws through a lowpass + slow tremolo)
  const pad = actx.createGain(); pad.gain.value = 0.06; pad.connect(masterGain);
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.connect(pad);
  [110, 110.6, 164.8].forEach((f) => { const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); });
  const lfo = actx.createOscillator(); lfo.frequency.value = 0.15; const lg = actx.createGain(); lg.gain.value = 0.025; lfo.connect(lg); lg.connect(pad.gain); lfo.start();
}
function blip(freq, dur = 0.16, type = 'triangle', vol = 0.3) {
  if (!actx || muted) return;
  const o = actx.createOscillator(); const g = actx.createGain();
  o.type = type; o.frequency.value = freq; o.connect(g); g.connect(masterGain);
  const t = actx.currentTime;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
const chime = () => { blip(880, 0.12, 'triangle', 0.25); setTimeout(() => blip(1320, 0.14, 'triangle', 0.2), 70); };
const fanfare = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.28), i * 120)); };

// ---------------- collectible dates ----------------
function makeDate() {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe0a23a, emissive: 0x6b4310, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.3 })
  );
  body.scale.set(0.7, 1.05, 0.7); grp.add(body);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 5), new THREE.MeshStandardMaterial({ color: 0x5a9e44, flatShading: true }));
  leaf.position.y = 0.42; grp.add(leaf);
  return grp;
}

// ---------------- culture card ----------------
function openCard(key) {
  const c = LANDMARKS[key]; if (!c) return;
  $('cardIcon').textContent = c.icon;
  $('cardAr').textContent = c.ar;
  $('cardEn').textContent = c.en;
  $('cardTag').textContent = c.tag;
  $('cardBody').textContent = c.body;
  $('cardFact').textContent = '💡 ' + c.fact;
  $('card').classList.add('open');
  running = false; // pause sim while reading
}
$('cardClose').onclick = () => { $('card').classList.remove('open'); running = true; clock.getDelta(); };

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1400);
}

// ---------------- input ----------------
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });

// touch joystick
const joy = { active: false, x: 0, y: 0, id: null };
const joyBase = $('joy'), joyKnob = $('joyStick');
function joyStart(e) {
  const t = e.changedTouches ? e.changedTouches[0] : e;
  joy.active = true; joy.id = t.identifier ?? 'mouse';
  joyBase.classList.add('show');
  const r = joyBase.getBoundingClientRect();
  joyBase._cx = r.left + r.width / 2; joyBase._cy = r.top + r.height / 2;
  joyMove(e);
}
function joyMove(e) {
  if (!joy.active) return;
  let t = e;
  if (e.changedTouches) { t = [...e.changedTouches].find((x) => x.identifier === joy.id) || e.changedTouches[0]; }
  let dx = t.clientX - joyBase._cx, dy = t.clientY - joyBase._cy;
  const max = 46, d = Math.hypot(dx, dy);
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  joy.x = dx / max; joy.y = dy / max;
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}
function joyEnd() { joy.active = false; joy.x = joy.y = 0; joyKnob.style.transform = 'translate(0,0)'; }
joyBase.addEventListener('touchstart', (e) => { e.preventDefault(); joyStart(e); }, { passive: false });
joyBase.addEventListener('touchmove', (e) => { e.preventDefault(); joyMove(e); }, { passive: false });
joyBase.addEventListener('touchend', (e) => { e.preventDefault(); joyEnd(); }, { passive: false });
// show joystick zone only on touch devices
if (matchMedia('(pointer: coarse)').matches) joyBase.classList.add('show');

$('muteBtn').onclick = () => { muted = !muted; if (masterGain) masterGain.gain.value = muted ? 0 : 0.5; $('muteBtn').textContent = muted ? '🔇' : '🔊'; };

// ---------------- loop ----------------
function getMoveInput() {
  // camera-relative forward/right on the XZ plane
  camera.getWorldDirection(tmpForward); tmpForward.y = 0; tmpForward.normalize();
  tmpRight.crossVectors(tmpForward, new THREE.Vector3(0, 1, 0)).normalize();
  let f = 0, r = 0;
  if (keys['KeyW'] || keys['ArrowUp']) f += 1;
  if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) r += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) r -= 1;
  // joystick
  f -= joy.y; r += joy.x;
  return {
    x: tmpForward.x * f + tmpRight.x * r,
    z: tmpForward.z * f + tmpRight.z * r,
  };
}

function updateCompass() {
  if (!world) return;
  let best = null, bd = Infinity;
  for (const lm of world.landmarks) {
    if (lm.discovered) continue;
    const d = lm.pos.distanceTo(player.position);
    if (d < bd) { bd = d; best = lm; }
  }
  const arrow = $('compass');
  if (!best) { arrow.style.opacity = '0'; $('compassDist').textContent = ''; return; }
  arrow.style.opacity = '1';
  const ang = Math.atan2(best.pos.x - player.position.x, best.pos.z - player.position.z);
  // angle relative to camera facing
  const camAng = Math.atan2(tmpForward.x, tmpForward.z);
  $('compassArrow').style.transform = `rotate(${(ang - camAng)}rad)`;
  $('compassDist').textContent = Math.round(bd) + ' m';
}

let markerT = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  markerT += dt;

  if (world) world.updateMarkers(markerT);

  // drift clouds; keep dust + sky centred on the action
  clouds.position.x = (markerT * 4) % 1700 - 850;
  if (player) {
    sky.position.set(player.position.x, 0, player.position.z);
    dust.position.set(player.position.x, 0, player.position.z);
    const dp = dust.geometry.attributes.position;
    for (let i = 0; i < DUST; i++) {
      dp.array[i * 3 + 1] += dt * 0.4;
      if (dp.array[i * 3 + 1] > 12) dp.array[i * 3 + 1] = 0;
    }
    dp.needsUpdate = true;
  }

  // bob/spin dates
  for (const d of dates) { if (d.taken) continue; d.mesh.rotation.y += dt * 2; d.mesh.position.y = 0.9 + Math.sin(markerT * 3 + d.phase) * 0.18; }

  if (running && player && world) {
    const moving = player.update(dt, getMoveInput(), world);

    // follow camera target
    controls.target.lerp(tmpVecSet(player.position.x, 1.4, player.position.z), 0.18);

    // date pickups
    for (const d of dates) {
      if (d.taken) continue;
      const dx = d.mesh.position.x - player.position.x, dz = d.mesh.position.z - player.position.z;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        d.taken = true; d.mesh.visible = false; dateCount++;
        $('hudDates').textContent = dateCount;
        chime(); toast('+1 تمر  🌴');
      }
    }

    // landmark discovery
    for (const lm of world.landmarks) {
      if (lm.discovered) continue;
      if (lm.pos.distanceTo(player.position) < lm.radius) {
        lm.discovered = true; found++;
        $('hudMarks').textContent = found + ' / ' + total;
        fanfare(); openCard(lm.key);
        if (found === total) setTimeout(showWin, 600);
      }
    }
    updateCompass();
  }

  controls.update();
  renderer.render(scene, camera);
}

const _v = new THREE.Vector3();
function tmpVecSet(x, y, z) { return _v.set(x, y, z); }

function showWin() {
  $('winDates').textContent = dateCount;
  $('win').classList.add('open');
  fanfare(); setTimeout(fanfare, 700);
}
$('winClose').onclick = () => $('win').classList.remove('open');

// ---------------- bootstrap ----------------
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize); resize();

async function boot() {
  // rotate wisdom on the veil
  let wi = 0;
  $('veilWisdom').textContent = QAHWA_WISDOM[0];
  const wisdomTimer = setInterval(() => { wi = (wi + 1) % QAHWA_WISDOM.length; $('veilWisdom').textContent = QAHWA_WISDOM[wi]; }, 3200);

  world = await loadCity(scene, './src/diriyah/');
  total = world.landmarks.length;
  $('hudMarks').textContent = '0 / ' + total;

  player = createPlayer(scene);
  player.setSpawn(world.spawn[0], world.spawn[1]);
  controls.target.set(world.spawn[0], 1.4, world.spawn[1]);
  camera.position.set(world.spawn[0] + 16, 14, world.spawn[1] + 22);

  // place dates
  for (const p of world.datePositions) {
    const m = makeDate(); m.position.copy(p); scene.add(m);
    dates.push({ mesh: m, taken: false, phase: Math.random() * 6.28 });
  }

  // fill intro card text
  $('introAr').textContent = INTRO.ar;
  $('introEn').textContent = INTRO.en;
  $('introBody').textContent = INTRO.body;
  $('introTip').textContent = INTRO.tip;

  // debug handle (harmless; handy for testing / tinkering in the console)
  window.__diriyah = { scene, camera, world, player, dates, get state() { return { dateCount, found, total }; } };

  clearInterval(wisdomTimer);
  $('veilLoading').style.display = 'none';
  $('veilIntro').style.display = 'block';
  $('startBtn').disabled = false;

  animate(); // render the world behind the intro
}

$('startBtn').onclick = () => {
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  $('veil').classList.add('gone');
  running = true; clock.getDelta();
};

boot().catch((err) => {
  $('veilWisdom').textContent = 'Could not load the map: ' + err.message;
  console.error(err);
});
