// A Sim: blocky body, needs, and a tiny utility-AI brain.

import * as THREE from "three";
import { bestObjectFor, findObject } from "./world.js";
import { DYNAMICS } from "./characters.js";

const NEEDS = ["hunger", "energy", "fun", "social"];

// per game-hour decay baselines
const DECAY = { hunger: 4.5, energy: 3.2, fun: 5.0, social: 4.2 };

function buildBody(def) {
  const g = new THREE.Group();
  const matOf = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.3), matOf(0x33415c));
  const legR = legL.clone();
  legL.position.set(-0.18, 0.35, 0);
  legR.position.set(0.18, 0.35, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.85, 0.45), matOf(def.shirt));
  torso.position.y = 1.12;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.25), matOf(def.shirt));
  const armR = armL.clone();
  armL.position.set(-0.52, 1.12, 0);
  armR.position.set(0.52, 1.12, 0);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), matOf(def.skin));
  head.position.y = 1.86;

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.6), matOf(def.hair));
  hair.position.y = 2.16;

  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.02), matOf(0x16181f));
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.13, 1.9, 0.285);
  eyeR.position.set(0.13, 1.9, 0.285);

  for (const part of [legL, legR, torso, armL, armR, head, hair, eyeL, eyeR]) {
    part.castShadow = true;
    g.add(part);
  }
  g.userData.parts = { legL, legR, armL, armR, head, hair };
  return g;
}

export class Sim {
  constructor(def, scene, spawn) {
    this.def = def;
    this.id = def.id;
    this.needs = { hunger: 60 + Math.random() * 30, energy: 60 + Math.random() * 30, fun: 50 + Math.random() * 40, social: 50 + Math.random() * 40 };
    this.relationships = {}; // simId -> score

    this.mesh = buildBody(def);
    this.mesh.position.copy(spawn);
    this.mesh.userData.simId = def.id;
    this.mesh.traverse(c => { c.userData.simId = def.id; });
    scene.add(this.mesh);

    this.state = "idle";      // idle | walking | using | chatting
    this.target = null;        // Vector3 to walk to
    this.afterWalk = null;     // () => void when arrived
    this.using = null;         // object record from world
    this.actionTimer = 0;      // game-minutes left in current action
    this.idleTimer = 2 + Math.random() * 4;
    this.chatPartner = null;
    this.bubbleText = null;
    this.bubbleTimer = 0;
    this.walkPhase = Math.random() * 10;
    this.speed = 2.2 + this.def.traits.energy * 1.6; // units/sec
  }

  say(category) {
    const pool = this.def.lines[category] || this.def.lines.idle;
    this.sayText(pool[Math.floor(Math.random() * pool.length)]);
  }

  sayText(text) {
    this.bubbleText = text;
    this.bubbleTimer = 3.5;
  }

  mood() {
    const avg = NEEDS.reduce((s, n) => s + this.needs[n], 0) / NEEDS.length;
    if (avg > 70) return "😄";
    if (avg > 50) return "🙂";
    if (avg > 32) return "😕";
    return "😫";
  }

  doingLabel() {
    if (this.state === "walking") return "Walking...";
    if (this.state === "chatting") return `Chatting with ${this.chatPartner ? this.chatPartner.def.name : "a friend"}`;
    if (this.state === "using" && this.using) {
      const verbs = { sleep: "Sleeping in", sit: "Lounging on", dance: "Dancing at", bounce: "Bouncing on", stand: "Using" };
      return `${verbs[this.using.anim] || "Using"} the ${this.using.label}`;
    }
    return "Hanging out";
  }

  bestie(sims) {
    let top = null, score = 4; // require some minimum
    for (const s of sims) {
      if (s === this) continue;
      const v = this.relationships[s.id] || 0;
      if (v > score) { score = v; top = s; }
    }
    return top;
  }

  // ---- commands from the player ----
  commandMove(point) {
    this.releaseObject();
    this.breakChat();
    this.target = point.clone();
    this.afterWalk = null;
    this.state = "walking";
  }

  commandUse(obj) {
    if (obj.users >= obj.capacity) { this.sayText(`The ${obj.label.toLowerCase()} is taken!`); return; }
    this.releaseObject();
    this.breakChat();
    this.goUse(obj);
  }

  // ---- internals ----
  releaseObject() {
    if (this.using) { this.using.users--; this.using = null; }
    this.mesh.rotation.x = 0;
    this.mesh.position.y = 0;
  }

