import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatches, computeMatch, computeStandings, sideScore, scoreMark, birdieCounts, rankTeams, resolveConfig,
  matchStreak, birdieStreak, highlights, longestBirdieRun, longestMatchRun,
  captainRound, draftState, computeSkins, settleUp, roundPoints, tueDraftState, bonusPoints,
} from '../js/scoring.js';
import { DEFAULT_CONFIG, PLAYERS, ROTATION } from '../js/data.js';

const IDS = PLAYERS.map((p) => p.id);
const holes = (arr, start = 1) => Object.fromEntries(arr.map((v, i) => [start + i, v]));
const nine = (v, start) => holes(Array(9).fill(v), start);

// Teams as if drafted: captain first, then picks in order.
const TEAMS = [
  { name: 'Team Tate', color: '#2f7d4f', players: ['tate', 'sam', 'josh', 'jp'] },
  { name: 'Team Garrett', color: '#1f5f99', players: ['garrett', 'jonah', 'brody', 'skyler'] },
];
// Most tests score gross (everyone a 3); the handicap tests use the real buckets.
const GROSS = Object.fromEntries(IDS.map((p) => [p, 3]));
const cfg = { ...structuredClone(DEFAULT_CONFIG), teams: TEAMS, hcp: GROSS };
const hcpCfg = { ...structuredClone(DEFAULT_CONFIG), teams: TEAMS };
const view = (scores = {}, c = cfg) => resolveConfig(c, scores);
const matchesOf = (scores = {}, c = cfg) => buildMatches(view(scores, c));

test('rotation: everyone partners each teammate once and plays 3 different opponents', () => {
  const partners = {};
  const opponents = {};
  const add = (map, a, b) => { (map[a] ||= []).push(b); };
  for (const day of ['sat', 'sun', 'mon']) {
    for (const g of ROTATION[day]) {
      add(partners, `a${g.a[0]}`, `a${g.a[1]}`); add(partners, `a${g.a[1]}`, `a${g.a[0]}`);
      add(partners, `b${g.b[0]}`, `b${g.b[1]}`); add(partners, `b${g.b[1]}`, `b${g.b[0]}`);
      [0, 1].forEach((i) => { add(opponents, `a${g.a[i]}`, g.b[i]); add(opponents, `b${g.b[i]}`, g.a[i]); });
    }
  }
  for (const list of Object.values(partners)) assert.equal(new Set(list).size, 3);
  for (const list of Object.values(opponents)) assert.equal(new Set(list).size, 3);
});

test('before the draft every scoring round waits and there are no matches', () => {
  const c = structuredClone(DEFAULT_CONFIG);
  const v = resolveConfig(c, {});
  assert.ok(v.rounds.filter((r) => r.format !== 'stroke').every((r) => r.pending && r.waitingOn === 'draft'));
  assert.equal(buildMatches(v).length, 0);
});

test('after the draft: 6 matches a day Sat-Mon plus Quicksands; Tuesday waits', () => {
  const matches = matchesOf();
  assert.equal(matches.length, 3 * 6 + 3);
  const sat = matches.filter((m) => m.roundId === 'sat');
  assert.deepEqual(sat.map((m) => m.type), ['bestball', 'singles', 'singles', 'bestball', 'singles', 'singles']);
  assert.deepEqual(sat[0].sides.map((s) => s.players), [['tate', 'sam'], ['garrett', 'jonah']]);
  assert.deepEqual(sat[1].sides.map((s) => s.players[0]), ['tate', 'garrett']);
  const qs = matches.find((m) => m.roundId === 'qs');
  assert.equal(qs.type, 'teamstroke');
  assert.equal(qs.holes.length, 14);
  assert.ok(matches.some((m) => m.roundId === 'qs' && m.type === 'teambirdies'));
  assert.equal(view().rounds.find((r) => r.id === 'tue').waitingOn, 'standings');
  const total = cfg.rounds.reduce((a, r) => a + roundPoints(r), 0);
  assert.equal(total, 29);
});

