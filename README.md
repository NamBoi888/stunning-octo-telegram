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

**Easiest — one file, no server:** open **`mbti-house.html`** by
double-clicking it. Everything (the game *and* Three.js) is bundled into that
single file, so it runs straight from your hard drive with no internet and no
setup. Great for sharing — send the one file and it just works.

**Dev version (multiple files):** any static file server works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL (e.g. http://localhost:8000). Three.js is vendored
into `vendor/`, so this works offline too.

### Rebuilding the single file

`mbti-house.html` is generated from the dev sources. After editing anything
in `src/`, regenerate it with:

```bash
node build-standalone.mjs
```

## How to play

- **Click a friend** (or their roster chip, top right) to select them — a
  green plumbob appears over their head and their needs panel opens.
- **Click the ground** to send the selected friend walking there.
- **Click furniture** (fridge, beds, sofa, stereo, trampoline, pool, easel,
  bookshelf, computer, garden) to make them use it.
- **Drag** to orbit the camera, **scroll** to zoom.
- **⏸ / ▶ / ▶▶** (top left) pause or speed up time. There's a full
  day/night cycle — at night the مجلس fire pit lights up.

### Toolbar & shortcuts

- **🪔 ابدأ المجلس / Hangout** — gathers everyone onto the rug and plays a
  scripted جلسة: وليد opens a topic → أحمد flips it → نامبوي ends it in one
  line → بدر reads the room → عمر/سعود ground it → لوفاتو's closing line.
  Click again (or press **G**) to end it.
- **🎥 Follow camera** (**F**) — the camera trails the selected friend.
- **🎮 I control them** — turns off the selected friend's free will so they
  only do what *you* click. Toggle off to give them autonomy back.
- **💾 Save** / **↺ Reset day** — the house also autosaves every ~20s and
  resumes where you left off (stored in your browser).
- Keys: **1–8** pick a friend, **Space** pause/resume time.

### New objects

- **Coffee station** (سعود's domain) restores energy.
- **مجلس rug + fire pit** in the yard — the gathering circle.

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
