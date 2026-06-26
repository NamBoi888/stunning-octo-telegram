// culture.js — the heart of the game.
// Curated, factual cultural content about the historic At-Turaif district of
// Diriyah (الدرعية), the birthplace of the first Saudi State and a UNESCO World
// Heritage Site. Each landmark the player discovers opens a card like this.
//
// `key` matches the `lm`/landmark keys baked from OpenStreetMap in map-data.json.

export const INTRO = {
  ar: 'أهلاً بك في الدرعية',
  en: 'Welcome to Diriyah',
  body:
    'You are walking through At-Turaif (حي الطريف) — the mud-brick heart of ' +
    'old Diriyah on the banks of Wadi Hanifah, and the birthplace of the first ' +
    'Saudi State (1727). The whole town below was rebuilt from real ' +
    'OpenStreetMap data.\n\n' +
    'Explore the warm Najdi alleys, collect golden dates (تمر), and walk up to ' +
    'the glowing landmarks to uncover their stories.\n\n' +
    'Najdi families climbed palm-wood ladders to the rooftop terrace (السطح) to ' +
    'dry dates and sleep under the stars. Climb the ladders and raise the ' +
    'heritage banners (الرايات) on the high roofs to complete your journey.\n\n' +
    'And from the old tales of Arabia, three folk-powers are yours: the flying ' +
    'carpet (بساط الريح), the falcon\'s leap, and the jinn\'s whirlwind. Watch ' +
    'for jinn wisps in the alleys and the great Roc (الرخ) crossing the sky.',
  tip: 'Move: WASD / joystick · Climb: Space · Powers: F carpet · J leap · K whirlwind (or tap the buttons)',
};

export const LANDMARKS = {
  turaif: {
    icon: '🏛️',
    ar: 'حي الطريف',
    en: 'At-Turaif District',
    tag: 'UNESCO World Heritage Site',
    body:
      'At-Turaif was the royal and administrative seat of the first Saudi State. ' +
      'Built on a spur above Wadi Hanifah, its palaces, mosques and homes are ' +
      'raised entirely from sun-dried mud brick in the distinctive Najdi style — ' +
      'thick walls that stay cool, small windows, and rows of triangular ' +
      'crenellations crowning every roof. UNESCO inscribed it as a World ' +
      'Heritage Site in 2010.',
    fact: 'The triangular "teeth" along the rooftops aren\'t just decoration — the shape sheds rare rain and softens the desert sun.',
  },
  salwa: {
    icon: '👑',
    ar: 'قصر سلوى',
    en: 'Salwa Palace',
    tag: 'Seat of the Imams',
    body:
      'Salwa Palace is the largest and most important building in At-Turaif — a ' +
      'sprawling complex of courtyards, residences and reception halls that served ' +
      'as the home and seat of power of the ruling Al Saud imams. Its scale and ' +
      'layered terraces made it the political heart of the early Saudi state.',
    fact: 'Salwa was not one building but a whole palace-city, growing over generations as the state expanded.',
  },
  mosque: {
    icon: '🕌',
    ar: 'مسجد الطريف',
    en: 'Historic Mosque',
    tag: 'Mosque of At-Turaif',
    body:
      'The mosque sat at the centre of community life in Diriyah. Like the homes ' +
      'around it, it was built of mud brick and palm timber, its open courtyard ' +
      'shaded by a colonnade. Faith and scholarship in Diriyah drew students from ' +
      'across the Arabian Peninsula.',
    fact: 'Diriyah was a renowned centre of learning; lessons were held in its mosques and courtyards.',
  },
  palace: {
    icon: '🏰',
    ar: 'قصر الأمير ثنيان بن سعود',
    en: 'Prince Thunayan bin Saud Palace',
    tag: 'Najdi residence',
    body:
      'A historic residence of the Al Saud family, built in the same earthen Najdi ' +
      'idiom as its neighbours. Family palaces like this one lined the alleys of ' +
      'At-Turaif, each a fortress-home with shaded courtyards turned inward away ' +
      'from the heat and dust.',
    fact: 'Najdi homes turn blank, protective walls to the street and open onto private inner courtyards.',
  },
  horse: {
    icon: '🐎',
    ar: 'متحف الخيل العربي',
    en: 'Arabian Horse Museum',
    tag: 'Heritage of the Najdi horse',
    body:
      'The Arabian horse is woven into the identity of Najd. Prized for stamina, ' +
      'intelligence and loyalty, these horses carried poets, traders and warriors ' +
      'across the peninsula. The museum celebrates the bloodlines and the deep ' +
      'bond between the people of Diriyah and their horses.',
    fact: 'The purebred Arabian is one of the oldest horse breeds on Earth — and its homeland is right here in the Arabian Peninsula.',
  },
  treasury: {
    icon: '⚖️',
    ar: 'متحف التجارة والمال',
    en: 'Trade & Treasury Museum',
    tag: 'At-Turaif museums',
    body:
      'Diriyah thrived on trade. Caravans crossing Arabia stopped at its markets ' +
      'to exchange dates, horses, textiles and silver. This museum, part of the ' +
      'At-Turaif living-museum complex, tells the story of the early Saudi ' +
      'economy, its coinage and its bustling souqs.',
    fact: 'Wadi Hanifah\'s water made Diriyah a green oasis on the caravan routes — a place worth stopping for.',
  },
  moudhi: {
    icon: '📜',
    ar: 'وقف موضي',
    en: 'Moudhi Endowment',
    tag: 'Charitable waqf',
    body:
      'A waqf (endowment) is a gift of property set aside forever to benefit the ' +
      'community — funding mosques, water, schooling and care for travellers. ' +
      'The Moudhi Endowment reflects a tradition of generosity that has long ' +
      'underpinned life in Diriyah.',
    fact: 'Endowments (أوقاف) could fund everything from a well to a library, running for centuries on their original gift.',
  },
  visitor: {
    icon: 'ℹ️',
    ar: 'مركز الزوار',
    en: 'Visitor Centre',
    tag: 'Your gateway to At-Turaif',
    body:
      'Today Diriyah is one of Saudi Arabia\'s great heritage destinations. The ' +
      'visitor centre is the gateway to the At-Turaif walking museums, the Bujairi ' +
      'Terrace, and the restored alleys you are exploring now — where the past is ' +
      'carefully kept alive in mud brick and palm.',
    fact: 'The wider Diriyah project aims to make the birthplace of the nation a living cultural quarter once again.',
  },
};

// Little rotating "did you know" lines shown on the loading veil and idle.
export const QAHWA_WISDOM = [
  'Arabic coffee (قهوة) is served in tiny cups — a guest is offered refills until they tilt the cup to say "enough".',
  'Dates and qahwa are the traditional welcome of Najd: bitterness balanced by sweetness.',
  'Mud brick keeps a Najdi house cool in summer and warm on cold desert nights.',
  'Wadi Hanifah is a 120 km valley — its water turned the desert around Diriyah green.',
  'The first Saudi State was founded in Diriyah in 1727.',
  'The frankincense-coloured walls of At-Turaif glow gold at sunset.',
];
