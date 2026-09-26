import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatches, computeMatch, computeStandings, sideScore, scoreMark, birdieCounts, rankTeams, resolveConfig,
  matchStreak, birdieStreak, highlights, longestBirdieRun, longestMatchRun,
} from '../js/scoring.js';
import { DEFAULT_CONFIG } from '../js/data.js';

const cfg = structuredClone(DEFAULT_CONFIG);
const BACK = [10, 11, 12, 13, 14, 15, 16, 17, 18];
const holes = (arr, start = 1) => Object.fromEntries(arr.map((v, i) => [start + i, v]));

test('builds 1 best ball + 2 singles per group, 6 matches per round', () => {
  const matches = buildMatches(cfg);
  assert.equal(matches.length, 4 * 6);
  const fri = matches.filter((m) => m.roundId === 'sat');
  assert.deepEqual(fri.map((m) => m.type), ['bestball', 'singles', 'singles', 'bestball', 'singles', 'singles']);
  assert.deepEqual(fri[1].sides.map((s) => s.players[0]), ['tate', 'sam']);
});

test('cross swaps singles opponents', () => {
  const sat = buildMatches(cfg).filter((m) => m.roundId === 'sun' && m.type === 'singles');
  assert.deepEqual(sat[0].sides.map((s) => s.players[0]), ['tate', 'brody']);
  assert.deepEqual(sat[1].sides.map((s) => s.players[0]), ['garrett', 'josh']);
});

test('disabled rounds produce no matches', () => {
  const c = structuredClone(cfg);
  c.rounds[0].enabled = false;
  assert.equal(buildMatches(c).length, 3 * 6);
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
  const { teams, players } = computeStandings(cfg, { sat: fri });
  // Team 1 wins best ball (4s v 5s), Tate halves Sam, Garrett loses to Jonah
  assert.equal(teams[0].points, 1.5);
  assert.equal(teams[1].points, 1.5);
  assert.equal(players.tate.points, 1.5);
  assert.equal(players.garrett.points, 1);
  assert.equal(players.jonah.points, 1);
  assert.deepEqual([teams[0].w, teams[0].l, teams[0].h], [1, 1, 1]);
  assert.equal(teams[2].points, 0);
});

test('course pars match the scorecard totals', () => {
  const total = (id) => Object.values(cfg.pars[id]).reduce((a, b) => a + b, 0);
  assert.deepEqual(['sat', 'sun', 'mon', 'tue'].map(total), [72, 71, 72, 71]);
});

test('default config has no Friday round and 4 x 6 matches', () => {
  assert.equal(cfg.rounds.some((r) => r.id === 'fri'), false);
  assert.equal(buildMatches(cfg).length, 4 * 6);
});

test('score marks relative to par', () => {
  assert.equal(scoreMark(2, 4), 'eagle');
  assert.equal(scoreMark(1, 3), 'eagle');
  assert.equal(scoreMark(3, 4), 'birdie');
  assert.equal(scoreMark(4, 4), 'par');
  assert.equal(scoreMark(5, 4), 'bogey');
  assert.equal(scoreMark(6, 4), 'double');
  assert.equal(scoreMark(9, 4), 'double');
  assert.equal(scoreMark(null, 4), '');
});

test('birdie counts use each round\'s pars and skip disabled rounds', () => {
  const c = structuredClone(cfg);
  // Circling Raven: 1 par 5, 2 par 4, 12 par 5, 13 par 3. Scarecrow 1 is a par 4.
  const scores = {
    sat: { tate: { 12: 4, 13: 2, 1: 4, 2: 5 }, sam: { 12: 3 } },
    sun: { tate: { 1: 3 } },
  };
  let counts = birdieCounts(c, scores);
  assert.equal(counts.tate.birdies, 4);
  assert.equal(counts.sam.birdies, 1); // eagle counts as a birdie
  c.rounds.find((r) => r.id === 'sun').enabled = false;
  counts = birdieCounts(c, scores);
  assert.equal(counts.tate.birdies, 3);
});

// Every player shoots the same score on every hole of each nine.
const round = (perPlayer) => Object.fromEntries(Object.entries(perPlayer).map(([p, [front, back]]) => (
  [p, { ...holes(Array(9).fill(front), 1), ...holes(Array(9).fill(back), 10) }])));
const teamScores = (byTeam) => {
  const out = {};
  cfg.teams.forEach((t, i) => t.players.forEach((p) => { out[p] = [byTeam[i], byTeam[i]]; }));
  return round(out);
};

