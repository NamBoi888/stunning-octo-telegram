// game.js — Diriyah Explorer. Ties the city, the player, the culture cards,
// the collectibles and the HUD together into a playable little world.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCity } from './map.js';
import { createPlayer } from './player.js';
import { INTRO, LANDMARKS, QAHWA_WISDOM } from './culture.js';

const $ = (id) => document.getElementById(id);

// ---------------- renderer / scene ----------------
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 760;
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
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
const DUST = MOBILE ? 70 : 140;
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
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
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
let bannersRaised = 0, totalBanners = 0;
let running = false;
let climbTween = null;
const dates = [];
const falcons = [];
const villagers = [];
const goats = [];
const wisps = [];
let roc = null;
let carpet = null;
const tmpForward = new THREE.Vector3(), tmpRight = new THREE.Vector3();

// ---- superpowers from Arabian folklore (cooldown-gated) ----
const POWERS = {
  carpet: { btn: 'abCarpet', cd: 12, t: 0 },   // بساط الريح — flying carpet
  leap:   { btn: 'abLeap',   cd: 1.2, t: 0 },  // وثبة الصقر — falcon's leap
  dash:   { btn: 'abDash',   cd: 6, t: 0 },    // زوبعة الجن — jinn whirlwind
};

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
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); tryClimb(); }
  if (e.code === 'KeyF') { e.preventDefault(); usePower('carpet'); }
  if (e.code === 'KeyJ') { e.preventDefault(); usePower('leap'); }
  if (e.code === 'KeyK' || e.code === 'ShiftLeft') { e.preventDefault(); usePower('dash'); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---- superpowers ----
function usePower(name) {
  if (!running || !player || player.climbing) return;
  const P = POWERS[name];
  if (name === 'carpet') {
    if (player.flying) { player.landFly(); return; }         // toggle to land early
    if (P.t > 0) return;
    if (player.startFly()) { P.t = P.cd; carpet.visible = true; blip(330, 0.18, 'sine', 0.22); setTimeout(() => blip(440, 0.18, 'sine', 0.18), 90); toast('🟦 بساط الريح · Flying carpet!'); }
  } else if (name === 'leap') {
    if (P.t > 0) return;
    if (player.jump()) { P.t = P.cd; blip(660, 0.12, 'square', 0.16); }
  } else if (name === 'dash') {
    if (P.t > 0) return;
    if (player.dash()) { P.t = P.cd; whirlBurst(); blip(200, 0.25, 'sawtooth', 0.18); toast('🌀 زوبعة الجن · Whirlwind!'); }
  }
}

// find the ladder you're standing at and climb up (or down if you're on a roof)
function nearestLadder() {
  if (!world || !player) return null;
  const onRoof = player.position.y > 1;
  let best = null, bd = 3.0;
  for (const L of world.ladders) {
    const ref = onRoof ? L.top : L.stand;
    const d = Math.hypot(player.position.x - ref.x, player.position.z - ref.z);
    if (d < bd) { bd = d; best = L; }
  }
  return best;
}
function tryClimb() {
  if (!running || !player || player.climbing || climbTween) return;
  const L = nearestLadder(); if (!L) return;
  const onRoof = player.position.y > 1;
  const from = player.position.clone();
  const to = (onRoof ? L.stand : L.top).clone();
  climbTween = { from, to, t: 0, dur: Math.max(0.8, L.h * 0.12) };
  player.setClimbing(true);
  blip(523, 0.1, 'sine', 0.18);
}

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
// show joystick zone + climb button only on touch devices
if (matchMedia('(pointer: coarse)').matches) { joyBase.classList.add('show'); $('climbBtn').classList.add('touch'); }
$('climbBtn').onclick = tryClimb;
$('abCarpet').onclick = () => usePower('carpet');
$('abLeap').onclick = () => usePower('leap');
$('abDash').onclick = () => usePower('dash');

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

  // circling falcons (falconry heritage) + waving raised banners
  for (const f of falcons) {
    f.a += dt * f.speed;
    f.group.position.set(f.cx + Math.cos(f.a) * f.r, f.alt + Math.sin(f.a * 2) * 3, f.cz + Math.sin(f.a) * f.r);
    f.group.rotation.y = -f.a + Math.PI / 2;
    const flap = Math.sin(markerT * 8 + f.phase) * 0.6;
    f.wingL.rotation.z = 0.3 + flap; f.wingR.rotation.z = -0.3 - flap;
  }
  if (world) for (const b of world.banners) {
    if (b.raised) {
      if (b.raiseAnim < 1) {
        b.raiseAnim = Math.min(1, b.raiseAnim + dt * 1.3);
        const s = b.raiseAnim * b.raiseAnim * (3 - 2 * b.raiseAnim);
        b.cloth.scale.setScalar(Math.max(0.001, s));
        b.cloth.position.y = 0.7 + s * 2.7;
      }
      b.cloth.rotation.y = Math.sin(markerT * 4 + b.pos.x) * 0.18;
    }
  }

  // the Roc crossing the sky
  if (roc) {
    roc.a += dt * roc.speed;
    roc.group.position.set(roc.cx + Math.cos(roc.a) * roc.r, roc.alt + Math.sin(roc.a) * 18, roc.cz + Math.sin(roc.a) * roc.r);
    roc.group.rotation.y = -roc.a + Math.PI / 2;
    const flap = Math.sin(markerT * 1.6) * 0.5;
    roc.wingL.rotation.z = 0.3 + flap; roc.wingR.rotation.z = -0.3 - flap;
  }
  // jinn wisps drift + flicker
  for (const w of wisps) {
    w.group.position.x = w.hx + Math.sin(markerT * 0.6 + w.phase) * 3;
    w.group.position.z = w.hz + Math.cos(markerT * 0.5 + w.phase) * 3;
    w.group.position.y = 1.6 + Math.sin(markerT * 2 + w.phase) * 0.6;
    w.core.material.emissiveIntensity = 1.1 + Math.sin(markerT * 6 + w.phase) * 0.5;
  }
  // dash dust bursts
  for (let i = bursts.length - 1; i >= 0; i--) {
    const bu = bursts[i]; bu.life += dt;
    const a = bu.pts.geometry.attributes.position.array;
    for (let k = 0; k < bu.vel.length; k++) {
      a[k * 3] += bu.vel[k][0] * dt; a[k * 3 + 1] += bu.vel[k][1] * dt; a[k * 3 + 2] += bu.vel[k][2] * dt;
      bu.vel[k][1] -= 9 * dt;
    }
    bu.pts.geometry.attributes.position.needsUpdate = true;
    bu.pts.material.opacity = Math.max(0, 0.85 - bu.life);
    if (bu.life > 0.85) { scene.remove(bu.pts); bursts.splice(i, 1); }
  }
  // water shimmer
  if (world && world.waterMesh) world.waterMesh.material.opacity = 0.8 + Math.sin(markerT * 1.5) * 0.07;

  // carpet under the player while flying
  if (player && carpet) {
    if (player.flying) {
      carpet.group.visible = true;
      carpet.group.position.set(player.position.x, player.position.y - 0.15, player.position.z);
      carpet.group.rotation.y = player.group.rotation.y;
      carpet.group.rotation.z = Math.sin(markerT * 3) * 0.05;
      carpet.group.position.y += Math.sin(markerT * 4) * 0.06;
    } else carpet.group.visible = false;
  }

  // creatures + power cooldowns
  if (world && player) { updateCreatures(dt); }
  updatePowers(dt);

  if (running && player && world) {
    // advance a climb in progress, otherwise normal movement
    if (climbTween) {
      climbTween.t += dt / climbTween.dur;
      const t = Math.min(1, climbTween.t);
      const e = t * t * (3 - 2 * t);
      player.position.lerpVectors(climbTween.from, climbTween.to, e);
      player.position.y += Math.sin(t * Math.PI) * 0.3; // slight arc
      if (t >= 1) { player.setClimbing(false); climbTween = null; }
    }
    const moving = player.update(dt, getMoveInput(), world);

    // follow camera target (tracks height so the camera rises onto rooftops)
    controls.target.lerp(tmpVecSet(player.position.x, player.position.y + 1.4, player.position.z), 0.18);

    // rooftop drying-date trays (bonus, only reachable by climbing)
    for (const it of world.roofItems) {
      if (it.taken) continue;
      const dx = it.pos.x - player.position.x, dz = it.pos.z - player.position.z;
      if (dx * dx + dz * dz < 2.0 * 2.0 && Math.abs(player.position.y - it.pos.y) < 1.8) {
        it.taken = true; it.mesh.visible = false; dateCount += 3;
        $('hudDates').textContent = dateCount;
        chime(); toast('+3 تمر مجفّف  🌴');
      }
    }

    // raise heritage banners on the rooftops (the climbing goal)
    for (const b of world.banners) {
      if (b.raised) continue;
      const dx = b.pos.x - player.position.x, dz = b.pos.z - player.position.z;
      if (dx * dx + dz * dz < 3.2 * 3.2 && Math.abs(player.position.y - b.pos.y) < 2.2) {
        b.raised = true; b.raiseAnim = 0; bannersRaised++;
        $('hudBanners').textContent = bannersRaised + ' / ' + totalBanners;
        fanfare(); toast('🏴 رفعت الراية! Banner raised');
        checkWin();
      }
    }
    updateClimbPrompt();

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
        checkWin();
      }
    }
    updateCompass();
  }

  controls.update();
  renderer.render(scene, camera);
}

