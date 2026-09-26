// Trip facts from the itinerary poster, plus the default tournament setup.
// Teams and pairings can be changed later from the Setup tab in the app.

export const TRIP = {
  title: 'Washington / Idaho Golf Trip',
  dates: 'October 2 – 6, 2026',
  tagline: 'Same Crew · Different Fairways',
};

export const PLAYERS = [
  { id: 'tate', name: 'Tate', phone: '(801) 425-4665' },
  { id: 'garrett', name: 'Garrett', phone: '(801) 660-0875' },
  { id: 'sam', name: 'Sam', phone: '(801) 497-1994' },
  { id: 'jonah', name: 'Jonah', phone: '(801) 425-4808' },
  { id: 'josh', name: 'Josh', phone: '(801) 721-6169' },
  { id: 'brody', name: 'Brody', phone: '(801) 497-1084' },
  { id: 'jp', name: 'JP', phone: '(801) 618-9424' },
  { id: 'skyler', name: 'Skyler', phone: '(801) 500-0655' },
];

export const TEAM_COLORS = ['#2f7d4f', '#1f5f99', '#b5541c', '#7a3fa0'];

// Groups rotate so every team sees every other team; singles opponents
// alternate each day within the group.
export const DEFAULT_CONFIG = {
  teams: [
    { name: 'Team 1', players: ['tate', 'garrett'] },
    { name: 'Team 2', players: ['sam', 'jonah'] },
    { name: 'Team 3', players: ['josh', 'brody'] },
    { name: 'Team 4', players: ['jp', 'skyler'] },
  ],
  rounds: [
    {
      id: 'fri', date: '2026-10-02', day: 'Fri Oct 2', course: 'Spokane (TBD)', enabled: true,
      groups: [{ teams: [0, 1], cross: false }, { teams: [2, 3], cross: false }],
    },
    {
      id: 'sat', date: '2026-10-03', day: 'Sat Oct 3', course: 'Circling Raven', enabled: true,
      groups: [{ teams: [0, 2], cross: true }, { teams: [1, 3], cross: true }],
    },
    {
      id: 'sun', date: '2026-10-04', day: 'Sun Oct 4', course: 'Scarecrow', enabled: true,
      groups: [{ teams: [0, 3], cross: false }, { teams: [1, 2], cross: false }],
    },
    {
      id: 'mon', date: '2026-10-05', day: 'Mon Oct 5', course: 'Gamble Sands', enabled: true,
      groups: [{ teams: [0, 1], cross: true }, { teams: [2, 3], cross: true }],
    },
    {
      id: 'tue', date: '2026-10-06', day: 'Tue Oct 6', course: "Coeur d'Alene", enabled: true,
      groups: [{ teams: [0, 2], cross: false }, { teams: [1, 3], cross: false }],
    },
  ],
};

export const ITINERARY = [
  {
    day: 'Friday', date: 'Oct 2', title: 'Spokane',
    items: [
      { icon: '✈️', time: '8:00 AM', text: 'Fly SLC → Spokane (GEG)' },
      { icon: '⛳', text: 'Play golf — TBD Spokane course', sub: '$50 – $100' },
    ],
    stay: { name: 'Airbnb', address: '4203 North Atlantic Street, Spokane, WA 99205' },
  },
  {
    day: 'Saturday', date: 'Oct 3', title: 'Circling Raven Golf Club',
    items: [
      { icon: '⛳', time: '12:20 PM, 12:30 PM', text: 'Tee times' },
      { icon: '💲', text: '$229 each (prepaid)', sub: '48 hr cancellation notice' },
    ],
    stay: { name: 'Airbnb', address: '4203 North Atlantic Street, Spokane, WA 99205' },
  },
  {
    day: 'Sunday', date: 'Oct 4', title: 'Scarecrow at Gamble Sands',
    items: [
      { icon: '🚗', time: '8:00 AM', text: 'Drive Spokane → Brewster, WA', sub: '~2.5 hours' },
      { icon: '🏌️', text: 'Optional putting course at Cascades', sub: 'If we want' },
      { icon: '⛳', time: '12:35 PM, 12:45 PM', text: 'Tee times — Scarecrow' },
      { icon: '💲', text: '$216', sub: '7 days cancellation notice' },
    ],
    stay: { name: 'Gamble Sands Resort', address: '200 Sand Trail Rd, Brewster, WA 98812' },
  },
  {
    day: 'Monday', date: 'Oct 5', title: 'Gamble Sands',
    items: [
      { icon: '⛳', time: '9:20 AM, 9:30 AM', text: 'Tee times — Quicksands', sub: '14-hole short course · $75' },
      { icon: '⛳', time: '12:20 PM, 12:30 PM', text: 'Tee times — Gamble Sands' },
      { icon: '💲', text: '$216', sub: '7 days cancellation notice' },
      { icon: '🚗', text: 'Drive to Spokane after golf', sub: '~2.5 hours' },
    ],
    stay: { name: 'SilverStone Inn & Suites', address: '2016 N Argonne Rd, Spokane Valley, WA 99212' },
  },
  {
    day: 'Tuesday', date: 'Oct 6', title: "Coeur d'Alene Golf Club",
    items: [
      { icon: '⛳', time: '9:20 AM, 9:30 AM', text: 'Tee times' },
      { icon: '💲', text: '$225 + caddy', sub: '7 days cancellation notice' },
      { icon: '🚗', text: 'Drive back to Spokane after golf' },
      { icon: '✈️', time: '5:09 PM', text: 'Fly Spokane (GEG) → SLC' },
    ],
  },
];

export const FLIGHTS = [
  { route: 'SLC → GEG', when: 'Fri, Oct 2 · 8:00 AM' },
  { route: 'GEG → SLC', when: 'Tue, Oct 6 · 5:09 PM' },
];

export const ESTIMATE = [
  ['Golf (5–6 courses)', 950],
  ['Flights (roundtrip)', 500],
  ['Lodging (4 nights)', 450],
  ['Rental car', 100],
  ['Gas', 150],
  ['Food', 200],
];
