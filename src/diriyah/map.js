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
  const dummy = new THREE.Object3D();
  const landmarkBuildings = {}; // key -> {cx,cz,top}

  for (const b of data.buildings) {
    const fp = b.p; if (fp.length < 3) continue;
    const h = b.h || 4.5;
    const tone = WALL_TONES[(Math.abs(Math.round(fp[0][0])) + fp.length) % WALL_TONES.length];
    const g = paint(prism(fp, h), b.lm ? 0xd9b27e : tone); // landmarks a touch lighter/golden
    buildGeos.push(g);

    // AABB collider
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, sx = 0, sz = 0;
    for (const p of fp) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); sx += p[0]; sz += p[1]; }
    colliders.push({ minx, maxx, minz, maxz });
    if (b.lm) landmarkBuildings[b.lm] = { cx: sx / fp.length, cz: sz / fp.length, top: h };

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

  // ---- palm trees (instanced) ----
  if (palmPts.length) {
    const trunk = new THREE.CylinderGeometry(0.18, 0.32, 4.2, 6).translate(0, 2.1, 0);
    const crown = new THREE.ConeGeometry(2.0, 1.4, 7).translate(0, 4.4, 0);
    const trunkMesh = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: PALM_BARK, roughness: 1, flatShading: true }), palmPts.length);
    const crownMesh = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: PALM_LEAF, roughness: 1, flatShading: true }), palmPts.length);
    palmPts.forEach((p, i) => {
      const s = 0.8 + Math.random() * 0.6;
      dummy.position.set(p[0], 0, p[1]);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(s, s, s); dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix); crownMesh.setMatrixAt(i, dummy.matrix);
    });
    trunkMesh.castShadow = crownMesh.castShadow = true;
    scene.add(trunkMesh, crownMesh);
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

  // resolve a moving point (with radius) against nearby building AABBs
  function collide(x, z, radius) {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(keyOf(gx + dx, gz + dz)); if (!arr) continue;
      for (const idx of arr) {
        const c = colliders[idx];
        const nx = Math.max(c.minx, Math.min(x, c.maxx));
        const nz = Math.max(c.minz, Math.min(z, c.maxz));
        const ddx = x - nx, ddz = z - nz;
        const dist2 = ddx * ddx + ddz * ddz;
        if (dist2 < radius * radius) {
          if (dist2 > 1e-6) { const dist = Math.sqrt(dist2); const push = radius - dist; x += (ddx / dist) * push; z += (ddz / dist) * push; }
          else { // center inside: push out on least-penetration axis
            const pl = x - c.minx, pr = c.maxx - x, pu = z - c.minz, pd = c.maxz - z;
            const m = Math.min(pl, pr, pu, pd);
            if (m === pl) x = c.minx - radius; else if (m === pr) x = c.maxx + radius;
            else if (m === pu) z = c.minz - radius; else z = c.maxz + radius;
          }
        }
      }
    }
    return [x, z];
  }

  function updateMarkers(t) {
    for (const m of markers) {
      m.gem.rotation.y = t * 1.2;
      m.gem.position.y = m.baseY + Math.sin(t * 2 + m.baseY) * 0.4;
      m.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
      m.ring.rotation.z = t * 0.6;
    }
  }

  return {
    data, bounds: B, spawn: data.spawn,
    colliders, collide, landmarks, datePositions, updateMarkers,
  };
}