const _v = new THREE.Vector3();
function tmpVecSet(x, y, z) { return _v.set(x, y, z); }

let won = false;
function checkWin() {
  if (won) return;
  if (found === total && bannersRaised === totalBanners) { won = true; setTimeout(showWin, 700); }
}

function updateClimbPrompt() {
  const el = $('climbPrompt'); if (!el) return;
  const near = !player.climbing && !climbTween && nearestLadder();
  if (near) {
    el.classList.add('show');
    el.textContent = player.position.y > 1 ? '⤓  Space — climb down · انزل' : '⤒  Space — climb up · اصعد';
  } else el.classList.remove('show');
}

// build a simple flapping falcon
function makeFalcon() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), dark); body.scale.set(1.8, 0.7, 0.7); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), dark); head.position.set(1.0, 0.1, 0); g.add(head);
  const wingGeo = new THREE.ConeGeometry(0.4, 2.4, 4); wingGeo.rotateZ(Math.PI / 2); wingGeo.translate(0, 0, 0);
  const wingL = new THREE.Mesh(wingGeo, dark); wingL.position.set(0, 0, 1.1); wingL.rotation.x = Math.PI / 2; g.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, dark); wingR.position.set(0, 0, -1.1); wingR.rotation.x = -Math.PI / 2; g.add(wingR);
  g.scale.setScalar(1.6);
  return { group: g, wingL, wingR };
}

