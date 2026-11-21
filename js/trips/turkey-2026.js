// The Pre Turkey Classic, Nov 21-23, 2026: three rounds around St. George
// with the four of us, everyone for themselves. Saturday at Coral Canyon is
// Sixes: partners rotate every 6 holes and each stretch is a different 2 v 2
// game (best ball, low / high ball, aggregate), 1 point to each partner who
// wins it. Sunday and Monday, every nine is a 2 v 2 best ball
// plus two singles in the same foursome; each win is a point for the player.
// Partners rotate so everyone partners everyone once and plays everyone once
// in singles over the first three nines. The last nine is all four in one
// stroke play nine: 3 points for 1st, 2 for 2nd, 1 for 3rd (ties split).

export const ID = 'turkey-2026';
export const LOCKED = false;
export const MODE = 'solo';
// Prize money on top of skins: the overall winner and the birdie board winner.
export const PRIZES = { overall: 60, birdies: 30 };
export const UI_KEY = `golftrip:ui:${ID}`;
export const SEEN_KEY = `golftrip:seen:${ID}`;

export const TRIP = {
  name: 'Pre Turkey Classic',
  title: 'The Pre Turkey Classic',
  dates: 'November 21 – 23, 2026',
  tagline: 'Mini Golf Getaway',
  short: 'St. George, UT',
  shortDates: 'Nov 21–23',
  year: 2026,
};

export const PLAYERS = [
  { id: 'tate', name: 'Tate' },
  { id: 'garrett', name: 'Garrett' },
  { id: 'brody', name: 'Brody' },
  { id: 'jonah', name: 'Jonah' },
];

// Partners and singles for each nine (see the top of the file).
const nine = (a, b, singles) => ({ a, b, singles: singles.map(([x, y]) => ({ a: x, b: y })) });
export const ROTATION = {
  // Saturday: Sixes, a new partner and a new game every 6 holes.
  coral: [
    { from: 1, to: 6, game: 'bestball', a: ['tate', 'garrett'], b: ['brody', 'jonah'] },
    { from: 7, to: 12, game: 'lowhigh', a: ['tate', 'brody'], b: ['garrett', 'jonah'] },
    { from: 13, to: 18, game: 'aggregate', a: ['tate', 'jonah'], b: ['garrett', 'brody'] },
  ],
  sky: [
    nine(['tate', 'garrett'], ['brody', 'jonah'], [['tate', 'brody'], ['garrett', 'jonah']]),
    nine(['tate', 'brody'], ['garrett', 'jonah'], [['tate', 'jonah'], ['brody', 'garrett']]),
  ],
  copper: [
    nine(['tate', 'jonah'], ['garrett', 'brody'], [['tate', 'garrett'], ['jonah', 'brody']]),
    { stroke: true, places: [3, 2, 1, 0] },
  ],
};

// Hole handicap (stroke index) from each scorecard: 1 = hardest hole.
export const HOLE_HANDICAPS = {
  coral: [9, 15, 5, 7, 13, 1, 17, 11, 3, 6, 10, 12, 8, 2, 16, 18, 14, 4],
  sky: [11, 17, 15, 3, 7, 9, 1, 13, 5, 10, 14, 12, 16, 2, 18, 8, 4, 6],
  copper: [14, 2, 16, 12, 8, 18, 4, 6, 10, 7, 9, 13, 1, 3, 17, 11, 15, 5],
};

// Everyone even to start (Tate can change it in Setup).
export const DEFAULT_HCP = { tate: 3, garrett: 3, brody: 3, jonah: 3 };

export const DEFAULT_CONFIG = {
  v: 2,
  teams: [],
  draft: { captains: [], picks: [], times: [], at: 0, started: false, startedAt: 0 },
  tuePicks: { pairs: [] },
  tueDraft: { started: false, startedAt: 0, moves: [], times: [], next: [] },
  puttoffs: {},
  hcp: DEFAULT_HCP,
  holeHcp: HOLE_HANDICAPS,
  rounds: [
    {
      id: 'coral', tees: ['11:30 AM'], date: '2026-11-21', day: 'Sat Nov 21', course: 'Coral Canyon', enabled: true, format: 'nines', skins: 'all',
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'], nines: ROTATION.coral }],
    },
    {
      id: 'sky', tees: ['12:40 PM'], date: '2026-11-22', day: 'Sun Nov 22', course: 'Sky Mountain', enabled: true, format: 'nines', skins: 'all',
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'], nines: ROTATION.sky }],
    },
    {
      id: 'copper', tees: ['11:12 AM'], date: '2026-11-23', day: 'Mon Nov 23', course: 'Copper Rock', enabled: true, format: 'nines', skins: 'all',
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'], nines: ROTATION.copper }],
    },
  ],
  pars: {
    coral: parsFrom([4, 3, 4, 3, 5, 4, 5, 3, 5, 4, 5, 3, 4, 4, 3, 5, 4, 4]), // Coral Canyon, 72
    sky: parsFrom([4, 3, 4, 4, 4, 5, 4, 3, 5, 5, 4, 3, 4, 4, 4, 3, 4, 5]), // Sky Mountain, 72
    copper: parsFrom([5, 4, 4, 3, 5, 4, 3, 4, 4, 4, 4, 5, 4, 4, 3, 5, 3, 4]), // Copper Rock (black), 72
  },
};

function parsFrom(list) {
  return Object.fromEntries(list.map((par, i) => [i + 1, par]));
}

export const ITINERARY = [
  {
    day: 'Saturday', date: 'Nov 21', title: 'Coral Canyon Golf Course',
    items: [
      { icon: '⛳', time: '11:30 AM', text: 'Tee time — Coral Canyon', sub: 'Sixes · 1–6 best ball: Tate & Garrett v Brody & Jonah · 7–12 low/high ball: Tate & Brody v Garrett & Jonah · 13–18 aggregate: Tate & Jonah v Garrett & Brody' },
    ],
  },
  {
    day: 'Sunday', date: 'Nov 22', title: 'Sky Mountain Golf Course',
    items: [
      { icon: '⛳', time: '12:40 PM', text: 'Tee time — Sky Mountain', sub: '$78 · Front: Tate & Garrett v Brody & Jonah · Back: Tate & Brody v Garrett & Jonah' },
    ],
    stay: { name: "Aunt's house" },
  },
  {
    day: 'Monday', date: 'Nov 23', title: 'Copper Rock Golf Course',
    items: [
      { icon: '⛳', time: '11:12 AM', text: 'Tee time — Copper Rock', sub: 'Free! · Front: Tate & Jonah v Garrett & Brody · Back: all four stroke play, 3-2-1-0 points' },
    ],
  },
];

export const FLIGHTS = [];
