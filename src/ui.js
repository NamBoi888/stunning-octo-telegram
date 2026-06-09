// HTML overlay: roster chips, selected-sim panel, name tags, speech bubbles, clock.

import * as THREE from "three";

const labelLayer = document.getElementById("labels");
const panel = document.getElementById("panel");
const rosterEl = document.getElementById("roster");
const clockTime = document.querySelector("#clock .time");
const clockDay = document.querySelector("#clock .day");

const tags = new Map();    // sim -> {name: el, bubble: el|null}
const chips = new Map();   // sim -> chip el
const v = new THREE.Vector3();

export function initUI(sims, onSelect) {
  for (const sim of sims) {
    const name = document.createElement("div");
    name.className = "nametag";
    name.textContent = sim.def.name;
    labelLayer.appendChild(name);
    tags.set(sim, { name, bubble: null });

    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<div class="dot" style="background:#${sim.def.shirt.toString(16).padStart(6, "0")}"></div>
      <span class="nm">${sim.def.name}</span><span class="ty">${sim.def.mbti}</span><span class="mood"></span>`;
    chip.addEventListener("click", () => onSelect(sim));
    rosterEl.appendChild(chip);
    chips.set(sim, chip);
  }
}

export function setClock(minutes, day) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  clockTime.textContent = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  clockDay.textContent = `Day ${day}`;
}

export function updateUI(sims, selected, camera) {
  const w = window.innerWidth, h = window.innerHeight;

  for (const sim of sims) {
    const t = tags.get(sim);
    v.copy(sim.mesh.position);
    v.y += 2.6;
    v.project(camera);
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    const visible = v.z < 1;

    t.name.style.display = visible ? "block" : "none";
    t.name.style.left = `${x}px`;
    t.name.style.top = `${y}px`;

    if (sim.bubbleText) {
      if (!t.bubble) {
        t.bubble = document.createElement("div");
        t.bubble.className = "bubble";
        labelLayer.appendChild(t.bubble);
      }
      t.bubble.textContent = sim.bubbleText;
      t.bubble.style.display = visible ? "block" : "none";
      t.bubble.style.left = `${x}px`;
      t.bubble.style.top = `${y - 18}px`;
    } else if (t.bubble) {
      t.bubble.remove();
      t.bubble = null;
    }

    const chip = chips.get(sim);
    chip.classList.toggle("selected", sim === selected);
    chip.querySelector(".mood").textContent = sim.mood();
  }

  // panel
  if (!selected) {
    panel.classList.remove("open");
    return;
  }
  panel.classList.add("open");
  panel.querySelector(".portrait").style.background = `#${selected.def.shirt.toString(16).padStart(6, "0")}`;
  panel.querySelector(".portrait").textContent = selected.def.emoji;
  panel.querySelector(".name").textContent = selected.def.name;
  panel.querySelector(".mbti").textContent = selected.def.mbti + "  " + selected.mood();
  panel.querySelector(".doing").textContent = selected.doingLabel();
  const bestie = selected.bestie(sims);
  panel.querySelector(".bestie").textContent = bestie ? `Bestie: ${bestie.def.name}` : "Bestie: (making friends...)";
  for (const n of ["hunger", "energy", "fun", "social"]) {
    const fill = panel.querySelector(`.fill[data-need="${n}"]`);
    const val = selected.needs[n];
    fill.style.width = `${val}%`;
    fill.classList.toggle("low", val < 45 && val >= 22);
    fill.classList.toggle("crit", val < 22);
  }
}