test('best ball takes the low score and ignores pickups', () => {
  const s = { tate: { 1: 5 }, garrett: { 1: 4 }, sam: {}, jonah: { 1: 6 } };
  assert.equal(sideScore(s, ['tate', 'garrett'], 1), 4);
  assert.equal(sideScore(s, ['sam', 'jonah'], 1), 6);
  assert.equal(sideScore(s, ['sam'], 1), null);
});

test('in-progress best ball status', () => {
  const m = matchesOf()[0]; // tate & sam v garrett & jonah
  const scores = {
    tate: holes([4, 5, 4]), sam: holes([5, 3, 5]),
    garrett: holes([5, 4, 4]), jonah: holes([4, 5, 6]),
  };
  const r = computeMatch(m, scores);
  assert.equal(r.played, 3);
  assert.equal(r.diff, 1);
  assert.equal(r.status, '1 UP');
  assert.equal(r.points, null);
  assert.deepEqual(r.projected, [1, 0]);
});

test('match closes out early, dormie and halved finals', () => {
  const m = matchesOf()[1]; // tate v garrett, back 9
  let r = computeMatch(m, { tate: holes([3, 3, 3, 3, 4, 4, 4, 9, 9], 10), garrett: holes([4, 4, 4, 4, 4, 4, 4, 3, 3], 10) });
  assert.equal(r.status, 'Won 4&3');
  assert.deepEqual(r.points, [1, 0]);
  r = computeMatch(m, { tate: holes([3, 3, 4, 4, 4, 4, 4], 10), garrett: holes([4, 4, 4, 4, 4, 4, 4], 10) });
  assert.equal(r.status, '2 UP · Dormie');
  r = computeMatch(m, { tate: nine(4, 10), garrett: nine(4, 10) });
  assert.equal(r.status, 'Halved');
  assert.deepEqual(r.points, [0.5, 0.5]);
  r = computeMatch(m, { tate: holes([...Array(8).fill(4), 3], 10), garrett: nine(4, 10) });
  assert.equal(r.status, 'Won 1 UP');
});

test('standings add up across a day', () => {
  // Group 1: Tate & Sam win best ball; Tate halves Garrett; Sam loses to Jonah.
  const sat = {
    tate: { ...nine(4, 1), ...nine(4, 10) }, sam: { ...nine(5, 1), ...nine(5, 10) },
    garrett: { ...nine(5, 1), ...nine(4, 10) }, jonah: { ...nine(5, 1), ...nine(4, 10) },
  };
  const { teams, players } = computeStandings(view({ sat }), { sat });
  assert.equal(teams[0].points, 1.5);
  assert.equal(teams[1].points, 1.5);
  assert.equal(players.tate.points, 1.5);
  assert.equal(players.jonah.points, 1);
  assert.deepEqual([teams[0].w, teams[0].l, teams[0].h], [1, 1, 1]);
});

test('course pars match the scorecard totals', () => {
  const total = (id) => Object.values(cfg.pars[id]).reduce((a, b) => a + b, 0);
  assert.deepEqual(['fri', 'sat', 'sun', 'qs', 'mon', 'tue'].map(total), [71, 72, 71, 42, 72, 71]);
});

test('score marks relative to par', () => {
  assert.equal(scoreMark(2, 4), 'eagle');
  assert.equal(scoreMark(1, 3), 'eagle');
  assert.equal(scoreMark(3, 4), 'birdie');
  assert.equal(scoreMark(4, 4), 'par');
  assert.equal(scoreMark(5, 4), 'bogey');
  assert.equal(scoreMark(9, 4), 'double');
  assert.equal(scoreMark(null, 4), '');
});

test('birdie counts use each round\'s pars, skip Friday and disabled rounds', () => {
  const c = structuredClone(cfg);
  const scores = {
    fri: { tate: { 4: 2 } }, // Indian Canyon 4 is a par 3
    sat: { tate: { 12: 4, 13: 2, 1: 4, 2: 5 }, sam: { 12: 3 } },
    sun: { tate: { 1: 3 } },
  };
  let counts = birdieCounts(c, scores, IDS);
  assert.equal(counts.tate.birdies, 4);
  assert.equal(counts.sam.birdies, 1);
  c.rounds.find((r) => r.id === 'sun').enabled = false;
  counts = birdieCounts(c, scores, IDS);
  assert.equal(counts.tate.birdies, 3);
});