test('Tuesday is TBD until every Sat-Mon match is final, then seeds 1v2 and 3v4', () => {
  // Team 4 best, then 3, 2, 1: they finish 4th, 3rd, 2nd, 1st in reverse.
  const scores = { sat: teamScores([6, 5, 4, 3]), sun: teamScores([6, 5, 4, 3]), mon: teamScores([6, 5, 4, 3]) };
  const back = BACK.map((h) => [h, scores.mon.tate[h]]);
  for (const h of BACK) delete scores.mon.tate[h]; // Tate's Monday singles not played yet
  let resolved = resolveConfig(cfg, scores);
  let tue = resolved.rounds.find((r) => r.id === 'tue');
  assert.equal(tue.pending, true);
  assert.equal(buildMatches(resolved).some((m) => m.roundId === 'tue'), false);

  for (const [h, v] of back) scores.mon.tate[h] = v;
  resolved = resolveConfig(cfg, scores);
  tue = resolved.rounds.find((r) => r.id === 'tue');
  assert.equal(tue.pending, undefined);
  assert.deepEqual(tue.groups.map((g) => g.teams), [[3, 2], [1, 0]]);
  assert.equal(buildMatches(resolved).filter((m) => m.roundId === 'tue').length, 6);
});

test('head-to-head breaks a points tie', () => {
  const scores = {
    // Sat: Team 1 sweeps Team 2; Teams 3 and 4 halve everything.
    sat: round({ tate: [3, 3], garrett: [3, 3], sam: [5, 5], jonah: [5, 5], josh: [4, 4], brody: [4, 4], jp: [4, 4], skyler: [4, 4] }),
    // Sun: Team 3 sweeps Team 1; Team 2 sweeps Team 4.
    sun: round({ tate: [5, 5], garrett: [5, 5], josh: [3, 3], brody: [3, 3], sam: [3, 3], jonah: [3, 3], jp: [5, 5], skyler: [5, 5] }),
  };
  const { ranked, ties } = rankTeams(cfg, scores, ['sat', 'sun']);
  assert.deepEqual(ranked.map((t) => [t.idx, t.points]), [[2, 4.5], [0, 3], [1, 3], [3, 1.5]]);
  assert.equal(ranked[1].tiebreak, 'Head-to-head points');
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].rank, 3);
  // One tie (Teams 1 and 2 on 3 pts), settled at the first step.
  assert.equal(ties.length, 1);
  assert.deepEqual(ties[0].teams.sort(), [0, 1]);
  assert.deepEqual(ties[0].steps.map((s) => [s.key, s.values[0], s.values[1]]), [['h2h', 3, 0]]);
  assert.deepEqual(ties[0].steps[0].outcome, [[0], [1]]);
});

test('holes-up margin breaks a tie when head-to-head and wins are level', () => {
  // Sat only: Team 1 beats Team 2 2-1, Team 3 beats Team 4 2-1, but Team 3 by more.
  const scores = {
    sat: round({
      // Team 1: best ball won 1 UP, Tate wins 5&4, Garrett loses 5&4 -> margin +1.
      tate: [3, 3], garrett: [4, 5], sam: [4, 4], jonah: [4, 4],
      // Team 3: best ball won 5&4, Josh wins 5&4, Brody loses 5&4 -> margin +5.
      josh: [3, 3], brody: [5, 5], jp: [5, 5], skyler: [4, 4],
    }),
  };
  Object.assign(scores.sat.tate, holes([4, 4, 4, 4, 4, 4, 4, 4, 3], 1));
  const { ranked, ties } = rankTeams(cfg, scores, ['sat']);
  assert.deepEqual(ties[0].steps.map((s) => s.key), ['h2h', 'wins', 'margin']);
  assert.deepEqual(ranked.slice(0, 2).map((t) => [t.idx, t.points, t.wins]), [[2, 2, 2], [0, 2, 2]]);
  assert.equal(ranked[0].tiebreak, 'Holes-up margin');
});

test('dead even after every tiebreaker goes to a putt-off', () => {
  const scores = { sat: teamScores([4, 4, 4, 4]) };
  let { ranked, ties } = rankTeams(cfg, scores, ['sat']);
  assert.ok(ranked.every((t) => t.unresolved && t.rank === 1));
  assert.deepEqual(ties[0].pending[0].teams.sort(), [0, 1, 2, 3]);
  assert.equal(ties[0].steps.some((s) => s.key === 'puttoff'), false);

  // Team 3 wins the putt-off; the other three are still tied.
  const c = { ...cfg, puttoffs: { final: { '0-1-2-3': [2] } } };
  ({ ranked, ties } = rankTeams(c, scores, ['sat']));
  assert.equal(ranked[0].idx, 2);
  assert.equal(ranked[0].unresolved, false);
  assert.ok(ranked.slice(1).every((t) => t.unresolved && t.rank === 2));
  assert.deepEqual(ties[0].pending[0].done, [2]);

  // Full putt-off order recorded: everyone is placed.
  c.puttoffs.final['0-1-2-3'] = [2, 0, 3, 1];
  ({ ranked } = rankTeams(c, scores, ['sat']));
  assert.deepEqual(ranked.map((t) => [t.idx, t.rank, t.unresolved]), [[2, 1, false], [0, 2, false], [3, 3, false], [1, 4, false]]);
});