  breakChat() {
    if (this.chatPartner) {
      const p = this.chatPartner;
      this.chatPartner = null;
      if (p.chatPartner === this) { p.chatPartner = null; p.state = "idle"; p.idleTimer = 1; }
    }
  }

  goUse(obj) {
    obj.users++;
    this.using = obj;
    this.target = obj.stand.clone();
    this.state = "walking";
    this.afterWalk = () => {
      this.state = "using";
      this.actionTimer = obj.anim === "sleep" ? 999 : 45 + Math.random() * 40; // game-minutes
      const look = new THREE.Vector3().subVectors(obj.faces, this.mesh.position);
      if (look.lengthSq() > 0.001) this.mesh.rotation.y = Math.atan2(look.x, look.z);
      if (Math.random() < 0.6) this.say(obj.need === "hunger" ? "hungry" : obj.anim === "sleep" ? "tired" : "fun");
    };
  }

  goChat(partner) {
    this.state = "walking";
    this.target = partner.mesh.position.clone().add(new THREE.Vector3(0.9, 0, 0.4));
    this.afterWalk = () => {
      if (partner.state === "using" || partner.chatPartner) { this.state = "idle"; this.idleTimer = 2; return; }
      partner.breakChat();
      this.chatPartner = partner;
      partner.chatPartner = this;
      this.state = "chatting";
      partner.state = "chatting";
      this.actionTimer = 30 + Math.random() * 30;
      partner.actionTimer = this.actionTimer;
      // face each other
      const d = new THREE.Vector3().subVectors(partner.mesh.position, this.mesh.position);
      this.mesh.rotation.y = Math.atan2(d.x, d.z);
      partner.mesh.rotation.y = Math.atan2(-d.x, -d.z);
      // dialogue: signature dynamic if one exists, else greet/reply
      const dyn = DYNAMICS.find(x => (x.a === this.id && x.b === partner.id) || (x.a === partner.id && x.b === this.id));
      if (dyn && Math.random() < 0.65) {
        const [first, second] = dyn.lines[Math.floor(Math.random() * dyn.lines.length)];
        const firstSpeaker = dyn.a === this.id ? this : partner;
        const secondSpeaker = firstSpeaker === this ? partner : this;
        firstSpeaker.sayText(first);
        setTimeout(() => { if (secondSpeaker.state === "chatting") secondSpeaker.sayText(second); }, 2600);
      } else {
        this.say("greet");
        setTimeout(() => { if (partner.state === "chatting") partner.say("idle"); }, 2400);
      }
    };
  }