test('a hole only counts once everyone in the match has a score', () => {
  const m = matchesOf()[0]; // tate & sam v garrett & jonah, front 9
  // Tate made 3 but Sam hasn't entered hole 1 yet: nothing decided.
  let r = computeMatch(m, { tate: holes([3]), garrett: holes([4]), jonah: holes([4]) });
  assert.equal(r.played, 0);
  r = computeMatch(m, { tate: holes([3]), sam: holes([5]), garrett: holes([4]), jonah: holes([4]) });
  assert.equal(r.played, 1);
  assert.equal(r.status, '1 UP');
});

test('Quicksands team stroke play: live on score to par, 2 points, a tie is 1 each', () => {
  const m = matchesOf().find((x) => x.roundId === 'qs');
  const fourteen = (v) => holes(Array(14).fill(v));
  const scores = {};
  TEAMS[0].players.forEach((p) => { scores[p] = fourteen(3); });
  TEAMS[1].players.forEach((p) => { scores[p] = fourteen(3); });
  scores.skyler = fourteen(4); // +14 for Team Garrett
  let r = computeMatch(m, scores);
  assert.equal(r.done, true);
  assert.deepEqual(r.points, [2, 0]);
  assert.equal(r.status, 'Won by 14');
  // Live: Team Tate's group is through 2 at +2, Team Garrett's through 7 at even.
  const live = {
    tate: holes([4, 4]), sam: holes([3, 3]), josh: holes([3, 3]), jp: holes([3, 3]),
    garrett: holes(Array(7).fill(3)), jonah: holes(Array(7).fill(3)), brody: holes(Array(7).fill(3)), skyler: holes(Array(7).fill(3)),
  };
  r = computeMatch(m, live);
  assert.equal(r.leader, 1);
  assert.equal(r.up, 2);
  assert.equal(r.played, 2);
  assert.deepEqual(r.projected, [0, 2]);
  scores.skyler = fourteen(3);
  r = computeMatch(m, scores);
  assert.deepEqual(r.points, [1, 1]);
});

test('Captain Round: low two are captains; back 9, then a putt-off, breaks ties', () => {
  const eighteen = (front, back) => ({ ...nine(front, 1), ...nine(back, 10) });
  const scores = {
    fri: {
      tate: eighteen(4, 4), // 72
      garrett: eighteen(5, 3), // 72, better back 9
      sam: eighteen(4, 5), jonah: eighteen(5, 5), josh: eighteen(5, 5), brody: eighteen(6, 5),
    },
  };
  let cr = captainRound(cfg, scores);
  assert.equal(cr.allDone, true);
  assert.deepEqual(cr.captains, ['garrett', 'tate']);
  assert.equal(cr.rows[0].tiebreak, 'Back 9');

  // Live: not everyone is done, so no captains yet; sorted by score to par.
  delete scores.fri.brody[18];
  cr = captainRound(cfg, scores);
  assert.equal(cr.captains, null);
  scores.fri.brody[18] = 5;

  // Dead even (total and back 9) for 2nd: putt-off.
  scores.fri.tate = eighteen(5, 3);
  cr = captainRound(cfg, scores);
  assert.equal(cr.captains, null);
  assert.deepEqual(cr.puttoff.players.sort(), ['garrett', 'tate']);
  const c = { ...cfg, puttoffs: { captain: { [cr.puttoff.key]: ['tate'] } } };
  cr = captainRound(c, scores);
  assert.deepEqual(cr.captains, ['tate', 'garrett']);

  // A tie further down the board doesn't need a putt-off.
  scores.fri.tate = eighteen(4, 4);
  scores.fri.brody = eighteen(5, 5);
  cr = captainRound(cfg, scores);
  assert.deepEqual(cr.captains, ['garrett', 'tate']);
  assert.equal(cr.puttoff, null);
});

