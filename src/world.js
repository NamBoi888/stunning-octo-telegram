// Builds the lot: floor, low "dollhouse" walls, furniture, yard.
// Every interactable object registers itself with a stand-point (where a sim
// stands to use it), the need it restores, and an animation hint.

import * as THREE from "three";

export const OBJECTS = []; // { id, label, mesh, stand: Vector3, faces: Vector3, need, rate, anim, capacity, users }

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
}

function box(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function register(id, label, mesh, standX, standZ, faceX, faceZ, need, rate, anim, capacity = 1) {
  OBJECTS.push({
    id, label, mesh,
    stand: new THREE.Vector3(standX, 0, standZ),
    faces: new THREE.Vector3(faceX, 0, faceZ),
    need, rate, anim, capacity, users: 0
  });
  mesh.userData.objectId = id;
  mesh.traverse(c => { c.userData.objectId = id; });
}

export function buildWorld(scene) {
  // ---- ground & lot ----
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 64), mat(0x6fae5c));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  grass.userData.ground = true;
  scene.add(grass);

  // house floor slab (open plan, 28 x 18, centered slightly north)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.2, 18), mat(0xcbb091));
  floor.position.set(0, 0.1, -4);
  floor.receiveShadow = true;
  floor.userData.ground = true;
  scene.add(floor);

  // low dollhouse walls so the camera always sees inside
  const wallColor = 0xf2ead8;
  const walls = new THREE.Group();
  const W = 1.1; // wall height
  // back wall
  box(28, W, 0.3, wallColor, 0, W / 2, -13, walls);
  // front wall with a wide door gap
  box(10, W, 0.3, wallColor, -9, W / 2, 5, walls);
  box(10, W, 0.3, wallColor, 9, W / 2, 5, walls);
  // side walls
  box(0.3, W, 18, wallColor, -14, W / 2, -4, walls);
  box(0.3, W, 18, wallColor, 14, W / 2, -4, walls);
  // interior divider: bedroom nook (right side) with gap
  box(0.3, W, 7, wallColor, 5, W / 2, -9.5, walls);
  walls.position.y = 0.2;
  scene.add(walls);

  // ============================ KITCHEN (left back) ============================
  const fridge = new THREE.Group();
  box(1.4, 2.4, 1.2, 0xd9dde4, 0, 1.2, 0, fridge);
  box(1.2, 0.05, 0.05, 0x9aa1ad, 0, 1.5, 0.62, fridge); // handle
  fridge.position.set(-13, 0.2, -12);
  scene.add(fridge);
  register("fridge", "Fridge", fridge, -12.6, -10.6, -13, -12, "hunger", 55, "stand");

  const counter = new THREE.Group();
  box(5, 1, 1.2, 0xb9926b, 0, 0.5, 0, counter);
  box(5, 0.1, 1.3, 0xe8e2d4, 0, 1.05, 0, counter);
  counter.position.set(-9.5, 0.2, -12.2);
  scene.add(counter);
  register("kitchen", "Stove", counter, -9.5, -10.8, -9.5, -12.2, "hunger", 45, "stand");

  // dining table + 4 chairs
  const dining = new THREE.Group();
  box(3.4, 0.15, 2, 0x8a5a33, 0, 1.0, 0, dining);
  box(0.2, 1, 0.2, 0x6e4626, -1.4, 0.5, -0.7, dining);
  box(0.2, 1, 0.2, 0x6e4626, 1.4, 0.5, -0.7, dining);
  box(0.2, 1, 0.2, 0x6e4626, -1.4, 0.5, 0.7, dining);
  box(0.2, 1, 0.2, 0x6e4626, 1.4, 0.5, 0.7, dining);
  dining.position.set(-9, 0.2, -7.5);
  scene.add(dining);

  // ============================ LIVING ROOM (center) ============================
  const sofa = new THREE.Group();
  box(4.4, 0.7, 1.4, 0x5a6fb8, 0, 0.35, 0, sofa);
  box(4.4, 0.8, 0.35, 0x4d5fa0, 0, 0.9, -0.55, sofa); // backrest
  box(0.4, 0.9, 1.4, 0x4d5fa0, -2.0, 0.55, 0, sofa);
  box(0.4, 0.9, 1.4, 0x4d5fa0, 2.0, 0.55, 0, sofa);
  sofa.position.set(0, 0.2, -3);
  scene.add(sofa);
  register("sofa", "Sofa", sofa, 0, -2.2, 0, -7, "fun", 28, "sit", 3);

  const tv = new THREE.Group();
  box(3, 1.7, 0.18, 0x14161c, 0, 1.5, 0, tv);
  box(3.4, 0.6, 0.8, 0x5a4632, 0, 0.3, 0, tv); // stand
  tv.position.set(0, 0.2, -7.2);
  scene.add(tv);

  const bookshelf = new THREE.Group();
  box(2.4, 2.6, 0.7, 0x7a5230, 0, 1.3, 0, bookshelf);
  for (let i = 0; i < 3; i++) {
    box(2.0, 0.45, 0.5, [0xc94f4f, 0x4f86c9, 0x67b06a][i], 0, 0.65 + i * 0.7, 0.12, bookshelf);
  }
  bookshelf.position.set(-5.5, 0.2, -12.3);
  scene.add(bookshelf);
  register("bookshelf", "Bookshelf", bookshelf, -5.5, -10.9, -5.5, -12.3, "fun", 22, "stand");

  const stereo = new THREE.Group();
  box(1.1, 1.5, 0.8, 0x23262e, 0, 0.75, 0, stereo);
  box(0.7, 0.7, 0.05, 0x3fa9c9, 0, 0.9, 0.42, stereo); // speaker glow
  stereo.position.set(-13.2, 0.2, -1);
  scene.add(stereo);
  register("stereo", "Stereo", stereo, -11.8, -1, -13.2, -1, "fun", 34, "dance", 4);

  const desk = new THREE.Group();
  box(2.6, 0.12, 1.2, 0x8a5a33, 0, 1.0, 0, desk);
  box(0.15, 1, 0.15, 0x6e4626, -1.1, 0.5, -0.4, desk);
  box(0.15, 1, 0.15, 0x6e4626, 1.1, 0.5, -0.4, desk);
  box(0.15, 1, 0.15, 0x6e4626, -1.1, 0.5, 0.4, desk);
  box(0.15, 1, 0.15, 0x6e4626, 1.1, 0.5, 0.4, desk);
  box(1.2, 0.8, 0.08, 0x1c1f27, 0, 1.5, -0.3, desk); // monitor
  desk.position.set(12.2, 0.2, -1.5);
  desk.rotation.y = -Math.PI / 2;
  scene.add(desk);
  register("desk", "Computer", desk, 10.8, -1.5, 12.2, -1.5, "fun", 26, "stand");

  // ============================ BEDROOM NOOK (right back) ============================
  const bedColors = [0xc94f6d, 0x4f86c9, 0x67b06a, 0xc9a23f];
  for (let i = 0; i < 4; i++) {
    const bed = new THREE.Group();
    box(1.5, 0.45, 3, 0x9c7448, 0, 0.25, 0, bed); // frame
    box(1.4, 0.25, 2.9, 0xf2efe6, 0, 0.55, 0, bed); // mattress
    box(1.4, 0.18, 1.7, bedColors[i], 0, 0.68, 0.55, bed); // blanket
    box(1.1, 0.18, 0.6, 0xffffff, 0, 0.68, -1.0, bed); // pillow
    const x = 7 + i * 1.9;
    bed.position.set(x, 0.2, -11.3);
    scene.add(bed);
    register("bed" + i, "Bed", bed, x, -8.9, x, -11.3, "energy", 30, "sleep");
  }

  // ============================ YARD ============================
  // pool (front right)
  const poolFrame = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 6), mat(0xd8d3c5));
  poolFrame.position.set(12, 0.05, 12);
  poolFrame.receiveShadow = true;
  scene.add(poolFrame);
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 0.4, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x3fb6d9, roughness: 0.25, transparent: true, opacity: 0.85 })
  );
  water.position.set(12, 0.18, 12);
  scene.add(water);
  const poolGroup = new THREE.Group();
  poolGroup.add(poolFrame); poolGroup.add(water);
  scene.add(poolGroup);
  register("pool", "Pool", poolGroup, 7, 12, 12, 12, "fun", 36, "stand", 3);

  // trampoline (front left)
  const tramp = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.18, 10, 28), mat(0x2f6fb0));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.8;
  ring.castShadow = true;
  tramp.add(ring);
  const tarp = new THREE.Mesh(new THREE.CircleGeometry(1.9, 28), mat(0x1c1f27, { side: THREE.DoubleSide }));
  tarp.rotation.x = -Math.PI / 2;
  tarp.position.y = 0.78;
  tramp.add(tarp);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    box(0.15, 0.8, 0.15, 0x44484f, Math.cos(a) * 1.8, 0.4, Math.sin(a) * 1.8, tramp);
  }
  tramp.position.set(-11, 0, 11);
  scene.add(tramp);
  register("trampoline", "Trampoline", tramp, -11, 11, -11, 11, "fun", 40, "bounce", 2);

  // easel (side yard)
  const easel = new THREE.Group();
  box(1.4, 1.8, 0.08, 0xf6f3ea, 0, 1.5, 0, easel); // canvas
  box(0.1, 2.4, 0.1, 0x8a5a33, -0.55, 1.2, 0.15, easel);
  box(0.1, 2.4, 0.1, 0x8a5a33, 0.55, 1.2, 0.15, easel);
  box(0.1, 2.4, 0.1, 0x8a5a33, 0, 1.2, -0.35, easel);
  box(0.9, 0.6, 0.02, 0xf2a7c3, 0, 1.6, 0.05, easel); // painted blob
  easel.position.set(-16.5, 0, 2);
  easel.rotation.y = Math.PI / 3;
  scene.add(easel);
  register("easel", "Easel", easel, -15.4, 3, -16.5, 2, "fun", 30, "stand");

  // garden patch
  const garden = new THREE.Group();
  box(4, 0.3, 2.2, 0x6e4a2a, 0, 0.15, 0, garden);
  for (let i = 0; i < 5; i++) {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), mat([0xd13b6b, 0xe8b84b, 0xc9603f, 0xb04fc9, 0x4f86c9][i]));
    bush.position.set(-1.5 + i * 0.75, 0.5, 0);
    bush.castShadow = true;
    garden.add(bush);
  }
  garden.position.set(17, 0, 2);
  scene.add(garden);
  register("garden", "Garden", garden, 17, 3.6, 17, 2, "fun", 20, "stand", 2);

  // trees around the lot
  const treeSpots = [[-22, -14], [22, -16], [-24, 8], [24, 16], [-18, 18], [4, 20], [20, -6]];
  for (const [tx, tz] of treeSpots) {
    const tree = new THREE.Group();
    box(0.5, 2.2, 0.5, 0x7a5230, 0, 1.1, 0, tree);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), mat(0x4e8c45));
    crown.position.y = 3;
    crown.castShadow = true;
    tree.add(crown);
    tree.position.set(tx, 0, tz);
    scene.add(tree);
  }

  // coffee station (سعود's domain) — by the kitchen
  const coffee = new THREE.Group();
  box(1.6, 1.0, 0.9, 0x6e4626, 0, 0.5, 0, coffee);        // cabinet
  box(1.6, 0.08, 1.0, 0x2a2a2e, 0, 1.04, 0, coffee);       // top
  box(0.5, 0.55, 0.4, 0xb0b4bb, -0.4, 1.3, 0, coffee);     // machine body
  box(0.18, 0.28, 0.18, 0x1c1f27, -0.4, 1.0, 0.25, coffee); // dispenser
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.32, 12), mat(0xd4a24a));
  pot.position.set(0.4, 1.2, 0);
  coffee.add(pot);
  coffee.position.set(-5.5, 0.2, -7.5);
  scene.add(coffee);
  register("coffee", "Coffee", coffee, -5.5, -6.1, -5.5, -7.5, "energy", 24, "stand", 2);

  // majlis rug + floor cushions (the gathering circle) — center yard
  const majlisCenter = new THREE.Vector3(0, 0, 16);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(4.2, 32), mat(0x9c3b3b));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(majlisCenter.x, 0.02, majlisCenter.z);
  rug.receiveShadow = true;
  scene.add(rug);
  const rugTrim = new THREE.Mesh(new THREE.RingGeometry(3.7, 4.2, 32), mat(0xe8c86a, { side: THREE.DoubleSide }));
  rugTrim.rotation.x = -Math.PI / 2;
  rugTrim.position.set(majlisCenter.x, 0.03, majlisCenter.z);
  scene.add(rugTrim);

  const majlisSeats = [];
  const cushionColors = [0x4f86c9, 0xd9a13b, 0x67b06a, 0xb04fc9, 0xd13b6b, 0x3fb6d9, 0xe07a3f, 0x8a7fc9];
  const seatCount = 8;
  for (let i = 0; i < seatCount; i++) {
    const a = (i / seatCount) * Math.PI * 2;
    const r = 3.0;
    const cx = majlisCenter.x + Math.cos(a) * r;
    const cz = majlisCenter.z + Math.sin(a) * r;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.28, 1.0), mat(cushionColors[i % cushionColors.length]));
    cushion.position.set(cx, 0.16, cz);
    cushion.castShadow = cushion.receiveShadow = true;
    scene.add(cushion);
    majlisSeats.push(new THREE.Vector3(cx, 0, cz));
  }

  // fire pit in the middle of the majlis — glows at night
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.4, 14), mat(0x3a3a3e));
  pit.position.set(majlisCenter.x, 0.2, majlisCenter.z);
  pit.castShadow = true;
  scene.add(pit);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 1.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff5a1a, emissiveIntensity: 1.4, roughness: 0.4 })
  );
  flame.position.set(majlisCenter.x, 0.95, majlisCenter.z);
  scene.add(flame);
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 14, 2);
  fireLight.position.set(majlisCenter.x, 1.4, majlisCenter.z);
  scene.add(fireLight);

  // path from door to street
  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 9), mat(0xc9bda4));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, 9);
  path.receiveShadow = true;
  path.userData.ground = true;
  scene.add(path);

  return { majlisCenter, majlisSeats, flame, fireLight };
}

export function findObject(id) {
  return OBJECTS.find(o => o.id === id);
}

// Pick the best object that restores `need`, preferring this sim's favorites.
export function bestObjectFor(need, favoriteIds) {
  const candidates = OBJECTS.filter(o => o.need === need && o.users < o.capacity);
  if (!candidates.length) return null;
  const fav = candidates.filter(o => favoriteIds.includes(o.id));
  const pool = fav.length ? fav : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}