  chooseAction(sims) {
    const t = this.def.traits;
    // urgency per need, weighted by personality
    const weights = {
      hunger: (100 - this.needs.hunger),
      energy: (100 - this.needs.energy) * (1.1 - t.energy * 0.4),
      fun: (100 - this.needs.fun) * (0.7 + t.playfulness * 0.6),
      social: (100 - this.needs.social) * (0.5 + t.sociability * 0.9)
    };
    let need = NEEDS[0];
    for (const n of NEEDS) if (weights[n] > weights[need]) need = n;

    // low-order types sometimes ignore the plan and wander
    if (weights[need] < 35 || (Math.random() > t.order && weights[need] < 55)) {
      // wander somewhere on the lot
      this.target = new THREE.Vector3((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 30);
      this.state = "walking";
      this.afterWalk = null;
      if (Math.random() < 0.25) this.say("idle");
      return;
    }

    if (need === "social") {
      const others = sims.filter(s => s !== this && !s.chatPartner && s.state !== "using");
      if (others.length) {
        // prefer the friend they like most
        others.sort((a, b) => (this.relationships[b.id] || 0) - (this.relationships[a.id] || 0));
        const partner = Math.random() < 0.7 ? others[0] : others[Math.floor(Math.random() * others.length)];
        this.goChat(partner);
        return;
      }
      need = "fun"; // nobody free — entertain yourself
    }

    const obj = bestObjectFor(need, this.def.favorites);
    if (obj) this.goUse(obj);
    else { this.state = "idle"; this.idleTimer = 3; }
  }

  update(dtReal, gameMinutes, sims) {
    // ---- needs decay ----
    const h = gameMinutes / 60;
    const t = this.def.traits;
    if (!(this.state === "using" && this.using?.anim === "sleep")) {
      this.needs.energy = Math.max(0, this.needs.energy - DECAY.energy * (1.2 - t.energy * 0.5) * h);
    }
    this.needs.hunger = Math.max(0, this.needs.hunger - DECAY.hunger * h);
    this.needs.fun = Math.max(0, this.needs.fun - DECAY.fun * (0.6 + t.playfulness * 0.7) * h);
    if (this.state !== "chatting") {
      this.needs.social = Math.max(0, this.needs.social - DECAY.social * (0.5 + t.sociability * 0.8) * h);
    }

    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dtReal;
      if (this.bubbleTimer <= 0) this.bubbleText = null;
    }

    const parts = this.mesh.userData.parts;

    switch (this.state) {
      case "idle": {
        this.idleTimer -= dtReal;
        this.animIdle(parts, dtReal);
        if (this.idleTimer <= 0) this.chooseAction(sims);
        break;
      }
      case "walking": {
        const d = new THREE.Vector3().subVectors(this.target, this.mesh.position);
        d.y = 0;
        const dist = d.length();
        if (dist < 0.25) {
          this.state = "idle";
          this.idleTimer = 0.5 + Math.random() * 1.5;
          this.animIdle(parts, dtReal, true);
          if (this.afterWalk) { const f = this.afterWalk; this.afterWalk = null; f(); }
        } else {
          d.normalize();
          const step = Math.min(dist, this.speed * dtReal);
          this.mesh.position.addScaledVector(d, step);
          const targetRot = Math.atan2(d.x, d.z);
          let dr = targetRot - this.mesh.rotation.y;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          this.mesh.rotation.y += dr * Math.min(1, dtReal * 10);
          // walk cycle
          this.walkPhase += dtReal * 9;
          const s = Math.sin(this.walkPhase) * 0.5;
          parts.legL.rotation.x = s;
          parts.legR.rotation.x = -s;
          parts.armL.rotation.x = -s * 0.8;
          parts.armR.rotation.x = s * 0.8;
          this.mesh.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.05;
        }
        break;
      }
      case "using": {
        const obj = this.using;
        if (!obj) { this.state = "idle"; break; }
        this.actionTimer -= gameMinutes;
        this.needs[obj.need] = Math.min(100, this.needs[obj.need] + obj.rate * h);
        this.animUse(parts, obj, dtReal);
        const done = obj.anim === "sleep" ? this.needs.energy >= 96 : (this.actionTimer <= 0 || this.needs[obj.need] >= 98);
        if (done) {
          this.releaseObject();
          this.state = "idle";
          this.idleTimer = 1;
          if (Math.random() < 0.35) this.say("fun");
        }
        break;
      }
      case "chatting": {
        this.actionTimer -= gameMinutes;
        this.needs.social = Math.min(100, this.needs.social + 32 * h);
        this.needs.fun = Math.min(100, this.needs.fun + 8 * h);
        this.animIdle(parts, dtReal);
        if (this.chatPartner) {
          const pid = this.chatPartner.id;
          this.relationships[pid] = (this.relationships[pid] || 0) + 2.2 * h;
        }
        if (this.actionTimer <= 0 || !this.chatPartner) {
          this.breakChat();
          this.state = "idle";
          this.idleTimer = 1 + Math.random() * 2;
        }
        break;
      }
    }
  }

  animIdle(parts, dt, reset = false) {
    for (const k of ["legL", "legR", "armL", "armR"]) parts[k].rotation.x *= 0.8;
    this.mesh.position.y *= 0.8;
    this.mesh.rotation.x = 0;
  }

  animUse(parts, obj, dt) {
    this.walkPhase += dt * 8;
    switch (obj.anim) {
      case "sleep":
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.position.y = 0.95;
        break;
      case "sit":
        this.mesh.position.y = 0.45;
        parts.legL.rotation.x = parts.legR.rotation.x = -1.4;
        break;
      case "dance": {
        const s = Math.sin(this.walkPhase * 1.6);
        this.mesh.position.y = Math.abs(s) * 0.18;
        parts.armL.rotation.x = -1.2 + s * 0.6;
        parts.armR.rotation.x = -1.2 - s * 0.6;
        this.mesh.rotation.y += dt * 2.5;
        break;
      }
      case "bounce": {
        const b = Math.abs(Math.sin(this.walkPhase * 1.4));
        this.mesh.position.y = 0.85 + b * 1.4;
        parts.armL.rotation.x = parts.armR.rotation.x = -2.6 * b;
        break;
      }
      default: { // stand
        const s = Math.sin(this.walkPhase * 0.7) * 0.12;
        parts.armL.rotation.x = -0.6 + s;
        parts.armR.rotation.x = -0.6 - s;
      }
    }
  }
}
