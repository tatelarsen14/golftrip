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

test('Pre Turkey Classic: both courses are par 72', () => {
  const t = TRIPS.find((x) => x.ID === 'turkey-2026');
  for (const id of ['sky', 'copper']) assert.equal(Object.values(t.DEFAULT_CONFIG.pars[id]).reduce((a, b) => a + b, 0), 72);
});

import { buildMatches, resolveConfig, computeStandings, soloTable } from '../js/scoring.js';
const turkey = TRIPS.find((x) => x.ID === 'turkey-2026');
const pairKey = (x, y) => [x, y].sort().join('|');

test('Pre Turkey Classic: first three nines, everyone partners everyone once and plays everyone once in singles', () => {
  const ms = buildMatches(resolveConfig(turkey.DEFAULT_CONFIG, {}));
  assert.equal(ms.length, 9); // last nine waits for the standings
  const partners = ms.filter((m) => m.type === 'bestball').flatMap((m) => m.sides.map((s) => pairKey(...s.players)));
  const singles = ms.filter((m) => m.type === 'singles').map((m) => pairKey(m.sides[0].players[0], m.sides[1].players[0]));
  assert.equal(new Set(partners).size, 6);
  assert.equal(new Set(singles).size, 6);
});

// Every player's scores for a round: par, with some holes changed.
function card(roundId, tweaks = {}) {
  const pars = turkey.DEFAULT_CONFIG.pars[roundId];
  return Object.fromEntries(Object.entries(pars).map(([h, p]) => [h, p + (tweaks[h] || 0)]));
}

test('Pre Turkey Classic: the last nine is championship singles, 1st v 2nd and 3rd v 4th for 2 points', () => {
  // Tate birdies every hole he plays; Garrett bogeys every hole; Brody makes
  // one birdie on each nine; Jonah pars.
  const all = (d) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, d]));
  const mk = (rid) => ({
    tate: card(rid, all(-1)), garrett: card(rid, all(1)), brody: card(rid, { 1: -1, 10: -1 }), jonah: card(rid),
  });
  const half = (sc) => Object.fromEntries(Object.entries(sc).map(([p, h]) => [p, Object.fromEntries(Object.entries(h).filter(([k]) => k <= 9))]));
  let scores = { sky: mk('sky'), copper: half(mk('copper')) };
  const r = resolveConfig(turkey.DEFAULT_CONFIG, scores);
  const last = r.rounds.find((x) => x.id === 'copper').groups[0].nines[1];
  assert.ok(last.seeded);
  const table = soloTable(buildMatches(r).filter((m) => !(m.roundId === 'copper' && m.nine === 1)), scores, turkey.PLAYERS.map((p) => p.id));
  const [p1, p2, p3, p4] = table.map((x) => x.id);
  assert.equal(p1, 'tate');
  assert.equal(p4, 'garrett');
  assert.equal(last.a, undefined); // no best ball
  assert.deepEqual(last.singles, [{ a: p1, b: p2 }, { a: p3, b: p4 }]);
  // Both final-nine matches are 2-point singles; Tate wins his for 8 in all.
  const fin = buildMatches(r).filter((m) => m.roundId === 'copper' && m.nine === 1);
  assert.equal(fin.length, 2);
  assert.ok(fin.every((m) => m.type === 'singles' && m.weight === 2));
  const full = { sky: mk('sky'), copper: mk('copper') };
  const done = soloTable(buildMatches(resolveConfig(turkey.DEFAULT_CONFIG, full)), full, turkey.PLAYERS.map((p) => p.id));
  assert.equal(done[0].id, 'tate');
  assert.equal(done[0].points, 8);
  // Before the front 9 at Copper Rock is in, it's still waiting.
  scores = { sky: mk('sky') };
  assert.ok(resolveConfig(turkey.DEFAULT_CONFIG, scores).rounds[1].groups[0].nines[1].pending);
  // Tate wins all 6 of his matches through three nines: 6 points.
  assert.equal(table[0].points, 6);
  assert.equal(computeStandings(r, { sky: mk('sky'), copper: half(mk('copper')) }).players.tate.points, 6);
});
