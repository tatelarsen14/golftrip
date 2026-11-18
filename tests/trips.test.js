import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIPS, CURRENT_TRIP, ACTIVE_TRIP, TRIP_ID } from '../js/data.js';
import { holesOf } from '../js/scoring.js';

test('trips: unique ids, the newest is current and opens by default', () => {
  assert.equal(new Set(TRIPS.map((t) => t.ID)).size, TRIPS.length);
  assert.equal(CURRENT_TRIP, TRIPS[0]);
  assert.equal(ACTIVE_TRIP, CURRENT_TRIP);
  assert.equal(TRIP_ID, 'turkey-2026');
  assert.ok(!CURRENT_TRIP.LOCKED);
  assert.ok(TRIPS.find((t) => t.ID === 'wa-id-2026').LOCKED);
});

test('trips: every round has pars and hole handicaps for each hole, on a real player list', () => {
  for (const t of TRIPS) {
    const ids = t.PLAYERS.map((p) => p.id);
    assert.ok(['cup', 'solo'].includes(t.MODE), t.ID);
    for (const r of t.DEFAULT_CONFIG.rounds) {
      const holes = holesOf(r);
      assert.equal(Object.keys(t.DEFAULT_CONFIG.pars[r.id]).length, holes.length, `${t.ID} ${r.id} pars`);
      if (holes.length === 18) assert.deepEqual([...t.HOLE_HANDICAPS[r.id]].sort((a, b) => a - b), holes, `${t.ID} ${r.id} handicaps`);
      for (const g of r.groups) for (const p of g.players || []) assert.ok(ids.includes(p), `${t.ID} ${r.id} ${p}`);
    }
  }
});

test('Pre Turkey Classic: every course is par 72', () => {
  const t = TRIPS.find((x) => x.ID === 'turkey-2026');
  for (const id of ['coral', 'sky', 'copper']) assert.equal(Object.values(t.DEFAULT_CONFIG.pars[id]).reduce((a, b) => a + b, 0), 72);
});

import { buildMatches, resolveConfig, computeStandings, computeMatch, soloTable } from '../js/scoring.js';
const turkey = TRIPS.find((x) => x.ID === 'turkey-2026');
const pairKey = (x, y) => [x, y].sort().join('|');

test('Pre Turkey Classic: first three nines, everyone partners everyone once and plays everyone once in singles', () => {
  const ms = buildMatches(resolveConfig(turkey.DEFAULT_CONFIG, {}));
  assert.equal(ms.length, 13); // Saturday's 3 Sixes matches, 3 a nine, plus the final stroke play nine
  const nines = ms.filter((m) => m.roundId !== 'coral');
  const partners = nines.filter((m) => m.type === 'bestball').flatMap((m) => m.sides.map((s) => pairKey(...s.players)));
  const singles = nines.filter((m) => m.type === 'singles').map((m) => pairKey(m.sides[0].players[0], m.sides[1].players[0]));
  assert.equal(new Set(partners).size, 6);
  assert.equal(new Set(singles).size, 6);
});

// Every player's scores for a round: par, with some holes changed.
function card(roundId, tweaks = {}) {
  const pars = turkey.DEFAULT_CONFIG.pars[roundId];
  return Object.fromEntries(Object.entries(pars).map(([h, p]) => [h, p + (tweaks[h] || 0)]));
}