test('a 2nd/3rd tie that needs a putt-off keeps Tuesday TBD; a 1st/2nd one does not', () => {
  // Every Sat-Mon match halved: four-way tie on everything.
  const even = { sat: teamScores([4, 4, 4, 4]), sun: teamScores([4, 4, 4, 4]), mon: teamScores([4, 4, 4, 4]) };
  let tue = resolveConfig(cfg, even).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.pending, true);
  assert.equal(tue.needsPuttoff, true);
  const c = { ...cfg, puttoffs: { seed: { '0-1-2-3': [3, 2] } } };
  tue = resolveConfig(c, even).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.pending, undefined);
  assert.deepEqual(tue.groups.map((g) => g.teams), [[3, 2], [0, 1]]);
});

test('match streak counts holes won in a row from the latest hole', () => {
  const m = buildMatches(cfg).find((x) => x.id === 'sat-g1-s1'); // Tate v Sam, back 9
  // 10 Tate, 11 halve, 12 Sam, 13 Sam
  let r = computeMatch(m, { tate: holes([3, 4, 5, 5], 10), sam: holes([4, 4, 4, 4], 10) });
  assert.deepEqual(matchStreak(r), { side: 1, n: 2 });
  r = computeMatch(m, { tate: holes([3, 4], 10), sam: holes([4, 4], 10) }); // ends on a halve
  assert.equal(matchStreak(r), null);
  r = computeMatch(m, { tate: holes([3, 3, 3, 4], 10), sam: holes([4, 4, 4, 4], 10) });
  assert.deepEqual(longestMatchRun(r), { side: 0, n: 3 });
});

test('birdie streak needs consecutive holes ending at the latest one', () => {
  // Circling Raven pars: 1=5, 2=4, 3=3, 4=4
  assert.equal(birdieStreak(cfg, 'sat', { 1: 4, 2: 3 }), 2);
  assert.equal(birdieStreak(cfg, 'sat', { 1: 4, 2: 3, 3: 3 }), 0); // par on 3 ends it
  assert.equal(birdieStreak(cfg, 'sat', { 1: 4, 3: 2 }), 1); // hole 2 missing
  assert.equal(longestBirdieRun(cfg, { sat: { tate: { 1: 4, 2: 3, 3: 2, 4: 4 } } }, 'tate'), 3);
});

test('highlights: birdies, eagles, birdie runs, 3-hole runs and match results', () => {
  const nine = (v, start) => holes(Array(9).fill(v), start);
  const scores = { sat: {
    // Tate: birdie on 1 and 2 (pars 5, 4), eagle on 5 (par 5)
    tate: { ...holes([4, 3, 3, 4, 3, 4, 3, 4, 4], 1), ...nine(3, 10) },
    garrett: { ...nine(5, 1), ...nine(5, 10) },
    sam: { ...nine(5, 1), ...nine(4, 10) },
    jonah: { ...nine(5, 1), ...nine(4, 10) },
  } };
  const times = { sat: { tate: { 1: 1000, 2: 2000, 5: 5000 } } };
  const hl = highlights(cfg, scores, times);
  const ids = hl.map((h) => h.id);
  assert.ok(ids.includes('hl-sat-tate-1-birdie'));
  assert.ok(ids.includes('hl-sat-tate-1-run')); // birdies on 1-2, keyed by the first hole
  assert.equal(hl.find((h) => h.id === 'hl-sat-tate-1-run').n, 2);
  assert.ok(ids.includes('hl-sat-tate-5-eagle'));
  assert.ok(ids.includes('hl-sat-g1-bb-final'));
  // Tate wins every back-nine hole: one growing item, not one per hole.
  const runs = hl.filter((h) => h.type === 'holeRun' && h.match.id === 'sat-g1-s1');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].n, 5); // closed out 5&4 after 5 holes
  assert.equal(hl[0].id, 'hl-sat-tate-5-eagle'); // newest first
});
