// ============================================================================
// THE CAST — edit this file to swap in your own MBTI friend group.
// Everything the game knows about a character lives in this one file:
// who they are, how they look, how they behave, and what they say.
//
// traits (0..1):
//   sociability — how fast Social drains & how often they seek friends
//   energy      — movement speed & how slowly Energy drains
//   playfulness — how fast Fun drains & preference for fun objects
//   order       — tidy types beeline for what they need; low-order types wander
// ============================================================================

export const CHARACTERS = [
  {
    id: "nova",
    name: "Nova",
    mbti: "ENFP",
    emoji: "✨",
    shirt: 0xff7849, hair: 0xc1442e, skin: 0xf0c8a0,
    traits: { sociability: 0.95, energy: 0.85, playfulness: 0.95, order: 0.15 },
    favorites: ["stereo", "sofa", "trampoline"],
    lines: {
      greet: ["OK BUT hear me out—", "I just had the BEST idea!!", "Tell me everything. Right now.", "You won't believe what I dreamed about!"],
      idle: ["What if we just... drove somewhere?", "I'm starting seven new hobbies today.", "Does anyone else hear colors?"],
      hungry: ["Snack quest!! Who's in??", "My stomach is composing whale song."],
      tired: ["I'm not tired, I'm just... horizontal-curious.", "Five more minutes of vibes."],
      fun: ["WOOO!", "This is the best day ever (so far)!"]
    }
  },
  {
    id: "atlas",
    name: "Atlas",
    mbti: "INTJ",
    emoji: "♟️",
    shirt: 0x2f3b52, hair: 0x1c1c22, skin: 0xd8a878,
    traits: { sociability: 0.2, energy: 0.6, playfulness: 0.35, order: 0.95 },
    favorites: ["bookshelf", "desk"],
    lines: {
      greet: ["I have already accounted for this conversation.", "Speak. I have four minutes.", "Interesting. Proceed."],
      idle: ["The five-year plan is on schedule.", "Everyone here is a variable.", "Silence is also data."],
      hungry: ["Refueling. Efficiency demands it.", "Caloric intake: scheduled."],
      tired: ["Rest is a strategic resource.", "Recharging. Do not perceive me."],
      fun: ["This is... acceptable.", "I am experiencing leisure. Noted."]
    }
  },
  {
    id: "sage",
    name: "Sage",
    mbti: "INFJ",
    emoji: "🌙",
    shirt: 0x6b5ca5, hair: 0x4a3326, skin: 0xe8b88a,
    traits: { sociability: 0.55, energy: 0.5, playfulness: 0.5, order: 0.7 },
    favorites: ["bookshelf", "easel", "sofa"],
    lines: {
      greet: ["How are you, like, *actually*?", "I sensed you needed someone.", "Come, sit. Talk to me."],
      idle: ["Everyone's energy feels purple today.", "I had a feeling this would happen.", "The house has a mood, you know."],
      hungry: ["Even mystics need lunch.", "Hunger is the body's poetry."],
      tired: ["My soul needs a nap.", "I've absorbed everyone's feelings today."],
      fun: ["This is healing my inner child.", "Cherish this moment, all of you."]
    }
  },
  {
    id: "rex",
    name: "Rex",
    mbti: "ESTP",
    emoji: "🔥",
    shirt: 0xd13b3b, hair: 0x6e4a2a, skin: 0xc89066,
    traits: { sociability: 0.8, energy: 0.95, playfulness: 0.9, order: 0.25 },
    favorites: ["trampoline", "pool", "stereo"],
    lines: {
      greet: ["Yo! Bet you can't beat me to the pool.", "What's good!! Let's GO.", "You. Me. Trampoline. Now."],
      idle: ["Standing still is a scam.", "Who wants to do something slightly dangerous?", "I could totally backflip off that."],
      hungry: ["FOOD. NOW. MOVING.", "I could eat the whole fridge."],
      tired: ["Sleep is just a pit stop.", "Fine, ONE nap. A speed nap."],
      fun: ["LET'S GOOOOO!", "Again! Again!"]
    }
  },
  {
    id: "june",
    name: "June",
    mbti: "ISTJ",
    emoji: "📋",
    shirt: 0x3e7c59, hair: 0x2e2a26, skin: 0xf0c8a0,
    traits: { sociability: 0.3, energy: 0.65, playfulness: 0.3, order: 1.0 },
    favorites: ["desk", "bookshelf", "kitchen"],
    lines: {
      greet: ["You're 12 minutes late, but hello.", "Did you finish the thing? The thing.", "Hi. Please use a coaster."],
      idle: ["The chore wheel exists for a reason.", "I've alphabetized the spice rack. Again.", "Rules are just kindness with structure."],
      hungry: ["Lunch is at noon. It is noon.", "Eating on schedule keeps society intact."],
      tired: ["Bedtime is 10:30. No exceptions.", "Rest is part of the plan."],
      fun: ["This was scheduled, and it is pleasant.", "Fun, as planned."]
    }
  },
  {
    id: "ziggy",
    name: "Ziggy",
    mbti: "ENTP",
    emoji: "😏",
    shirt: 0x3fa9c9, hair: 0x8a5fb0, skin: 0xd8a878,
    traits: { sociability: 0.85, energy: 0.8, playfulness: 0.85, order: 0.2 },
    favorites: ["sofa", "stereo", "desk"],
    lines: {
      greet: ["Counterpoint: hear me out.", "Devil's advocate has entered the chat.", "I'm not arguing, I'm explaining why I'm right."],
      idle: ["Hot dogs ARE sandwiches and I'll die on this hill.", "What if money, but worse?", "I've changed my opinion twice since breakfast."],
      hungry: ["Is cereal a soup? Asking for lunch reasons.", "Debate me over nachos."],
      tired: ["Sleep is a social construct... zzz.", "I'll rest when I win the argument."],
      fun: ["Chaos is a ladder and I'm climbing it!", "10/10, would derail again."]
    }
  },
  {
    id: "dot",
    name: "Dot",
    mbti: "ISFP",
    emoji: "🎨",
    shirt: 0xf2a7c3, hair: 0xe8d28a, skin: 0xe8b88a,
    traits: { sociability: 0.45, energy: 0.55, playfulness: 0.7, order: 0.4 },
    favorites: ["easel", "pool", "garden"],
    lines: {
      greet: ["Oh hi! Look what I made.", "The light is SO good right now.", "You'd make a great painting."],
      idle: ["I rearranged my feelings into a collage.", "*quietly vibing*", "What color is Tuesday, do you think?"],
      hungry: ["Food is just edible art.", "Plating matters more than people admit."],
      tired: ["Nap time is self-care.", "The couch is calling my name softly."],
      fun: ["My heart is full.", "This moment? A masterpiece."]
    }
  },
  {
    id: "mara",
    name: "Mara",
    mbti: "ESFJ",
    emoji: "🧁",
    shirt: 0xf2c84b, hair: 0x7a4a1e, skin: 0xc89066,
    traits: { sociability: 1.0, energy: 0.7, playfulness: 0.6, order: 0.8 },
    favorites: ["kitchen", "sofa", "garden"],
    lines: {
      greet: ["Sweetie!! Have you eaten today?", "Group hug. Non-negotiable.", "I made muffins. You're having one."],
      idle: ["Is everyone hydrated? Blink twice.", "Family dinner tonight. Attendance mandatory ❤️", "I just love us so much."],
      hungry: ["Cooking for everyone, obviously.", "A meal shared is a meal doubled!"],
      tired: ["Mom friend needs a recharge too.", "Just resting my eyes... and my heart."],
      fun: ["Memories!! We're making memories!!", "Scrapbook moment, everyone hold still!"]
    }
  }
];

