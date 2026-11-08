// The Pre Turkey Classic, Nov 22-23, 2026: two rounds near St. George with
// the four of us, everyone for themselves. The format is still to be decided;
// until then both days are straight stroke play.

export const ID = 'turkey-2026';
export const LOCKED = false;
export const MODE = 'solo';
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

export const ROTATION = {};

// Hole handicap (stroke index) from each scorecard: 1 = hardest hole.
export const HOLE_HANDICAPS = {
  sky: [11, 17, 15, 3, 7, 9, 1, 13, 5, 10, 14, 12, 16, 2, 18, 8, 4, 6],
  // Copper Rock: placeholder until we have the real scorecard.
  copper: [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18],
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
      id: 'sky', tees: ['12:40 PM'], date: '2026-11-22', day: 'Sun Nov 22', course: 'Sky Mountain', enabled: true, format: 'stroke', skins: 'par3', birdies: true,
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'] }],
    },
    {
      id: 'copper', tees: ['11:12 AM'], date: '2026-11-23', day: 'Mon Nov 23', course: 'Copper Rock', enabled: true, format: 'stroke', skins: 'par3', birdies: true,
      groups: [{ players: ['tate', 'garrett', 'brody', 'jonah'] }],
    },
  ],
  pars: {
    sky: parsFrom([4, 3, 4, 4, 4, 5, 4, 3, 5, 5, 4, 3, 4, 4, 4, 3, 4, 5]), // Sky Mountain, 72
    // Copper Rock is a par 72 (hole 1 is a par 5); placeholder pars until we have the card.
    copper: parsFrom([5, 4, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5]),
  },
};

function parsFrom(list) {
  return Object.fromEntries(list.map((par, i) => [i + 1, par]));
}

export const ITINERARY = [
  {
    day: 'Sunday', date: 'Nov 22', title: 'Sky Mountain Golf Course',
    items: [
      { icon: '⛳', time: '12:40 PM', text: 'Tee time — Sky Mountain', sub: '$78' },
    ],
    stay: { name: "Aunt's house" },
  },
  {
    day: 'Monday', date: 'Nov 23', title: 'Copper Rock Golf Course',
    items: [
      { icon: '⛳', time: '11:12 AM', text: 'Tee time — Copper Rock', sub: 'Free!' },
    ],
  },
];

export const FLIGHTS = [];