test('draft: low score picks first, then alternate; everyone ends up on a team', () => {
  const c = { ...structuredClone(DEFAULT_CONFIG), draft: { captains: ['sam', 'jp'], picks: ['tate', 'skyler', 'josh'] } };
  let d = draftState(c, {}, IDS);
  assert.equal(d.stage, 'drafting');
  assert.equal(d.manual, true);
  assert.deepEqual(d.rosters, [['sam', 'tate', 'josh'], ['jp', 'skyler']]);
  assert.equal(d.turn, 1);
  assert.deepEqual(d.pool.sort(), ['brody', 'garrett', 'jonah']);
  c.draft.picks.push('garrett', 'jonah', 'brody');
  d = draftState(c, {}, IDS);
  assert.equal(d.stage, 'done');
  assert.deepEqual(d.rosters, [['sam', 'tate', 'josh', 'jonah'], ['jp', 'skyler', 'garrett', 'brody']]);
  // No captains yet without Friday scores or a manual pick.
  assert.equal(draftState(structuredClone(DEFAULT_CONFIG), {}, IDS).stage, 'captains');
});

// Every player on a team shoots the same score on every hole.
const teamRound = (a, b, n = 18) => {
  const out = {};
  TEAMS[0].players.forEach((p) => { out[p] = holes(Array(n).fill(a)); });
  TEAMS[1].players.forEach((p) => { out[p] = holes(Array(n).fill(b)); });
  return out;
};

test('Tuesday: waits for every earlier match, then the leader sets the matchups; 8 points', () => {
  const scores = { sat: teamRound(4, 5), sun: teamRound(4, 5), qs: teamRound(3, 3, 14), mon: teamRound(4, 5) };
  delete scores.qs.jp[14];
  let tue = view(scores).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.pending, true);
  assert.equal(tue.waitingOn, 'standings');
  assert.equal(tue.leaderNow, 0);

  scores.qs.jp[14] = 3;
  tue = view(scores).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.leader, 0);
  assert.equal(tue.needsPicks, true);

  const c = { ...cfg, tuePicks: { pairs: [['tate', 'skyler'], ['sam', 'brody'], ['josh', 'garrett'], ['jp', 'jonah']] } };
  tue = view(scores, c).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.pending, undefined);
  assert.deepEqual(tue.groups[0], { a: ['tate', 'sam'], b: ['skyler', 'brody'] });

  // Team Tate wins everything on the front, Team Garrett everything on the back.
  scores.tue = {};
  TEAMS[0].players.forEach((p) => { scores.tue[p] = { ...nine(3, 1), ...nine(5, 10) }; });
  TEAMS[1].players.forEach((p) => { scores.tue[p] = { ...nine(5, 1), ...nine(3, 10) }; });
  const tueMatches = buildMatches(view(scores, c)).filter((m) => m.roundId === 'tue');
  assert.equal(tueMatches.length, 8);
  const back = tueMatches.find((m) => m.id === 'tue-g1-b1');
  assert.deepEqual(back.sides.map((s) => s.players[0]), ['tate', 'brody']); // opponents swap
  const pts = [0, 0];
  tueMatches.forEach((m) => computeMatch(m, scores.tue).points.forEach((p, si) => { pts[m.sides[si].team] += p; }));
  assert.deepEqual(pts, [4, 4]);
});

test('Tuesday: level after every tiebreaker needs a putt-off to pick the leader', () => {
  const even = { sat: teamRound(4, 4), sun: teamRound(4, 4), qs: teamRound(3, 3, 14), mon: teamRound(4, 4) };
  let tue = view(even).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.needsPuttoff, true);
  const c = { ...cfg, puttoffs: { seed: { '0-1': [1] } } };
  tue = view(even, c).rounds.find((r) => r.id === 'tue');
  assert.equal(tue.leader, 1);
  assert.equal(tue.needsPicks, true);
});