// Special relationship dynamics — when these two chat, sometimes
// their signature exchange plays instead of generic small talk.
export const DYNAMICS = [
  { a: "nova", b: "atlas", lines: [
    ["What if we threw a SURPRISE party for nobody?!", "I will pretend, for both our sakes, that I did not hear that."],
    ["Atlas! Blink if you're having fun!", "My fun is internal. And scheduled."]
  ]},
  { a: "ziggy", b: "june", lines: [
    ["Rules are just suggestions with good PR.", "Rules are why you're alive, Ziggy."],
    ["I unalphabetized the spice rack. For science.", "You are a hazard and I am logging this incident."]
  ]},
  { a: "rex", b: "sage", lines: [
    ["Sage! Energy check: am I red or EXTRA red?", "You are a sunrise that learned to run, Rex."],
    ["Race you to the fridge!", "I'll walk. The fridge isn't going anywhere... probably."]
  ]},
  { a: "mara", b: "dot", lines: [
    ["Dot, honey, your art deserves a gallery.", "It's just the fridge door... but thank you 🥹"],
    ["Eat something while you paint, sweetie!", "Muffin in one hand, brush in the other. Balance."]
  ]},
  { a: "nova", b: "ziggy", lines: [
    ["New idea: backwards day!!", "Counterpoint: sideways day."],
    ["We should start a band!", "We should start a RIVAL band and beef with ourselves."]
  ]},
  { a: "atlas", b: "june", lines: [
    ["Your spreadsheet had an error in cell C7.", "...I will fix it. Thank you. This is friendship."],
    ["The house runs at 94% efficiency.", "We can do better. Meeting at 9."]
  ]}
];
