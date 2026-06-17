// map.js — builds the 3D city of Diriyah from real OpenStreetMap footprints.
// Mud-brick Najdi buildings with triangular crenellations, the Wadi Hanifah,
// palm groves, roads, and floating landmark markers. Everything is merged or
// instanced so the whole town is only a handful of draw calls.

import * as THREE from 'three';

// ---- warm desert / Najdi palette ----------------------------------------
const SAND       = 0xe6d2a4;
const SAND_DARK  = 0xd8c08a;
const ROAD       = 0xcdb285;
const PED        = 0xe9d8b0;
const WATER      = 0x47b3d6;
const GREEN      = 0x7fae54;
const WALL_TONES = [0xcaa06a, 0xd2ac76, 0xc0915d, 0xcb9c66, 0xbb8a55, 0xd6b07c];
const CRENEL     = 0xbe9259;
const PALM_BARK  = 0x7c5a32;
const PALM_LEAF  = 0x5a9e44;

// ---------- tiny geometry helpers -----------------------------------------
function mergeGeos(geos) {
  let total = 0;
  const prepped = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.color) {
      const n = ng.attributes.position.count;
      ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    total += ng.attributes.position.count;
    return ng;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of prepped) {
    const p = g.attributes.position.array;
    const nn = g.attributes.normal ? g.attributes.normal.array : null;
    const c = g.attributes.color.array;
    pos.set(p, o * 3);
    if (nn) nor.set(nn, o * 3);
    col.set(c, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Extruded prism from a footprint [[x,z],...] up to height h. Maps cleanly to
// world (x, y in [0,h], z) — note the -z in the shape so rotateX keeps z.
function prism(footprint, h) {
  const s = new THREE.Shape();
  s.moveTo(footprint[0][0], -footprint[0][1]);
  for (let i = 1; i < footprint.length; i++) s.lineTo(footprint[i][0], -footprint[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

// Flat filled polygon on the ground (y given by caller via translate).
function flatPoly(footprint) {
  const s = new THREE.Shape();
  s.moveTo(footprint[0][0], -footprint[0][1]);
  for (let i = 1; i < footprint.length; i++) s.lineTo(footprint[i][0], -footprint[i][1]);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

// A ribbon (road / wadi) from a polyline of [x,z] points with given width.
function ribbon(line, width, y) {
  const hw = width / 2;
  const verts = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    let dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const px = -dz * hw, pz = dx * hw; // perpendicular
    const v00 = [ax + px, y, az + pz], v01 = [ax - px, y, az - pz];
    const v10 = [bx + px, y, bz + pz], v11 = [bx - px, y, bz - pz];
    verts.push(...v00, ...v10, ...v11, ...v00, ...v11, ...v01);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- the build -----------------------------------------------------
export async function loadCity(scene, basePath = './src/diriyah/') {
  const data = await fetch(basePath + 'map-data.json').then((r) => r.json());

  // Ground plane covering the bounds, with a soft edge falloff color.
  const B = data.bounds;
  const w = (B.maxx - B.minx) + 400, d = (B.maxz - B.minz) + 400;
  const cx = (B.minx + B.maxx) / 2, cz = (B.minz + B.maxz) / 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: SAND, roughness: 1 })
  );
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- roads & paths ----
  const roadGeos = [], pedGeos = [];
  for (const r of data.roads) {
    if (r.l.length < 2) continue;
    const g = ribbon(r.l, r.w, 0.06);
    (r.k === 'ped' ? pedGeos : roadGeos).push(paint(g, r.k === 'ped' ? PED : ROAD));
  }
  const surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  if (roadGeos.length) { const m = new THREE.Mesh(mergeGeos(roadGeos), surfMat); m.receiveShadow = true; scene.add(m); }
  if (pedGeos.length) scene.add(new THREE.Mesh(mergeGeos(pedGeos), surfMat));

  // ---- water (Wadi Hanifah) ----
  const waterGeos = [];
  for (const wf of data.water) {
    if (wf.fill && wf.p) waterGeos.push(flatPoly(wf.p));
    else if (wf.l) waterGeos.push(ribbon(wf.l, wf.w || 12, 0.04));
  }
  if (waterGeos.length) {
    const g = mergeGeos(waterGeos);
    const mat = new THREE.MeshStandardMaterial({
      color: WATER, transparent: true, opacity: 0.86, roughness: 0.25, metalness: 0.1,
    });
    const m = new THREE.Mesh(g, mat); m.position.y = 0.05; m.renderOrder = 1; scene.add(m);
  }

  // ---- green areas + palm groves ----
  const greenGeos = []; const palmPts = [];
  for (const gr of data.green) {
    if (!gr.p || gr.p.length < 3) continue;
    greenGeos.push(paint(flatPoly(gr.p), GREEN));
    if (gr.palm) {
      // scatter palms inside the polygon
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (const p of gr.p) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
      const area = (maxx - minx) * (maxz - minz);
      const n = Math.min(60, Math.max(3, Math.floor(area / 320)));
      let tries = 0;
      for (let i = 0; i < n && tries < n * 8; ) {
        tries++;
        const px = minx + Math.random() * (maxx - minx);
        const pz = minz + Math.random() * (maxz - minz);
        if (pointInPoly(px, pz, gr.p)) { palmPts.push([px, pz]); i++; }
      }
    }
  }
  if (greenGeos.length) {
    const m = new THREE.Mesh(mergeGeos(greenGeos),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    m.position.y = 0.07; m.receiveShadow = true; scene.add(m);
  }

  // ---- buildings (merged) + crenellation teeth (instanced) ----
  const buildGeos = [];
  const colliders = [];        // AABBs for collision
  const teethMatrices = [];
  const doorMatrices = [];     // wooden doors (1 per building)
  const winMatrices = [];      // small windows
  const dummy = new THREE.Object3D();
  const landmarkBuildings = {}; // key -> {cx,cz,top}

  for (const b of data.buildings) {
    const fp = b.p; if (fp.length < 3) continue;
    const h = b.h || 4.5;
    const tone = WALL_TONES[(Math.abs(Math.round(fp[0][0])) + fp.length) % WALL_TONES.length];
    const g = paint(prism(fp, h), b.lm ? 0xd9b27e : tone); // landmarks a touch lighter/golden
    buildGeos.push(g);

    // collider + centroid
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, sx = 0, sz = 0;
    for (const p of fp) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); sx += p[0]; sz += p[1]; }
    colliders.push({ minx, maxx, minz, maxz, poly: fp });
    const ctx = sx / fp.length, ctz = sz / fp.length;
    if (b.lm) landmarkBuildings[b.lm] = { cx: ctx, cz: ctz, top: h };

    // doors + windows: walk the edges, find the longest for the door
    let longest = -1, dEdge = null;
    const edges = [];
    for (let i = 0; i < fp.length - 1; i++) {
      const [ax, az] = fp[i], [bx2, bz2] = fp[i + 1];
      let dx = bx2 - ax, dz = bz2 - az; const len = Math.hypot(dx, dz);
      if (len < 1.2) continue;
      // outward normal (away from centroid)
      let nx = -dz / len, nz = dx / len;
      const mx = (ax + bx2) / 2, mz = (az + bz2) / 2;
      if (nx * (mx - ctx) + nz * (mz - ctz) < 0) { nx = -nx; nz = -nz; }
      const ang = Math.atan2(nx, nz);
      edges.push({ ax, az, dx, dz, len, nx, nz, ang });
      if (len > longest) { longest = len; dEdge = edges[edges.length - 1]; }
    }
    if (dEdge) {
      // door at mid of longest edge, pressed to the wall, facing out
      const mx = dEdge.ax + dEdge.dx * 0.5, mz = dEdge.az + dEdge.dz * 0.5;
      dummy.position.set(mx + dEdge.nx * 0.06, 0.95, mz + dEdge.nz * 0.06);
      dummy.rotation.set(0, dEdge.ang, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      doorMatrices.push(dummy.matrix.clone());
    }
    // windows along edges (more on taller/landmark buildings)
    const rows = h > 7 ? 2 : 1;
    for (const e of edges) {
      const n = Math.floor(e.len / 3.2);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const wx = e.ax + e.dx * t, wz = e.az + e.dz * t;
        // skip windows right where the door is
        if (e === dEdge && Math.abs(t - 0.5) < 0.12) continue;
        for (let r = 0; r < rows; r++) {
          dummy.position.set(wx + e.nx * 0.05, 1.9 + r * 2.4, wz + e.nz * 0.05);
          dummy.rotation.set(0, e.ang, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          winMatrices.push(dummy.matrix.clone());
        }
      }
    }

    // crenellation teeth along the top perimeter
    const spacing = 1.8;
    for (let i = 0; i < fp.length - 1; i++) {
      const [ax, az] = fp[i], [bx, bz] = fp[i + 1];
      const dx = bx - ax, dz = bz - az; const len = Math.hypot(dx, dz);
      if (len < 0.6) continue;
      const ang = Math.atan2(dz, dx);
      const count = Math.max(1, Math.floor(len / spacing));
      for (let k = 0; k <= count; k++) {
        const t = (k + 0.5) / (count + 1);
        dummy.position.set(ax + dx * t, h + 0.35, az + dz * t);
        dummy.rotation.set(0, -ang + Math.PI / 4, 0);
        dummy.updateMatrix();
        teethMatrices.push(dummy.matrix.clone());
      }
    }
  }

  const buildMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const buildMesh = new THREE.Mesh(mergeGeos(buildGeos), buildMat);
  buildMesh.castShadow = true; buildMesh.receiveShadow = true;
  scene.add(buildMesh);

  // teeth as one InstancedMesh — little pyramids = Najdi crenellations
  if (teethMatrices.length) {
    const tg = new THREE.ConeGeometry(0.42, 0.8, 4);
    const tm = new THREE.MeshStandardMaterial({ color: CRENEL, roughness: 0.95, flatShading: true });
    const inst = new THREE.InstancedMesh(tg, tm, teethMatrices.length);
    teethMatrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true; inst.castShadow = true;
    scene.add(inst);
  }

  // carved wooden doors (with a pale frame) and small recessed windows
  function instFromMatrices(geo, mat, mats, cast) {
    if (!mats.length) return;
    const m = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.instanceMatrix.needsUpdate = true; if (cast) m.castShadow = true;
    scene.add(m);
  }
  instFromMatrices(
    new THREE.BoxGeometry(1.35, 2.1, 0.16).translate(0, 0.05, 0),
    new THREE.MeshStandardMaterial({ color: 0xe7d4ac, roughness: 1, flatShading: true }), doorMatrices, false); // pale frame
  instFromMatrices(
    new THREE.BoxGeometry(1.0, 1.8, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x6e4a26, roughness: 0.8, flatShading: true }), doorMatrices, false); // wooden door
  instFromMatrices(
    new THREE.BoxGeometry(0.7, 0.85, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.9, flatShading: true }), winMatrices, false);

  // a few palms along the streets too, for life
  for (const r of data.roads) {
    if (r.k === 'ped' || r.w < 6) continue;
    for (let i = 0; i < r.l.length - 1; i += 3) {
      if (Math.random() > 0.5) continue;
      const a = r.l[i], b2 = r.l[i + 1];
      const mx = (a[0] + b2[0]) / 2, mz = (a[1] + b2[1]) / 2;
      let dx = b2[0] - a[0], dz = b2[1] - a[1]; const len = Math.hypot(dx, dz) || 1;
      const off = r.w / 2 + 1.4;
      const side = Math.random() < 0.5 ? 1 : -1;
      const px = mx + (-dz / len) * off * side, pz = mz + (dx / len) * off * side;
      let ok = true;
      for (const c of colliders) if (px > c.minx - 1 && px < c.maxx + 1 && pz > c.minz - 1 && pz < c.maxz + 1) { ok = false; break; }
      if (ok) palmPts.push([px, pz]);
    }
  }

  // ---- date palms (instanced: trunk + drooping fronds + date bunches) ----
  if (palmPts.length) {
    const TH = 4.6; // trunk height
    // segmented trunk
    const trunk = new THREE.CylinderGeometry(0.2, 0.34, TH, 7).translate(0, TH / 2, 0);
    // fronds: blades arching out and drooping from the crown
    const blades = [];
    const nb = 11;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + Math.random() * 0.2;
      const droop = 0.55 + (i % 3) * 0.12;
      const bl = new THREE.ConeGeometry(0.26, 3.1, 4);
      bl.translate(0, 1.55, 0);
      bl.rotateX(Math.PI);            // point outward/down from base
      bl.rotateZ(Math.PI / 2 - droop); // arch
      bl.rotateY(a);
      bl.translate(0, TH + 0.2, 0);
      blades.push(bl);
    }
    const crown = new THREE.ConeGeometry(0.34, 1.1, 5).translate(0, TH + 0.55, 0);
    blades.push(crown);
    const fronds = mergeGeos(blades);
    // date bunches hanging under the crown
    const bunch = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const db = new THREE.SphereGeometry(0.3, 6, 5);
      db.scale(0.7, 1.1, 0.7);
      db.translate(Math.cos(a) * 0.55, TH - 0.35, Math.sin(a) * 0.55);
      bunch.push(db);
    }
    const dateGeo = mergeGeos(bunch);

    const trunkMesh = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: PALM_BARK, roughness: 1, flatShading: true }), palmPts.length);
    const frondMesh = new THREE.InstancedMesh(fronds, new THREE.MeshStandardMaterial({ color: PALM_LEAF, roughness: 1, flatShading: true }), palmPts.length);
    const dateMesh = new THREE.InstancedMesh(dateGeo, new THREE.MeshStandardMaterial({ color: 0xb5742c, roughness: 0.8, flatShading: true }), palmPts.length);
    palmPts.forEach((p, i) => {
      const s = 0.85 + Math.random() * 0.7;
      dummy.position.set(p[0], 0, p[1]);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(s, s * (0.95 + Math.random() * 0.2), s); dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix); frondMesh.setMatrixAt(i, dummy.matrix); dateMesh.setMatrixAt(i, dummy.matrix);
    });
    trunkMesh.castShadow = frondMesh.castShadow = true;
    scene.add(trunkMesh, frondMesh, dateMesh);
  }

  // ---- scattered desert rocks + dry tufts for ground detail ----
  const rockPts = [];
  const rspan = { x0: B.minx, x1: B.maxx, z0: B.minz, z1: B.maxz };
  for (let i = 0; i < 260; i++) {
    const x = rspan.x0 + Math.random() * (rspan.x1 - rspan.x0);
    const z = rspan.z0 + Math.random() * (rspan.z1 - rspan.z0);
    let ok = true;
    for (const c of colliders) if (x > c.minx && x < c.maxx && z > c.minz && z < c.maxz) { ok = false; break; }
    if (ok) rockPts.push([x, z]);
  }
  if (rockPts.length) {
    const rg = new THREE.DodecahedronGeometry(0.5, 0);
    const rmesh = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0xb09064, roughness: 1, flatShading: true }), rockPts.length);
    rockPts.forEach((p, i) => {
      const s = 0.25 + Math.random() * 0.7;
      dummy.position.set(p[0], s * 0.3, p[1]);
      dummy.rotation.set(Math.random(), Math.random() * 6, Math.random());
      dummy.scale.set(s, s * 0.6, s); dummy.updateMatrix();
      rmesh.setMatrixAt(i, dummy.matrix);
    });
    rmesh.castShadow = true; scene.add(rmesh);
  }

  // ---- cultural majlis prop: a rug, cushions and a brass dallah (قهوة) ----
  const isOpen = (x, z, clear) => {
    for (const c of colliders) if (x > c.minx - clear && x < c.maxx + clear && z > c.minz - clear && z < c.maxz + clear) return false;
    return true;
  };
  const findOpen = (x, z) => {
    for (let r = 4; r < 46; r += 3) for (let a = 0; a < 10; a++) {
      const px = x + Math.cos(a / 10 * 6.283) * r, pz = z + Math.sin(a / 10 * 6.283) * r;
      if (isOpen(px, pz, 1.6)) return [px, pz];
    }
    return null;
  };
  function makeMajlis() {
    const m = new THREE.Group();
    const rugMat = new THREE.MeshStandardMaterial({ color: 0x9d2f2a, roughness: 1, flatShading: true });
    const rugBorder = new THREE.MeshStandardMaterial({ color: 0xd8b24a, roughness: 1, flatShading: true });
    const rugUnder = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 2.4), rugBorder); rugUnder.position.y = 0.04; m.add(rugUnder);
    const rugTop = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 2.0), rugMat); rugTop.position.y = 0.06; m.add(rugTop);
    // cushions
    const cushMat = new THREE.MeshStandardMaterial({ color: 0x315a3a, roughness: 1, flatShading: true });
    for (const [cx, cz] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.7]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.5), cushMat);
      c.position.set(cx, 0.22, cz); c.castShadow = true; m.add(c);
    }
    // brass dallah (coffee pot)
    const brass = new THREE.MeshStandardMaterial({ color: 0xc89a3c, roughness: 0.4, metalness: 0.6, flatShading: true });
    const pot = new THREE.Group();
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.34, 10), brass); belly.position.y = 0.17; pot.add(belly);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.22, 10), brass); neck.position.y = 0.42; pot.add(neck);
    const lid = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.18, 10), brass); lid.position.y = 0.6; pot.add(lid);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), brass); finial.position.y = 0.71; pot.add(finial);
    const spout = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 6), brass); spout.position.set(0.2, 0.5, 0); spout.rotation.z = -0.9; pot.add(spout);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 10), brass); handle.position.set(-0.18, 0.42, 0); handle.rotation.y = Math.PI / 2; pot.add(handle);
    pot.position.set(0, 0.1, 0); pot.traverse((o) => o.castShadow = true); m.add(pot);
    // little cups
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xf3ece0, roughness: 0.9 });
    for (const [cx, cz] of [[0.5, 0.3], [0.75, 0.1]]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.08, 8), cupMat);
      cup.position.set(cx, 0.14, cz); m.add(cup);
    }
    return m;
  }

  // ---- landmark markers (floating, pulsing beacons) ----
  const markers = [];
  const landmarks = [];
  for (const lm of data.landmarks) {
    const lb = landmarkBuildings[lm.key];
    const pos = lb ? [lb.cx, lb.cz] : lm.at;
    const top = (lb ? lb.top : 9) + 4;
    const group = new THREE.Group();
    group.position.set(pos[0], 0, pos[1]);

    // glowing beam ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.18, 8, 24).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd66b })
    );
    ring.position.y = 0.2; group.add(ring);
    // floating diamond beacon
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.0),
      new THREE.MeshStandardMaterial({ color: 0xffce5a, emissive: 0xb8801f, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.4 })
    );
    gem.position.y = top; group.add(gem);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, top, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.25 })
    );
    beam.position.y = top / 2; group.add(beam);

    scene.add(group);

    // a welcoming majlis on open ground beside the landmark
    const spot = findOpen(pos[0], pos[1]);
    if (spot) {
      const maj = makeMajlis();
      maj.position.set(spot[0], 0, spot[1]);
      maj.rotation.y = Math.random() * Math.PI * 2;
      scene.add(maj);
    }

    markers.push({ ring, gem, beam, baseY: top });
    landmarks.push({ key: lm.key, pos: new THREE.Vector3(pos[0], 0, pos[1]), radius: 13, discovered: false });
  }

  // ---- date collectibles: scatter along roads, away from buildings ----
  const datePositions = [];
  const roadPts = [];
  for (const r of data.roads) for (const p of r.l) roadPts.push(p);
  const want = 36;
  let guard = 0;
  while (datePositions.length < want && guard < want * 40) {
    guard++;
    const base = roadPts[Math.floor(Math.random() * roadPts.length)];
    if (!base) break;
    const x = base[0] + (Math.random() - 0.5) * 6;
    const z = base[1] + (Math.random() - 0.5) * 6;
    // not inside a building
    let ok = true;
    for (const c of colliders) {
      if (x > c.minx - 1 && x < c.maxx + 1 && z > c.minz - 1 && z < c.maxz + 1) { ok = false; break; }
    }
    if (ok) datePositions.push(new THREE.Vector3(x, 0.9, z));
  }

  // ---- broadphase grid for collision ----
  const CELL = 28;
  const grid = new Map();
  const keyOf = (gx, gz) => gx + ',' + gz;
  colliders.forEach((c, idx) => {
    const gx0 = Math.floor(c.minx / CELL), gx1 = Math.floor(c.maxx / CELL);
    const gz0 = Math.floor(c.minz / CELL), gz1 = Math.floor(c.maxz / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = keyOf(gx, gz); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx);
    }
  });

  // Push a point with `radius` out of one footprint polygon. Returns the
  // corrected [x,z] if it was touching, else null. Accurate to the real walls
  // so the narrow Najdi alleys stay walkable.
  function resolvePoly(x, z, poly, radius) {
    // nearest point on the polygon boundary
    let bestD = Infinity, bx = 0, bz = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], az = poly[j][1], cx = poly[i][0], cz = poly[i][1];
      let dx = cx - ax, dz = cz - az; const len2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const dd = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dd < bestD) { bestD = dd; bx = px; bz = pz; }
    }
    bestD = Math.sqrt(bestD);
    const inside = pointInPoly(x, z, poly);
    if (!inside && bestD >= radius) return null;
    let dirx = x - bx, dirz = z - bz;
    if (inside) { dirx = -dirx; dirz = -dirz; }   // outward = toward boundary
    let l = Math.hypot(dirx, dirz);
    if (l < 1e-6) { dirx = 1; dirz = 0; l = 1; }
    dirx /= l; dirz /= l;
    return [bx + dirx * radius, bz + dirz * radius];
  }

  // resolve a moving point against nearby building footprints (a couple of
  // passes so overlapping buildings can't trap the player in a corner)
  function collide(x, z, radius) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(keyOf(gx + dx, gz + dz)); if (!arr) continue;
        for (const idx of arr) {
          const c = colliders[idx];
          if (x < c.minx - radius || x > c.maxx + radius || z < c.minz - radius || z > c.maxz + radius) continue;
          const r = resolvePoly(x, z, c.poly, radius);
          if (r) { x = r[0]; z = r[1]; moved = true; }
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  // find an open spot near a desired point (push out of any building first)
  function openSpawn(x, z) {
    const [rx, rz] = collide(x, z, 1.1);
    return [rx, rz];
  }

  function updateMarkers(t) {
    for (const m of markers) {
      m.gem.rotation.y = t * 1.2;
      m.gem.position.y = m.baseY + Math.sin(t * 2 + m.baseY) * 0.4;
      m.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
      m.ring.rotation.z = t * 0.6;
    }
  }

  const spawn = openSpawn(data.spawn[0], data.spawn[1]);

  return {
    data, bounds: B, spawn,
    colliders, collide, openSpawn, landmarks, datePositions, updateMarkers,
  };
}