// ---- flying carpet (بساط الريح) shown beneath the player while flying ----
function makeCarpet() {
  const g = new THREE.Group();
  const tex = makeCarpetTexture();
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6, 8, 6),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2; g.add(rug);
  // tassels
  const tm = new THREE.MeshStandardMaterial({ color: 0xf0d98a, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4), tm);
      t.position.set(-1.0 + i * 0.4, -0.18, s * 0.8); g.add(t);
    }
  }
  g.visible = false;
  return { group: g, rug };
}
function makeCarpetTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#9d2f2a'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#d8b24a'; x.lineWidth = 4; x.strokeRect(4, 4, 56, 56);
  x.fillStyle = '#1f7a3d'; x.fillRect(26, 26, 12, 12);
  x.strokeStyle = '#e7d4ac'; x.lineWidth = 2;
  for (let i = 12; i < 64; i += 16) { x.beginPath(); x.moveTo(i, 8); x.lineTo(i, 56); x.stroke(); }
  const t = new THREE.CanvasTexture(c); return t;
}

// ---- jinn whirlwind dust burst (dash) ----
const bursts = [];
function whirlBurst() {
  if (!player) return;
  const n = MOBILE ? 16 : 28;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = player.position.x; pos[i * 3 + 1] = player.position.y + 0.3; pos[i * 3 + 2] = player.position.z;
    const a = Math.random() * 6.28, sp = 3 + Math.random() * 5;
    vel.push([Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp]);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe8d6ad, size: 0.5, transparent: true, opacity: 0.85, depthWrite: false }));
  scene.add(pts); bursts.push({ pts, vel, life: 0 });
}

