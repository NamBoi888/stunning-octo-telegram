# MBTI House — بيت الشلة 🏠✨

A tiny Sims-style 3D life sim starring **the** MBTI friend group (from the
original Claude conversation), built with [Three.js](https://threejs.org/) —
no build step, no dependencies to install.

The friends live together on one lot. They get hungry, tired, bored and
lonely; they autonomously raid the fridge, nap, dance at the stereo, bounce
on the trampoline, paint, swim, and wander over to each other for
personality-true conversations in their own dialect — وليد provokes,
نامبوي ends debates in one sentence, بدر checks on everyone, and سعود
quietly brings you coffee because you looked like you needed it.

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

## The cast — الشلة

| Name | Type | Role |
|------|------|------|
| نامبوي (Namboy) | INTJ-A | المهندس المعماري والمحكّم — rarely speaks; when he does, everyone goes quiet |
| بدر (Badr) | ENFJ-T | البطل والغراء — feels everyone's mood before they speak, holds the group together |
| وليد (Waleed) | ENTP-T | المحرك والشرارة — opens a debate out of thin air, starts projects, abandons projects |
| أحمد (Ahmed) | ENFP-T | قلب دافئ خلف قناع فكري — looks analytical, runs on feelings |
| لوفاتو (Lovato) | INFJ-T | reads the room in silence, then says one sentence that lands in the heart |
| عمر (Omar) | ISFP-T | lives in the moment by day, replays every word at night — "أنا بخير... يمكن" |
| سعود (Saud) | ISFP-A | الصخرة الهادئة — won't argue, won't budge, shows love through small details |
| عبدالله (Abdullah) | INTJ-A | صديق المجموعة — outside the circle yet inside it; نامبوي's mirror |

Signature pair dynamics from the original chat are in the game too:
الشرارة والبرود (وليد × نامبوي), المختبر الفكري (أحمد × وليد),
الدفء والجليد (بدر × نامبوي), نفس الدم (عمر × سعود), المرآة
(عبدالله × نامبوي), and more — watch the speech bubbles when pairs meet.

## Customize the cast

Everything about the characters lives in **`src/characters.js`**:

- `CHARACTERS` — name, MBTI, colors, personality `traits` (which drive the
  AI: sociability, energy, playfulness, order), favorite objects, and the
  speech-bubble lines for every situation.
- `DYNAMICS` — signature two-person exchanges that play when specific
  pairs of friends chat.

Edit that one file to replace the default cast with your own friend group.
