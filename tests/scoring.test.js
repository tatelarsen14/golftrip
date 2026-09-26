import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatches, computeMatch, computeStandings, sideScore } from '../js/scoring.js';
import { DEFAULT_CONFIG } from '../js/data.js';

const cfg = structuredClone(DEFAULT_CONFIG);
const holes = (arr, start = 1) => Object.fromEntries(arr.map((v, i) => [start + i, v]));

test('builds 1 best ball + 2 singles per group, 6 matches per round', () => {
  const matches = buildMatches(cfg);
  assert.equal(matches.length, 5 * 6);
  const fri = matches.filter((m) => m.roundId === 'fri');
  assert.deepEqual(fri.map((m) => m.type), ['bestball', 'singles', 'singles', 'bestball', 'singles', 'singles']);
  assert.deepEqual(fri[1].sides.map((s) => s.players[0]), ['tate', 'sam']);
});

test('cross swaps singles opponents', () => {
  const sat = buildMatches(cfg).filter((m) => m.roundId === 'sat' && m.type === 'singles');
  assert.deepEqual(sat[0].sides.map((s) => s.players[0]), ['tate', 'brody']);
  assert.deepEqual(sat[1].sides.map((s) => s.players[0]), ['garrett', 'josh']);
});

test('disabled rounds produce no matches', () => {
  const c = structuredClone(cfg);
  c.rounds[0].enabled = false;
  assert.equal(buildMatches(c).length, 4 * 6);
});

test('best ball takes the low score and ignores pickups', () => {
  const s = { tate: { 1: 5 }, garrett: { 1: 4 }, sam: {}, jonah: { 1: 6 } };
  assert.equal(sideScore(s, ['tate', 'garrett'], 1), 4);
  assert.equal(sideScore(s, ['sam', 'jonah'], 1), 6);
  assert.equal(sideScore(s, ['sam'], 1), null);
});

test('in-progress best ball status', () => {
  const m = buildMatches(cfg)[0];
  const scores = {
    tate: holes([4, 5, 4]), garrett: holes([5, 3, 5]),
    sam: holes([5, 4, 4]), jonah: holes([4, 5, 6]),
  };
  const r = computeMatch(m, scores);
  // H1: 4 v 4 halve, H2: 3 v 4 A wins, H3: 4 v 4 halve
  assert.equal(r.played, 3);
  assert.equal(r.diff, 1);
  assert.equal(r.status, '1 UP');
  assert.equal(r.done, false);
  assert.equal(r.points, null);
  assert.deepEqual(r.projected, [1, 0]);
});

test('match closes out early (4&3) and ignores later holes', () => {
  const m = buildMatches(cfg)[1]; // tate v sam, back 9
  const scores = {
    tate: holes([3, 3, 3, 3, 4, 4, 4, 9, 9], 10),
    sam: holes([4, 4, 4, 4, 4, 4, 4, 3, 3], 10),
  };
  const r = computeMatch(m, scores);
  // Tate wins 10-13, halves 14-15: 4 UP with 3 to play is closed out.
  assert.equal(r.done, true);
  assert.equal(r.leader, 0);
  assert.deepEqual(r.points, [1, 0]);
  assert.equal(r.status, 'Won 4&3');
  assert.equal(r.played, 6);
});

test('dormie and halved finals', () => {
  const m = buildMatches(cfg)[1];
  let r = computeMatch(m, { tate: holes([3, 5, 4, 4, 4, 4, 4], 10), sam: holes([4, 4, 4, 4, 4, 4, 4], 10) });
  assert.equal(r.status, 'All square');
  r = computeMatch(m, { tate: holes([3, 4, 4, 4, 4, 4, 4], 10), sam: holes([4, 4, 4, 4, 4, 4, 4], 10) });
  assert.equal(r.status, '1 UP');
  r = computeMatch(m, { tate: holes([3, 3, 4, 4, 4, 4, 4], 10), sam: holes([4, 4, 4, 4, 4, 4, 4], 10) });
  assert.equal(r.status, '2 UP · Dormie');
  r = computeMatch(m, { tate: holes(Array(9).fill(4), 10), sam: holes(Array(9).fill(4), 10) });
  assert.equal(r.status, 'Halved');
  assert.deepEqual(r.points, [0.5, 0.5]);
});

test('win on the last hole reads 1 UP', () => {
  const m = buildMatches(cfg)[1];
  const r = computeMatch(m, { tate: holes([...Array(8).fill(4), 3], 10), sam: holes(Array(9).fill(4), 10) });
  assert.equal(r.status, 'Won 1 UP');
});

test('standings add up: team gets best ball + singles points', () => {
  const nine = (v, start) => holes(Array(9).fill(v), start);
  const fri = {
    tate: { ...nine(4, 1), ...nine(4, 10) },
    garrett: { ...nine(5, 1), ...nine(5, 10) },
    sam: { ...nine(5, 1), ...nine(4, 10) },
    jonah: { ...nine(5, 1), ...nine(4, 10) },
  };
  const { teams, players } = computeStandings(cfg, { fri });
  // Team 1 wins best ball (4s v 5s), Tate halves Sam, Garrett loses to Jonah
  assert.equal(teams[0].points, 1.5);
  assert.equal(teams[1].points, 1.5);
  assert.equal(players.tate.points, 1.5);
  assert.equal(players.garrett.points, 1);
  assert.equal(players.jonah.points, 1);
  assert.deepEqual([teams[0].w, teams[0].l, teams[0].h], [1, 1, 1]);
  assert.equal(teams[2].points, 0);
});