// ---- a simple cartoony villager walking the streets ----
function makeVillager() {
  const g = new THREE.Group();
  const robe = [0xeae0cf, 0xcdbfa3, 0xb9a98a, 0x8a9a7a, 0xa8b0bd][Math.floor(Math.random() * 5)];
  const m = new THREE.MeshStandardMaterial({ color: robe, roughness: 0.9, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.2, 9), m); body.position.y = 0.7; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc98e63, flatShading: true })); head.position.y = 1.5; g.add(head);
  const sc = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8, 0, 6.3, 0, 1.8), new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0xf0ece0 : 0xc23b2e, flatShading: true })); sc.position.y = 1.55; g.add(sc);
  return g;
}
// ---- goat ----
function makeGoat() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0x6b5640 : 0xe8e2d4, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), hide); body.scale.set(1.5, 0.9, 0.8); body.position.y = 0.7; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), hide); head.position.set(0.7, 0.85, 0); g.add(head);
  for (const [lx, lz] of [[0.4, 0.22], [0.4, -0.22], [-0.4, 0.22], [-0.4, -0.22]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0x3a2c1c })); leg.position.set(lx, 0.35, lz); g.add(leg);
  }
  g.scale.setScalar(0.85);
  return g;
}
// ---- jinn wisp: a glowing folklore spirit ----
function makeWisp() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x7fe3ff, emissive: 0x3aa6ff, emissiveIntensity: 1.4, transparent: true, opacity: 0.9 }));
  g.add(core);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.18, depthWrite: false }));
  g.add(halo);
  return { group: g, core };
}
// ---- the Roc (الرخ): a colossal mythical bird that crosses the sky ----
function makeRoc() {
  const f = makeFalcon();
  f.group.scale.setScalar(11);
  return f;
}

// villagers stroll between road points; goats mill near the herd centre
function updateCreatures(dt) {
  const wp = world.roadPoints;
  for (const v of villagers) {
    let dx = v.tx - v.g.position.x, dz = v.tz - v.g.position.z;
    let d = Math.hypot(dx, dz);
    if (d < 1.2 && wp.length) { const p = wp[(Math.random() * wp.length) | 0]; const o = world.findOpen(p[0], p[1]); if (o) { v.tx = o[0]; v.tz = o[1]; } }
    else {
      const nx = v.g.position.x + (dx / d) * v.speed * dt, nz = v.g.position.z + (dz / d) * v.speed * dt;
      const [rx, rz] = world.collide(nx, nz, 0.5, 0);
      v.g.position.x = rx; v.g.position.z = rz;
      v.g.rotation.y = Math.atan2(dx, dz);
      v.bob += dt * 8; v.g.position.y = Math.abs(Math.sin(v.bob)) * 0.05;
    }
  }
  for (const gt of goats) {
    let dx = gt.tx - gt.g.position.x, dz = gt.tz - gt.g.position.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.6) { gt.tx = gt.hx + (Math.random() - 0.5) * 16; gt.tz = gt.hz + (Math.random() - 0.5) * 16; }
    else {
      const nx = gt.g.position.x + (dx / d) * gt.speed * dt, nz = gt.g.position.z + (dz / d) * gt.speed * dt;
      const [rx, rz] = world.collide(nx, nz, 0.4, 0);
      gt.g.position.x = rx; gt.g.position.z = rz; gt.g.rotation.y = Math.atan2(dx, dz);
    }
  }
}

