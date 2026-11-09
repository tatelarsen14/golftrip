// The Pre Turkey Classic, Nov 22-23, 2026: two rounds near St. George with
// the four of us, everyone for themselves. Every nine is a 2 v 2 best ball
// plus two singles in the same foursome; each win is a point for the player.
// Partners rotate so everyone partners everyone once and plays everyone once
// in singles over the first three nines. The last nine is the championship
// nine: singles only, seeded 1st v 2nd and 3rd v 4th, worth 2 points each.

export const ID = 'turkey-2026';
export const LOCKED = false;
export const MODE = 'solo';
// Small group: no Feed tab this trip.
export const FEED = false;
export const UI_KEY = `golftrip:ui:${ID}`;
export const SEEN_KEY = `golftrip:seen:${ID}`;

export const TRIP = {
  name: 'Pre Turkey Classic',
  title: 'The Pre Turkey Classic',
  dates: 'November 22 – 23, 2026',
  tagline: 'Mini Golf Getaway',
  short: 'Hurricane, UT',
  shortDates: 'Nov 22–23',
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
  sky: [
    nine(['tate', 'garrett'], ['brody', 'jonah'], [['tate', 'brody'], ['garrett', 'jonah']]),
    nine(['tate', 'brody'], ['garrett', 'jonah'], [['tate', 'jonah'], ['brody', 'garrett']]),
  ],
  copper: [
    nine(['tate', 'jonah'], ['garrett', 'brody'], [['tate', 'garrett'], ['jonah', 'brody']]),
    { seed: true },
  ],
};

// Hole handicap (stroke index) from each scorecard: 1 = hardest hole.
export const HOLE_HANDICAPS = {
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
      id: 'sky', tees: ['12:40 PM'], date: '2026-11-22', day: 'Sun Nov 22', course: 'Sky Mountain', enabled: true, format: 'nines', skins: 'par3',
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'], nines: ROTATION.sky }],
    },
    {
      id: 'copper', tees: ['11:12 AM'], date: '2026-11-23', day: 'Mon Nov 23', course: 'Copper Rock', enabled: true, format: 'nines', skins: 'par3',
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'], nines: ROTATION.copper }],
    },
  ],
  pars: {
    sky: parsFrom([4, 3, 4, 4, 4, 5, 4, 3, 5, 5, 4, 3, 4, 4, 4, 3, 4, 5]), // Sky Mountain, 72
    copper: parsFrom([5, 4, 4, 3, 5, 4, 3, 4, 4, 4, 4, 5, 4, 4, 3, 5, 3, 4]), // Copper Rock (black), 72
  },
};

function parsFrom(list) {
  return Object.fromEntries(list.map((par, i) => [i + 1, par]));
}

export const ITINERARY = [
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
      { icon: '⛳', time: '11:12 AM', text: 'Tee time — Copper Rock', sub: 'Free! · Front: Tate & Jonah v Garrett & Brody · Back: championship singles, 1st v 2nd & 3rd v 4th, 2 pts' },
    ],
  },
];

export const FLIGHTS = [];
