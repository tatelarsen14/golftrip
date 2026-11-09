// Every trip the app has hosted, newest first. Each trip lives in its own
// file under trips/ and its own Firestore slot (trips/{ID}), so a new trip
// never touches an old one. The app shows the current trip unless the link
// asks for another with ?trip=<id>.
import * as turkey2026 from './trips/turkey-2026.js';
import * as waId2026 from './trips/wa-id-2026.js';

export const TRIPS = [turkey2026, waId2026];
export const CURRENT_TRIP = TRIPS[0];

const wanted = new URLSearchParams(globalThis.location?.search || '').get('trip');
export const ACTIVE_TRIP = TRIPS.find((t) => t.ID === wanted) || CURRENT_TRIP;
export const IS_CURRENT_TRIP = ACTIVE_TRIP === CURRENT_TRIP;

export const {
  ID: TRIP_ID, LOCKED: TRIP_LOCKED, MODE: TRIP_MODE, FEED: TRIP_FEED = true, UI_KEY, SEEN_KEY,
  TRIP, PLAYERS, ROTATION, HOLE_HANDICAPS, DEFAULT_HCP, DEFAULT_CONFIG, ITINERARY, FLIGHTS,
} = ACTIVE_TRIP;

// Link to open a trip (the current trip's is the plain app link).
export const tripHref = (trip) => (trip === CURRENT_TRIP ? './' : `./?trip=${encodeURIComponent(trip.ID)}`);

// Colors a captain can pick for their team (the first two are the defaults).
export const TEAM_COLORS = ['#2f7d4f', '#1f5f99', '#b5541c', '#7a3fa0', '#b3261e', '#b8860b', '#2b2b2b'];
