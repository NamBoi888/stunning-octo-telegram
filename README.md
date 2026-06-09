# MBTI House 🏠✨

A tiny Sims-style 3D life sim starring an MBTI friend group, built with
[Three.js](https://threejs.org/) — no build step, no dependencies to install.

The friends live together on one lot. They get hungry, tired, bored and
lonely; they autonomously raid the fridge, nap, dance at the stereo, bounce
on the trampoline, paint, swim, and wander over to each other for
personality-flavored conversations (the ENTP *will* pick a fight with the
ISTJ about the spice rack).

## Run it

Any static file server works. From the repo root:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL (e.g. http://localhost:8000) in a browser.
Three.js loads from a CDN via an import map, so you need an internet
connection the first time.

## How to play

- **Click a friend** (or their roster chip, top right) to select them — a
  green plumbob appears over their head and their needs panel opens.
- **Click the ground** to send the selected friend walking there.
- **Click furniture** (fridge, beds, sofa, stereo, trampoline, pool, easel,
  bookshelf, computer, garden) to make them use it.
- **Drag** to orbit the camera, **scroll** to zoom.
- **⏸ / ▶ / ▶▶** (top left) pause or speed up time. There's a full
  day/night cycle.

Left alone, everyone takes care of themselves — how efficiently depends on
their personality. Watch the speech bubbles: each pair of friends with a
signature dynamic has their own running bits.

## The cast

| Name  | Type | Vibe |
|-------|------|------|
| Nova  | ENFP | chaotic spark, seven hobbies a day |
| Atlas | INTJ | has already planned this conversation |
| Sage  | INFJ | the group's resident mystic-therapist |
| Rex   | ESTP | trampoline. pool. now. |
| June  | ISTJ | the schedule IS the friendship |
| Ziggy | ENTP | devil's advocate at breakfast |
| Dot   | ISFP | quietly painting everyone |
| Mara  | ESFJ | mom friend, muffins mandatory |

## Customize the cast

Everything about the characters lives in **`src/characters.js`**:

- `CHARACTERS` — name, MBTI, colors, personality `traits` (which drive the
  AI: sociability, energy, playfulness, order), favorite objects, and the
  speech-bubble lines for every situation.
- `DYNAMICS` — signature two-person exchanges that play when specific
  pairs of friends chat.

Edit that one file to replace the default cast with your own friend group.
