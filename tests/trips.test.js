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