test('tiebreakers: most wins, then holes-up margin (no head-to-head with two teams)', () => {
  const last3 = (v) => holes([...Array(8).fill(4), v], 10);
  const sat = {
    // G1: Tate & Sam win best ball 5&4, Tate beats Garrett 5&4, Jonah beats Sam 5&4.
    tate: { ...nine(3, 1), ...nine(3, 10) }, sam: { ...nine(3, 1), ...nine(5, 10) },
    garrett: { ...nine(4, 1), ...nine(4, 10) }, jonah: { ...nine(4, 1), ...nine(4, 10) },
    // G2: Brody & Skyler win best ball 1 UP, Josh beats Brody 1 UP, Skyler beats JP 1 UP.
    josh: { ...nine(4, 1), ...last3(3) }, jp: { ...nine(4, 1), ...nine(4, 10) },
    brody: { ...holes([...Array(8).fill(4), 3], 1), ...nine(4, 10) }, skyler: { ...nine(4, 1), ...last3(3) },
  };
  const { ranked, ties } = rankTeams(view({ sat }), { sat }, ['sat']);
  assert.deepEqual(ranked.map((t) => [t.idx, t.points, t.wins, t.margin]), [[0, 3, 3, 4], [1, 3, 3, -4]]);
  assert.deepEqual(ties[0].steps.map((st) => st.key), ['wins', 'margin']);
  assert.equal(ranked[0].tiebreak, 'Holes-up margin');
});

test('dead even after every tiebreaker goes to a putt-off', () => {
  const sat = teamRound(4, 4);
  let { ranked, ties } = rankTeams(view({ sat }), { sat }, ['sat']);
  assert.ok(ranked.every((t) => t.unresolved && t.rank === 1));
  assert.deepEqual(ties[0].pending[0].teams.sort(), [0, 1]);
  const c = { ...cfg, puttoffs: { final: { '0-1': [1] } } };
  ({ ranked } = rankTeams(view({ sat }, c), { sat }, ['sat']));
  assert.deepEqual(ranked.map((t) => [t.idx, t.rank, t.unresolved]), [[1, 1, false], [0, 2, false]]);
});

test('skins: par 3s (every hole at Quicksands), outright low only, $5 from each of the other 7', () => {
  const c = cfg;
  const scores = {
    // Circling Raven par 3s: 3, 7, 13, 16. Hole 1 is a par 5 (no skin).
    sat: {},
    qs: {},
  };
  IDS.forEach((p) => { scores.sat[p] = { 1: 4, 3: 3, 7: 3, 13: 3 }; scores.qs[p] = { 1: 3 }; });
  scores.sat.tate[3] = 2; // outright: skin
  scores.sat.sam[7] = 2; scores.sat.jp[7] = 2; // tie for low: no skin
  delete scores.sat.skyler[13]; // not everyone in yet
  scores.qs.josh[1] = 2; // Quicksands skin
  scores.sat.garrett[1] = 3; // par 5, no skin
  const { holes: rows, net } = computeSkins(c, scores, IDS);
  const row = (rid, h) => rows.find((r) => r.roundId === rid && r.hole === h);
  assert.equal(row('sat', 1), undefined);
  assert.equal(row('sat', 3).winner, 'tate');
  assert.deepEqual(row('sat', 7).tied.sort(), ['jp', 'sam']);
  assert.deepEqual(row('sat', 13).waiting, ['skyler']);
  assert.equal(row('qs', 1).winner, 'josh');
  assert.equal(rows.filter((r) => r.roundId === 'qs').length, 14);
  assert.equal(net.tate, 35 - 5);
  assert.equal(net.josh, 35 - 5);
  assert.equal(net.sam, -10);
  assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0);
  const pay = settleUp(net);
  const after = { ...net };
  pay.forEach(({ from, to, amount }) => { after[from] += amount; after[to] -= amount; });
  assert.ok(Object.values(after).every((v) => v === 0));
  assert.ok(pay.length <= 7);
});