test('Pre Turkey Classic: the last nine is all four stroke play, 3-2-1-0 with ties split', () => {
  const ids = turkey.PLAYERS.map((p) => p.id);
  // Front 9s and Sunday: everyone pars, so every match is halved.
  const scores = { sky: Object.fromEntries(ids.map((p) => [p, card('sky')])), copper: {} };
  // Copper Rock back 9: Tate -2, Garrett -1, Brody and Jonah even (tied for 3rd).
  const back = { tate: { 10: -1, 12: -1 }, garrett: { 13: -1 }, brody: {}, jonah: {} };
  for (const p of ids) scores.copper[p] = card('copper', back[p]);
  const r = resolveConfig(turkey.DEFAULT_CONFIG, scores);
  const fin = buildMatches(r).filter((m) => m.roundId === 'copper' && m.nine === 1);
  assert.equal(fin.length, 1);
  assert.equal(fin[0].type, 'ninestroke');
  const t = Object.fromEntries(soloTable(buildMatches(r), scores, ids).map((x) => [x.id, x]));
  // Two halved matches a nine (1 point) for three nines before the final one.
  assert.equal(t.tate.points, 3 + 3);
  assert.equal(t.garrett.points, 3 + 2);
  assert.equal(t.brody.points, 3 + 0.5);
  assert.equal(t.jonah.points, 3 + 0.5);
  // The stroke nine isn't a win or a loss.
  assert.equal(t.tate.w + t.tate.l, 0);
  assert.equal(computeStandings(r, scores).players.tate.points, 6);
  // Halfway through the nine it's live, not final.
  const part = structuredClone(scores);
  for (const p of ids) for (let h = 15; h <= 18; h++) delete part.copper[p][h];
  const live = buildMatches(resolveConfig(turkey.DEFAULT_CONFIG, part)).find((m) => m.type === 'ninestroke');
  const pt = soloTable([live], part, ids);
  assert.equal(pt.reduce((a, x) => a + x.points, 0), 0);
});

test('Pre Turkey Classic: Saturday is Sixes, a new partner and game every 6 holes', () => {
  const ids = turkey.PLAYERS.map((p) => p.id);
  const sat = (scores) => buildMatches(resolveConfig(turkey.DEFAULT_CONFIG, scores)).filter((m) => m.roundId === 'coral');
  const ms = sat({});
  assert.deepEqual(ms.map((m) => [m.game, m.holes[0], m.holes[m.holes.length - 1]]),
    [['bestball', 1, 6], ['lowhigh', 7, 12], ['aggregate', 13, 18]]);
  // Everyone partners everyone once.
  assert.equal(new Set(ms.flatMap((m) => m.sides.map((s) => pairKey(...s.players)))).size, 6);

  // Tate & Garrett v Brody & Jonah, best ball 1-6: Tate birdies 1, all else par -> 1 UP.
  // Tate & Brody v Garrett & Jonah, low / high 7-12: on 7 Tate birdies (low ball
  // point) but Brody doubles (high ball point to the other side): a halved hole.
  // On 8 Garrett and Jonah both bogey, Tate and Brody par: both points, hole won.
  // Tate & Jonah v Garrett & Brody, aggregate 13-18: Garrett birdies 13 and
  // Brody bogeys 14 -> they're +1 - 1 = even with Tate & Jonah's pars: halved.
  const tw = { tate: { 1: -1, 7: -1 }, garrett: { 8: 1, 13: -1 }, brody: { 7: 2, 14: 1 }, jonah: { 8: 1 } };
  const scores = { coral: Object.fromEntries(ids.map((p) => [p, card('coral', tw[p])])) };
  const res = sat(scores).map((m) => computeMatch(m, scores.coral));
  assert.equal(res[0].status, 'Won 1 UP');
  assert.equal(res[0].leader, 0);
  assert.equal(res[1].holes[0].winner, 'halve');
  assert.equal(res[1].holes[1].winner, 0);
  assert.equal(res[1].leader, 0);
  assert.equal(res[2].status, 'Halved');
  // Points: 1 to each partner who wins a stretch, ½ for a halve.
  const pts = Object.fromEntries(soloTable(sat(scores), scores, ids).map((x) => [x.id, x.points]));
  assert.deepEqual(pts, { tate: 2.5, garrett: 1.5, brody: 1.5, jonah: 0.5 });

  // A 12 gets 3 strokes on a 6-hole stretch.
  const withHcp = buildMatches(resolveConfig({ ...turkey.DEFAULT_CONFIG, hcp: { ...turkey.DEFAULT_HCP, jonah: 12 } }, {}));
  assert.deepEqual(withHcp.find((m) => m.roundId === 'coral' && m.game === 'bestball').strokes.jonah, [3, 4, 6]);
});
