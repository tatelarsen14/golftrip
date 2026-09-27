// Trip facts from the itinerary poster, plus the default tournament setup.
// Teams and pairings can be changed later from the Setup tab in the app.

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

export const TEAM_COLORS = ['#2f7d4f', '#1f5f99', '#b5541c', '#7a3fa0'];

// Groups rotate so every team sees every other team; singles opponents
// alternate within the group. Friday's round isn't part of the tournament,
// and Tuesday is seeded from the standings after Monday.
export const DEFAULT_CONFIG = {
  puttoffs: {},
  teams: [
    { name: 'Team 1', players: ['tate', 'garrett'] },
    { name: 'Team 2', players: ['sam', 'jonah'] },
    { name: 'Team 3', players: ['josh', 'brody'] },
    { name: 'Team 4', players: ['jp', 'skyler'] },
  ],
  rounds: [
    {
      id: 'sat', date: '2026-10-03', day: 'Sat Oct 3', course: 'Circling Raven', enabled: true,
      groups: [{ teams: [0, 1], cross: false }, { teams: [2, 3], cross: false }],
    },
    {
      id: 'sun', date: '2026-10-04', day: 'Sun Oct 4', course: 'Scarecrow', enabled: true,
      groups: [{ teams: [0, 2], cross: true }, { teams: [1, 3], cross: true }],
    },
    {
      id: 'mon', date: '2026-10-05', day: 'Mon Oct 5', course: 'Gamble Sands', enabled: true,
      groups: [{ teams: [0, 3], cross: false }, { teams: [1, 2], cross: false }],
    },
    {
      // Seeded: 1st v 2nd and 3rd v 4th once Sat-Mon are final.
      id: 'tue', date: '2026-10-06', day: 'Tue Oct 6', course: "Coeur d'Alene", enabled: true, seeded: true,
      groups: [{ teams: [0, 1], cross: true }, { teams: [2, 3], cross: true }],
    },
  ],
  // Par by hole for each round, from the course scorecards.
  pars: {
    sat: parsFrom([5, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 3, 5, 4]), // Circling Raven, 72
    sun: parsFrom([4, 3, 5, 3, 4, 5, 4, 4, 3, 4, 3, 5, 4, 4, 5, 3, 4, 4]), // Scarecrow, 71
    mon: parsFrom([4, 4, 5, 3, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 4, 3, 4, 5]), // Gamble Sands, 72
    tue: parsFrom([5, 4, 3, 4, 3, 3, 4, 4, 5, 4, 5, 3, 4, 3, 5, 4, 4, 4]), // Coeur d'Alene Resort, 71
  },
};

// Hole handicap (stroke index) from each scorecard: 1 = hardest hole.
// Not used for scoring yet; here for handicap strokes if we add them.
export const HOLE_HANDICAPS = {
  sat: [7, 11, 15, 1, 5, 13, 17, 9, 3, 14, 6, 2, 12, 18, 8, 16, 4, 10],
  sun: [3, 9, 11, 5, 17, 15, 1, 7, 13, 4, 18, 16, 8, 2, 10, 12, 6, 14],
  mon: [7, 11, 1, 15, 5, 13, 3, 17, 9, 14, 6, 18, 12, 2, 8, 10, 4, 16],
  tue: [7, 3, 17, 5, 13, 15, 11, 9, 1, 6, 2, 14, 12, 10, 16, 8, 18, 4],
};

function parsFrom(list) {
  return Object.fromEntries(list.map((par, i) => [i + 1, par]));
}

// The three ways to split four teams into two groups.
export const MATCHUPS = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

export const ITINERARY = [
  {
    day: 'Friday', date: 'Oct 2', title: 'Spokane',
    items: [
      { icon: '✈️', time: '8:00 AM', text: 'Fly SLC → Spokane (GEG)' },
      { icon: '⛳', text: 'Play golf — TBD Spokane course', sub: 'Just for fun, not part of the tournament' },
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
      { icon: '⛳', time: '9:20 AM, 9:30 AM', text: 'Tee times — Quicksands', sub: '14-hole short course' },
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
