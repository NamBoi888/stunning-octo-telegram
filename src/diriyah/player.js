// player.js — a cute, cartoony Najdi explorer in a thobe and red-checked
// ghutra. Built from primitives, with a little walk bob and turn-to-face.

import * as THREE from 'three';

export function createPlayer(scene) {
  const g = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xc98e63, roughness: 0.8, flatShading: true });
  const thobe = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.85, flatShading: true });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf3ede0, roughness: 0.9, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.9, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });

  // body / thobe (tapered)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.5, 12), thobe);
  body.position.y = 0.95; body.castShadow = true; g.add(body);

  // feet (peek out under the thobe)
  const sandal = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.9, flatShading: true });
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.42), sandal);
    foot.position.set(0.16 * s, 0.07, 0.06); foot.castShadow = true; g.add(foot);
  }

  // arms + hands
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.7, 4, 6), thobe);
    arm.position.set(0.46 * s, 1.0, 0); arm.rotation.z = 0.25 * s; arm.castShadow = true;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), skin);
    hand.position.set(0.6 * s, 0.62, 0.04); g.add(hand);
  }

  // a thin embroidered belt around the waist
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 14),
    new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.7, metalness: 0.3, flatShading: true }));
  belt.position.y = 0.78; g.add(belt);

  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 14), skin);
  head.position.y = 2.0; head.castShadow = true; g.add(head);

  // simple face (two eyes + a tiny beard)
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), dark);
    eye.position.set(0.12 * s, 2.04, 0.31); g.add(eye);
  }
  const beard = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1, flatShading: true }));
  beard.position.set(0, 1.92, 0.02); g.add(beard);

  // ghutra (white headscarf draping over the head + shoulders)
  const scarf = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth);
  scarf.position.y = 2.06; scarf.castShadow = true; g.add(scarf);
  const drape = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.6, 12, 1, true), cloth);
  drape.position.set(0, 1.78, -0.12); drape.castShadow = true; g.add(drape);
  // agal (black double ring holding the ghutra)
  const agal = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 8, 20).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 }));
  agal.position.y = 2.16; g.add(agal);

  scene.add(g);

  const SPEED = 12;            // metres / second
  const RADIUS = 0.55;         // small enough to thread the Najdi alleys
  let facing = 0;
  let bobT = 0;

  const tmp = new THREE.Vector3();

  function update(dt, input, world) {
    // input: world-space desired direction (x,z), magnitude 0..1
    let mx = input.x, mz = input.z;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    const moving = mag > 0.02;

    if (moving) {
      const nx = g.position.x + mx * SPEED * dt;
      const nz = g.position.z + mz * SPEED * dt;
      const [rx, rz] = world.collide(nx, nz, RADIUS);
      g.position.x = rx; g.position.z = rz;
      facing = Math.atan2(mx, mz);
      bobT += dt * 12;
    } else {
      bobT += dt * 2.5;
    }

    // smooth turn toward facing
    let diff = facing - g.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    g.rotation.y += diff * Math.min(1, dt * 12);

    // walk bob
    body.position.y = 0.95 + (moving ? Math.abs(Math.sin(bobT)) * 0.06 : Math.sin(bobT) * 0.015);
    g.scale.y = 1 + (moving ? Math.sin(bobT * 2) * 0.02 : 0);

    return moving;
  }

  return {
    group: g,
    position: g.position,
    update,
    radius: RADIUS,
    setSpawn(x, z) { g.position.set(x, 0, z); },
  };
}