test('match streak counts holes won in a row from the latest hole', () => {
  const m = matchesOf().find((x) => x.id === 'sat-g1-s1'); // Tate v Garrett, back 9
  let r = computeMatch(m, { tate: holes([3, 4, 5, 5], 10), garrett: holes([4, 4, 4, 4], 10) });
  assert.deepEqual(matchStreak(r), { side: 1, n: 2 });
  r = computeMatch(m, { tate: holes([3, 4], 10), garrett: holes([4, 4], 10) });
  assert.equal(matchStreak(r), null);
  r = computeMatch(m, { tate: holes([3, 3, 3, 4], 10), garrett: holes([4, 4, 4, 4], 10) });
  assert.deepEqual(longestMatchRun(r), { side: 0, n: 3 });
});

test('birdie streak needs consecutive holes ending at the latest one', () => {
  // Circling Raven pars: 1=5, 2=4, 3=3, 4=4
  assert.equal(birdieStreak(cfg, 'sat', { 1: 4, 2: 3 }), 2);
  assert.equal(birdieStreak(cfg, 'sat', { 1: 4, 2: 3, 3: 3 }), 0);
  assert.equal(birdieStreak(cfg, 'sat', { 1: 4, 3: 2 }), 1);
  assert.equal(longestBirdieRun(cfg, { sat: { tate: { 1: 4, 2: 3, 3: 2, 4: 4 } } }, 'tate'), 3);
});

test('highlights: birdies, eagles, birdie runs, 3-hole runs, match results and Quicksands', () => {
  const scores = { sat: {
    tate: { ...holes([4, 3, 3, 4, 3, 4, 3, 4, 4], 1), ...nine(3, 10) },
    sam: { ...nine(5, 1), ...nine(5, 10) },
    garrett: { ...nine(5, 1), ...nine(4, 10) },
    jonah: { ...nine(5, 1), ...nine(4, 10) },
  }, qs: teamRound(3, 4, 14) };
  const times = { sat: { tate: { 1: 1000, 2: 2000, 5: 5000 } } };
  const hl = highlights(view(scores), scores, times, IDS);
  const ids = hl.map((h) => h.id);
  assert.ok(ids.includes('hl-sat-tate-1-birdie'));
  assert.equal(hl.find((h) => h.id === 'hl-sat-tate-1-run').n, 2);
  assert.ok(ids.includes('hl-sat-tate-5-eagle'));
  assert.ok(ids.includes('hl-sat-g1-bb-final'));
  assert.ok(ids.includes('hl-qs-team-final'));
  const runs = hl.filter((h) => h.type === 'holeRun' && h.match.id === 'sat-g1-s1');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].n, 5);
  assert.equal(hl[0].id, 'hl-sat-tate-5-eagle');
});

test('a hole in one is its own highlight and counts as a birdie', () => {
  const scores = { sat: { tate: { 3: 1 } }, fri: { sam: { 4: 1 } } };
  const ids = highlights(view(scores), scores, {}, IDS).map((h) => h.id);
  assert.ok(ids.includes('hl-sat-tate-3-ace'));
  assert.ok(ids.includes('hl-fri-sam-4-ace'));
  const counts = birdieCounts(cfg, scores, IDS);
  assert.equal(counts.tate.birdies, 1);
  assert.equal(counts.sam.birdies, 0); // Friday's ace doesn't count on the Birdie Board
});

