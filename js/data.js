// Trip facts from the itinerary poster, plus the default tournament setup.
// Teams come from Friday's draft and can be adjusted from the Setup tab.

export const TRIP = {
  title: 'Washington / Idaho Golf Trip',
  dates: 'October 2 – 6, 2026',
  tagline: 'Same Crew · Different Fairways',
  short: 'WA / ID',
  shortDates: 'Oct 2–6',
};

export const PLAYERS = [
  { id: 'tate', name: 'Tate' },
  { id: 'garrett', name: 'Garrett' },
  { id: 'sam', name: 'Sam' },
  { id: 'jonah', name: 'Jonah' },
  { id: 'josh', name: 'Josh' },
  { id: 'brody', name: 'Brody' },
  { id: 'jp', name: 'JP' },
  { id: 'skyler', name: 'Skyler' },
];

// Colors a captain can pick for their team (the first two are the defaults).
export const TEAM_COLORS = ['#2f7d4f', '#1f5f99', '#b5541c', '#7a3fa0', '#b3261e', '#b8860b', '#2b2b2b'];

// Who plays with who Sat-Mon, by draft slot (0 = captain, then picks in
// order). Each group is two players from each team: best ball a v b on the
// front, singles a[0] v b[0] and a[1] v b[1] on the back. Over the three days
// everyone partners each teammate once and plays three different opponents.
export const ROTATION = {
  sat: [{ a: [0, 1], b: [0, 1] }, { a: [2, 3], b: [2, 3] }],
  sun: [{ a: [0, 2], b: [1, 3] }, { a: [1, 3], b: [0, 2] }],
  mon: [{ a: [0, 3], b: [3, 0] }, { a: [1, 2], b: [2, 1] }],
};

// Friday's Captain Round picks the captains, who draft the two teams of 4.
// Formats: 'stroke' (Captain Round, no points), 'match' (best ball front,
// singles back), 'teamstroke' (all 4 scores count, low team total wins) and
// 'escalating' (Tuesday singles, back 9 worth double, leader picks matchups).
// `skins`: 'par3' for every par 3, 'all' for every hole.
export const DEFAULT_CONFIG = {
  v: 2,
  teams: [], // set by the draft: [{ name, color, players: [captain, pick, pick, pick] }]
  // captains: set by hand to override Friday's scores; picks stay locked until Tate starts the draft.
  draft: { captains: [], picks: [], times: [], at: 0, started: false, startedAt: 0 },
  tuePicks: { pairs: [] }, // Tuesday matchups: [[team 0 player, team 1 player] x 4]
  puttoffs: {},
  rounds: [
    {
      id: 'fri', tees: [], date: '2026-10-02', day: 'Fri Oct 2', course: 'Indian Canyon', enabled: true, format: 'stroke',
      groups: [{ players: ['tate', 'garrett', 'sam'] }, { players: ['jonah', 'josh', 'brody'] }],
    },
    { id: 'sat', tees: ['12:20 PM', '12:30 PM'], date: '2026-10-03', day: 'Sat Oct 3', course: 'Circling Raven', enabled: true, format: 'match', skins: 'par3', groups: ROTATION.sat },
    { id: 'sun', tees: ['12:35 PM', '12:45 PM'], date: '2026-10-04', day: 'Sun Oct 4', course: 'Scarecrow', enabled: true, format: 'match', skins: 'par3', groups: ROTATION.sun },
    { id: 'qs', tees: ['9:20 AM', '9:30 AM'], date: '2026-10-05', day: 'Mon Oct 5', course: 'Quicksands', enabled: true, format: 'teamstroke', holes: 14, skins: 'all', groups: ROTATION.mon },
    { id: 'mon', tees: ['12:20 PM', '12:30 PM'], date: '2026-10-05', day: 'Mon Oct 5', course: 'Gamble Sands', enabled: true, format: 'match', skins: 'par3', groups: ROTATION.mon },
    { id: 'tue', tees: ['9:20 AM', '9:30 AM'], date: '2026-10-06', day: 'Tue Oct 6', course: "Coeur d'Alene", enabled: true, format: 'escalating', skins: 'par3', groups: [] },
  ],
  // Par by hole for each round, from the course scorecards.
  pars: {
    fri: parsFrom([4, 5, 4, 3, 4, 4, 4, 3, 4, 4, 3, 5, 3, 4, 4, 4, 4, 5]), // Indian Canyon (blue), 71
    sat: parsFrom([5, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 3, 5, 4]), // Circling Raven, 72
    sun: parsFrom([4, 3, 5, 3, 4, 5, 4, 4, 3, 4, 3, 5, 4, 4, 5, 3, 4, 4]), // Scarecrow, 71
    qs: parsFrom(Array(14).fill(3)), // Quicksands, 14 par 3s
    mon: parsFrom([4, 4, 5, 3, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 4, 3, 4, 5]), // Gamble Sands, 72
    tue: parsFrom([5, 4, 3, 4, 3, 3, 4, 4, 5, 4, 5, 3, 4, 3, 5, 4, 4, 4]), // Coeur d'Alene Resort, 71
  },
};