// power cooldowns + button visuals
function updatePowers(dt) {
  for (const name in POWERS) {
    const P = POWERS[name];
    if (P.t > 0) P.t = Math.max(0, P.t - dt);
    const el = $(P.btn); if (!el) continue;
    const ready = P.t <= 0;
    el.classList.toggle('cooling', !ready);
    const cd = el.querySelector('.cd');
    if (cd) cd.style.height = ready ? '0%' : Math.min(100, (P.t / P.cd) * 100) + '%';
  }
  // highlight carpet button while flying
  const cb = $('abCarpet'); if (cb) cb.classList.toggle('active', !!(player && player.flying));
}

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

  world = await loadCity(scene, './src/diriyah/', { quality: MOBILE ? 0.55 : 1 });
  total = world.landmarks.length;
  totalBanners = world.banners.length;
  $('hudMarks').textContent = '0 / ' + total;
  $('hudBanners').textContent = '0 / ' + totalBanners;

  // falcons circling over the town (falconry heritage of Najd)
  for (let i = 0; i < 4; i++) {
    const f = makeFalcon();
    Object.assign(f, {
      cx: (world.bounds.minx + world.bounds.maxx) / 2 + (Math.random() - 0.5) * 400,
      cz: (world.bounds.minz + world.bounds.maxz) / 2 + (Math.random() - 0.5) * 400,
      r: 60 + Math.random() * 120, alt: 45 + Math.random() * 35,
      a: Math.random() * 6.28, speed: 0.12 + Math.random() * 0.12, phase: Math.random() * 6.28,
    });
    scene.add(f.group); falcons.push(f);
  }

  // the Roc — a giant mythical bird on a slow high circuit
  roc = makeRoc();
  Object.assign(roc, {
    cx: (world.bounds.minx + world.bounds.maxx) / 2, cz: (world.bounds.minz + world.bounds.maxz) / 2,
    r: 520, alt: 150, a: 0, speed: 0.05, phase: 0,
  });
  scene.add(roc.group);

  // wandering villagers
  const wp = world.roadPoints;
  const nVill = MOBILE ? 4 : 7;
  for (let i = 0; i < nVill && wp.length; i++) {
    const start = world.findOpen(wp[(Math.random() * wp.length) | 0][0], wp[(Math.random() * wp.length) | 0][1]);
    if (!start) continue;
    const g = makeVillager(); g.position.set(start[0], 0, start[1]); scene.add(g);
    villagers.push({ g, tx: start[0], tz: start[1], speed: 2 + Math.random() * 1.5, bob: Math.random() * 6.28 });
  }

  // a goat herd near the wadi greenery
  const herd = world.findOpen(world.spawn[0] + 30, world.spawn[1] + 30) || [world.spawn[0], world.spawn[1]];
  const nGoat = MOBILE ? 4 : 7;
  for (let i = 0; i < nGoat; i++) {
    const g = makeGoat();
    g.position.set(herd[0] + (Math.random() - 0.5) * 14, 0, herd[1] + (Math.random() - 0.5) * 14);
    scene.add(g);
    goats.push({ g, hx: herd[0], hz: herd[1], tx: g.position.x, tz: g.position.z, speed: 1 + Math.random(), bob: Math.random() * 6.28 });
  }

  // jinn wisps haunting a few quiet alleys (folklore spirits)
  const nWisp = MOBILE ? 5 : 8;
  for (let i = 0; i < nWisp && wp.length; i++) {
    const base = wp[(Math.random() * wp.length) | 0];
    const w = makeWisp();
    w.group.position.set(base[0], 1.5 + Math.random() * 1.5, base[1]);
    Object.assign(w, { hx: base[0], hz: base[1], phase: Math.random() * 6.28 });
    scene.add(w.group); wisps.push(w);
  }

  // the flying carpet (hidden until summoned)
  carpet = makeCarpet(); scene.add(carpet.group);

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
  window.__diriyah = { scene, camera, world, player, dates, get state() { return { dateCount, found, total, bannersRaised, running, climbing: player && player.climbing }; } };

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