test('Tuesday matchup draft: trailing team puts out first, leader answers twice, match 4 fills in', () => {
  // Team Tate (0) leads; Team Garrett (1) trails.
  const c = { ...cfg, tueDraft: { moves: ['garrett', 'tate', 'sam', 'jonah', 'brody', 'josh'] } };
  let d = tueDraftState({ ...cfg, tueDraft: { moves: [] } }, 0);
  assert.deepEqual(d.turn, { match: 0, role: 'out', team: 1, out: null });
  d = tueDraftState({ ...cfg, tueDraft: { moves: ['garrett'] } }, 0);
  assert.deepEqual(d.turn, { match: 0, role: 'answer', team: 0, out: 'garrett' });
  // A player from the wrong team (or used twice) stops the sequence there.
  assert.equal(tueDraftState({ ...cfg, tueDraft: { moves: ['tate'] } }, 0).moves.length, 0);
  d = tueDraftState(c, 0);
  assert.equal(d.done, true);
  assert.deepEqual(d.front, [['tate', 'garrett'], ['sam', 'jonah'], ['josh', 'brody'], ['jp', 'skyler']]);
  assert.deepEqual(d.pairs, d.front);
  // Group 1: front 9 Tate v Garrett and Sam v Jonah, so the back 9 is Tate v Jonah and Sam v Garrett.
  assert.deepEqual(d.back, [['tate', 'jonah'], ['sam', 'garrett'], ['josh', 'skyler'], ['jp', 'brody']]);
  const scores = {};
  const v = resolveConfig({ ...cfg, tuePicks: { pairs: d.pairs } }, scores);
  const tue = v.rounds.find((r) => r.id === 'tue');
  const backMatches = buildMatches({ ...v, rounds: [{ ...tue, pending: false, groups: [0, 1].map((gi) => ({ a: [d.pairs[gi * 2][0], d.pairs[gi * 2 + 1][0]], b: [d.pairs[gi * 2][1], d.pairs[gi * 2 + 1][1]] })) }] })
    .filter((m) => m.holes[0] === 10).map((m) => m.sides.map((s) => s.players[0]));
  assert.deepEqual(backMatches, d.back);
});

test('Quicksands birdie point: most gross birdies (eagles count), a tie splits it; round is worth 3', () => {
  const m = matchesOf().find((x) => x.roundId === 'qs' && x.type === 'teambirdies');
  const fourteen = (v) => holes(Array(14).fill(v));
  const scores = Object.fromEntries(IDS.map((p) => [p, fourteen(3)]));
  scores.tate[1] = 2; scores.sam[2] = 1; // 2 for Team Tate (an ace counts)
  scores.garrett[3] = 2;
  let r = computeMatch(m, scores);
  assert.equal(r.done, true);
  assert.deepEqual(r.points, [1, 0]);
  scores.jonah[4] = 2;
  r = computeMatch(m, scores);
  assert.deepEqual(r.points, [0.5, 0.5]);
  delete scores.jp[14];
  assert.equal(computeMatch(m, scores).done, false);
  assert.equal(roundPoints(cfg.rounds.find((x) => x.id === 'qs')), 3);
});

test('handicaps: 12s get 4 strokes a nine on the hardest holes, off the low man in the match', () => {
  const ms = matchesOf({}, hcpCfg).filter((m) => m.roundId === 'sat');
  // Saturday group 1: best ball Tate & Sam v Garrett & Jonah. Sam (12) gets 4 on the front.
  const bb = ms.find((m) => m.id === 'sat-g1-bb');
  assert.deepEqual(Object.keys(bb.strokes), ['sam']);
  // Circling Raven front 9 hole handicaps: 7,11,15,1,5,13,17,9,3 → hardest are 4, 9, 5, 1.
  assert.deepEqual(bb.strokes.sam, [1, 4, 5, 9]);
  // Singles Tate (3) v Garrett (3): none. Sam (12) v Jonah (3): Sam gets 4 on the back.
  assert.deepEqual(ms.find((m) => m.id === 'sat-g1-s1').strokes, {});
  const s2 = ms.find((m) => m.id === 'sat-g1-s2');
  assert.deepEqual(s2.strokes.sam, [12, 15, 17, 11].sort((a, b) => a - b));
  // Group 2: Josh & JP (both 12) v Brody & Skyler (3s): both 12s get 4.
  const bb2 = ms.find((m) => m.id === 'sat-g2-bb');
  assert.deepEqual(Object.keys(bb2.strokes).sort(), ['josh', 'jp']);
  // 12 v 12 in singles: no strokes.
  const c = { ...hcpCfg, hcp: { ...hcpCfg.hcp, brody: 12 } };
  assert.deepEqual(matchesOf({}, c).find((m) => m.id === 'sat-g2-s1').strokes, {});
});