// Hole handicap (stroke index) from each scorecard: 1 = hardest hole.
// Not used for scoring yet; here for handicap strokes if we add them.
export const HOLE_HANDICAPS = {
  fri: [4, 18, 10, 14, 2, 12, 16, 6, 8, 3, 17, 11, 9, 1, 7, 5, 15, 13],
  sat: [7, 11, 15, 1, 5, 13, 17, 9, 3, 14, 6, 2, 12, 18, 8, 16, 4, 10],
  sun: [3, 9, 11, 5, 17, 15, 1, 7, 13, 4, 18, 16, 8, 2, 10, 12, 6, 14],
  mon: [7, 11, 1, 15, 5, 13, 3, 17, 9, 14, 6, 18, 12, 2, 8, 10, 4, 16],
  tue: [7, 3, 17, 5, 13, 15, 11, 9, 1, 6, 2, 14, 12, 10, 16, 8, 18, 4],
};

function parsFrom(list) {
  return Object.fromEntries(list.map((par, i) => [i + 1, par]));
}

export const ITINERARY = [
  {
    day: 'Friday', date: 'Oct 2', title: 'Indian Canyon · Spokane',
    items: [
      { icon: '✈️', time: '8:00 AM', text: 'Fly SLC → Spokane (GEG)' },
      { icon: '⛳', text: 'Captain Round — Indian Canyon', sub: 'Stroke play: the two low scores are the captains' },
      { icon: '🎯', text: 'The Draft', sub: 'Captains pick the two teams of 4 in the app' },
    ],
    stay: { name: 'Airbnb' },
  },
  {
    day: 'Saturday', date: 'Oct 3', title: 'Circling Raven Golf Club',
    items: [
      { icon: '⛳', time: '12:20 PM, 12:30 PM', text: 'Tee times' },
      { icon: '📅', text: '48 hr cancellation notice' },
    ],
    stay: { name: 'Airbnb' },
  },
  {
    day: 'Sunday', date: 'Oct 4', title: 'Scarecrow at Gamble Sands',
    items: [
      { icon: '🚗', time: '8:00 AM', text: 'Drive Spokane → Brewster, WA', sub: '~2.5 hours' },
      { icon: '🏌️', text: 'Optional putting course at Cascades', sub: 'If we want' },
      { icon: '⛳', time: '12:35 PM, 12:45 PM', text: 'Tee times — Scarecrow' },
      { icon: '📅', text: '7 days cancellation notice' },
    ],
    stay: { name: 'Gamble Sands Resort' },
  },
  {
    day: 'Monday', date: 'Oct 5', title: 'Gamble Sands',
    items: [
      { icon: '⛳', time: '9:20 AM, 9:30 AM', text: 'Tee times — Quicksands', sub: '14 par 3s · team stroke play' },
      { icon: '⛳', time: '12:20 PM, 12:30 PM', text: 'Tee times — Gamble Sands' },
      { icon: '📅', text: '7 days cancellation notice' },
      { icon: '🚗', text: 'Drive to Spokane after golf', sub: '~2.5 hours' },
    ],
    stay: { name: 'SilverStone Inn & Suites' },
  },
  {
    day: 'Tuesday', date: 'Oct 6', title: "Coeur d'Alene Golf Club",
    items: [
      { icon: '⛳', time: '9:20 AM, 9:30 AM', text: 'Tee times' },
      { icon: '📅', text: 'Caddies · 7 days cancellation notice' },
      { icon: '🚗', text: 'Drive back to Spokane after golf' },
      { icon: '✈️', time: '5:09 PM', text: 'Fly Spokane (GEG) → SLC' },
    ],
  },
];

export const FLIGHTS = [
  { route: 'SLC → GEG', when: 'Fri, Oct 2 · 8:00 AM' },
  { route: 'GEG → SLC', when: 'Tue, Oct 6 · 5:09 PM' },
];