test('handicaps: a net bogey halves a par on a stroke hole; the 3 needs a birdie', () => {
  const m = matchesOf({}, hcpCfg).find((x) => x.id === 'sat-g1-s2'); // Sam (12) v Jonah (3), back 9
  const scores = { sam: { 12: 6 }, jonah: { 12: 5 } }; // hole 12 is a stroke hole, par 5
  let r = computeMatch(m, scores);
  assert.equal(r.holes[2].winner, 'halve');
  scores.jonah[12] = 4;
  r = computeMatch(m, scores);
  assert.equal(r.holes[2].winner, 1);
  // Not a stroke hole: gross.
  scores.sam[10] = 5; scores.jonah[10] = 4;
  assert.equal(computeMatch(m, scores).holes[0].winner, 1);
});

test('handicaps: best ball uses the 12\'s net score', () => {
  const m = matchesOf({}, hcpCfg).find((x) => x.id === 'sat-g1-bb');
  // Hole 4 (par 4) is a stroke hole for Sam: his 4 is a net 3, beating Garrett's 4.
  const scores = { tate: { 4: 5 }, sam: { 4: 4 }, garrett: { 4: 4 }, jonah: { 4: 5 } };
  assert.equal(computeMatch(m, scores).holes[3].winner, 0);
});

test('handicaps at Quicksands: each 12 takes 4 off his total; birdies stay gross', () => {
  const m = matchesOf({}, hcpCfg).find((x) => x.roundId === 'qs' && x.type === 'teamstroke');
  const fourteen = (v) => holes(Array(14).fill(v));
  const scores = Object.fromEntries(IDS.map((p) => [p, fourteen(3)]));
  // Team Tate has three 12s (Sam, Josh, JP): 12 strokes off.
  assert.deepEqual(m.allowance, { sam: 4, josh: 4, jp: 4 });
  // The strokes are in from the first tee: through one hole at par, Team Tate is 12 under net.
  const one = Object.fromEntries(IDS.map((p) => [p, { 1: 3 }]));
  const live = computeMatch(m, one);
  assert.equal(live.sides[0].toPar, -12);
  assert.equal(live.leader, 0);
  scores.sam = fourteen(4); // +14 gross, 10 net
  let r = computeMatch(m, scores);
  assert.equal(r.sides[0].strokes, 56 * 3 + 14);
  assert.equal(r.sides[0].net, 56 * 3 + 14 - 12);
  assert.equal(r.leader, 1);
  assert.equal(r.status, 'Won by 2');
  scores.sam = fourteen(3);
  scores.josh[1] = 5; // +2 gross, but still 10 under net
  r = computeMatch(m, scores);
  assert.equal(r.leader, 0);
  const b = matchesOf({}, hcpCfg).find((x) => x.roundId === 'qs' && x.type === 'teambirdies');
  assert.equal(computeMatch(b, scores).leader, null); // no net birdies
});

test('handicaps don\'t touch skins, birdies or Friday', () => {
  const scores = { sat: Object.fromEntries(IDS.map((p) => [p, { ...cfg.pars.sat }])) };
  scores.sat.sam[3] = 3; scores.sat.tate[3] = 3; // par 3: tie, no skin (no net for Sam)
  const sk = computeSkins(view(scores, hcpCfg), scores, IDS);
  assert.equal(sk.holes.find((h) => h.roundId === 'sat' && h.hole === 3).winner, null);
  assert.equal(birdieCounts(view(scores, hcpCfg), scores, IDS).sam.birdies, 0);
});

test('Quicksands hole in one: a bonus point for the team, banked right away, not a match win', () => {
  const v = view();
  const m = buildMatches(v).find((x) => x.type === 'teamaces');
  const scores = { qs: { tate: { 1: 3, 2: 1 }, sam: { 1: 1 }, garrett: { 5: 1 } } };
  const r = computeMatch(m, scores.qs);
  assert.deepEqual(r.points, [2, 1]);
  assert.equal(r.done, true);
  assert.equal(bonusPoints(v, scores), 3);
  const st = computeStandings(v, scores);
  assert.equal(st.teams[0].points, 2);
  assert.equal(st.teams[0].w + st.teams[0].l + st.teams[0].h, 0);
  assert.equal(st.players.tate.points, 0.5); // split four ways like the rest of Quicksands
  assert.equal(bonusPoints(v, {}), 0);
});
