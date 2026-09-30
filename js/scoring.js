// Pure scoring logic. No DOM, no storage — easy to test.

export const FRONT_NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const BACK_NINE = [10, 11, 12, 13, 14, 15, 16, 17, 18];

export const POINTS = { win: 1, halve: 0.5, loss: 0 };
// Quicksands: team stroke play is worth 2, plus 1 for the team with the most
// birdies. Tuesday's singles are worth 1 on each nine.
export const TEAMSTROKE_POINTS = 2;
export const BIRDIE_POINTS = 1;
export const ESCALATING_BACK_POINTS = 1;

// Handicaps: everyone is a 3 or a 12. In a match, a 12 gets STROKES_PER_NINE
// strokes a nine off the lowest player in the match, on the hardest holes of
// that nine. At Quicksands (team stroke play) each 12 takes TEAMSTROKE_STROKES
// off his total. Skins, birdies and Friday are always gross.
export const HCP_BUCKETS = [3, 12];
export const STROKES_PER_NINE = 4;
export const TEAMSTROKE_STROKES = 4;
const TEAM_TYPES = ['teamstroke', 'teambirdies'];
export const isTeamMatch = (m) => TEAM_TYPES.includes(m.type);

// Holes in a round (18, or 14 at Quicksands), and its two halves.
export const holesOf = (round) => Array.from({ length: round?.holes || 18 }, (_, i) => i + 1);
export function halvesOf(round) {
  const all = holesOf(round);
  const n = Math.ceil(all.length / 2);
  return [all.slice(0, n), all.slice(n)];
}

// Everyone in a tee group, with their team (0 or 1, or -1 before the draft).
export function groupRoster(group) {
  if (group.players) return group.players.map((id) => ({ id, team: -1 }));
  return [...(group.a || []).map((id) => ({ id, team: 0 })), ...(group.b || []).map((id) => ({ id, team: 1 }))];
}

// Most points a round is worth, across both teams.
export function roundPoints(round) {
  if (round.format === 'match') return 6;
  if (round.format === 'teamstroke') return TEAMSTROKE_POINTS + BIRDIE_POINTS;
  if (round.format === 'escalating') return 2 * (2 * POINTS.win + 2 * ESCALATING_BACK_POINTS);
  return 0;
}

const hcpOf = (config, pid) => config.hcp?.[pid] ?? HCP_BUCKETS[0];

// The n hardest holes (lowest hole handicap) among `holes`.
export function hardestHoles(config, roundId, holes, n) {
  const idx = config.holeHcp?.[roundId];
  if (!idx) return [];
  return [...holes].sort((a, b) => idx[a - 1] - idx[b - 1]).slice(0, n).sort((a, b) => a - b);
}

// Stroke holes for each player in a match: { playerId: [holes] }. Anyone
// above the lowest handicap in the match gets STROKES_PER_NINE on the nine.
function matchStrokes(config, roundId, holes, players) {
  const low = Math.min(...players.map((p) => hcpOf(config, p)));
  const where = hardestHoles(config, roundId, holes, STROKES_PER_NINE);
  const out = {};
  for (const p of players) if (hcpOf(config, p) > low && where.length) out[p] = where;
  return out;
}

// Quicksands has no stroke holes: each 12 takes TEAMSTROKE_STROKES off his
// total, counted from the first tee so the live score is net all the way.
function teamStrokeAllowance(config, players) {
  const out = {};
  for (const p of players) if (hcpOf(config, p) > HCP_BUCKETS[0]) out[p] = TEAMSTROKE_STROKES;
  return out;
}

// Score after handicap strokes (one per stroke hole).
export function netScore(match, playerId, hole, gross) {
  if (!isScore(gross)) return gross;
  return gross - (match?.strokes?.[playerId]?.includes(hole) ? 1 : 0);
}

// Matches for every enabled round whose matchups are set (see resolveConfig):
// - match: per group, best ball a v b on the front, two singles on the back
// - teamstroke: one team-vs-team match over every hole, plus most birdies
// - escalating: per group, two singles on the front, opponents swap for the back (1 pt each)
// Each match carries `strokes`: { playerId: [holes] } where he gets a stroke.
export function buildMatches(config) {
  const matches = [];
  for (const round of config.rounds) {
    if (!round.enabled || round.pending) continue;
    const [front, back] = halvesOf(round);
    if (round.format === 'teamstroke') {
      if (config.teams?.length !== 2) continue;
      const holes = holesOf(round);
      const sides = config.teams.map((t, team) => ({ team, players: [...t.players] }));
      matches.push({
        roundId: round.id, group: -1, id: `${round.id}-team`, type: 'teamstroke', label: `Team stroke play · Net · ${TEAMSTROKE_POINTS} pts`,
        weight: TEAMSTROKE_POINTS, holes, pars: config.pars?.[round.id] || {}, sides,
        strokes: {}, allowance: teamStrokeAllowance(config, sides.flatMap((sd) => sd.players)),
      });
      matches.push({
        roundId: round.id, group: -1, id: `${round.id}-birdies`, type: 'teambirdies', label: `Most birdies · ${BIRDIE_POINTS} pt`,
        weight: BIRDIE_POINTS, holes, pars: config.pars?.[round.id] || {}, sides: structuredClone(sides), strokes: {},
      });
      continue;
    }
    if (round.format !== 'match' && round.format !== 'escalating') continue;
    round.groups.forEach((g, gi) => {
      // Groups hold player ids once resolved; draft slots before that.
      if (typeof g.a?.[0] !== 'string' || typeof g.b?.[0] !== 'string') return;
      const base = { roundId: round.id, group: gi };
      const one = (id, type, holes, [pa, pb], extra = {}) => ({
        ...base, id, type, holes, ...extra,
        sides: [{ team: 0, players: [g.a[pa]] }, { team: 1, players: [g.b[pb]] }],
        strokes: matchStrokes(config, round.id, holes, [g.a[pa], g.b[pb]]),
      });
      if (round.format === 'match') {
        // Best ball strokes go off the lowest player in the group.
        matches.push({
          ...base, id: `${round.id}-g${gi + 1}-bb`, type: 'bestball', holes: front,
          sides: [{ team: 0, players: [...g.a] }, { team: 1, players: [...g.b] }],
          strokes: matchStrokes(config, round.id, front, [...g.a, ...g.b]),
        });
        const pairs = g.cross ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
        pairs.forEach((pair, si) => matches.push(one(`${round.id}-g${gi + 1}-s${si + 1}`, 'singles', back, pair)));
        return;
      }
      [[0, 0], [1, 1]].forEach((pair, si) => matches.push(one(`${round.id}-g${gi + 1}-f${si + 1}`, 'singles', front, pair,
        { label: 'Singles · Front 9 · 1 pt', weight: 1 })));
      [[0, 1], [1, 0]].forEach((pair, si) => matches.push(one(`${round.id}-g${gi + 1}-b${si + 1}`, 'singles', back, pair,
        { label: `Singles · Back 9 · ${ESCALATING_BACK_POINTS} pt${ESCALATING_BACK_POINTS === 1 ? '' : 's'}`, weight: ESCALATING_BACK_POINTS })));
    });
  }
  return matches;
}

export function isScore(v) {
  return Number.isInteger(v) && v > 0;
}

// Best ball: lowest (net) score among the side's players. A blank (picked up)
// score is ignored as long as a teammate posted one.
export function sideScore(roundScores, players, hole, match = null) {
  const vals = players
    .map((p) => netScore(match, p, hole, roundScores?.[p]?.[hole]))
    .filter(isScore);
  return vals.length ? Math.min(...vals) : null;
}

// Team stroke play: every player's score counts, less each 12's allowance
// (taken off from the start). Live, teams are compared on net score to par
// for the holes each player has in (so a group that's further along isn't
// penalized); final, on net total strokes.
function computeTeamStroke(match, roundScores) {
  const total = match.holes.length;
  const sides = match.sides.map((side) => {
    let strokes = 0;
    let net = 0;
    let toPar = 0;
    let entered = 0;
    let thru = total;
    for (const p of side.players) {
      const sc = roundScores?.[p] || {};
      const done = match.holes.filter((h) => isScore(sc[h]));
      thru = Math.min(thru, done.length);
      entered += done.length;
      for (const h of done) {
        strokes += sc[h];
        toPar += sc[h] - (match.pars[h] || 0);
      }
      const off = match.allowance?.[p] || 0;
      net += done.reduce((a, h) => a + sc[h], 0) - off;
      toPar -= off;
    }
    return { strokes, net, toPar, entered, thru };
  });
  const played = Math.min(...sides.map((s) => s.thru));
  const started = sides.some((s) => s.entered > 0);
  const done = sides.every((s) => s.thru === total);
  const diff = sides[1].toPar - sides[0].toPar; // > 0: side 0 is ahead
  const leader = diff > 0 ? 0 : diff < 0 ? 1 : null;
  const up = Math.abs(diff);
  const w = match.weight || TEAMSTROKE_POINTS;
  const projected = !started ? null : leader === null ? [w / 2, w / 2] : leader === 0 ? [w, 0] : [0, w];
  let status;
  if (!started) status = 'Not started';
  else if (done && leader === null) status = 'Tied';
  else if (done) status = `Won by ${up}`;
  else if (leader === null) status = 'All square';
  else status = `${up} ahead`;
  return {
    played, remaining: total - played, done, diff, leader, up, status, sides,
    points: done ? projected : null, projected,
    holes: match.holes.map((hole) => ({ hole, a: null, b: null, winner: null, diff: null })),
  };
}

// Most birdies (gross; an eagle or better counts as a birdie). Final once
// everyone has every hole in; a tie splits the point.
function computeTeamBirdies(match, roundScores) {
  const total = match.holes.length;
  const sides = match.sides.map((side) => {
    let birdies = 0;
    let entered = 0;
    let thru = total;
    for (const p of side.players) {
      const sc = roundScores?.[p] || {};
      const done = match.holes.filter((h) => isScore(sc[h]));
      thru = Math.min(thru, done.length);
      entered += done.length;
      birdies += done.filter((h) => sc[h] < (match.pars[h] || 0)).length;
    }
    return { birdies, entered, thru };
  });
  const played = Math.min(...sides.map((s) => s.thru));
  const started = sides.some((s) => s.entered > 0);
  const done = sides.every((s) => s.thru === total);
  const diff = sides[0].birdies - sides[1].birdies;
  const leader = diff > 0 ? 0 : diff < 0 ? 1 : null;
  const up = Math.abs(diff);
  const w = match.weight || BIRDIE_POINTS;
  const projected = !started ? null : leader === null ? [w / 2, w / 2] : leader === 0 ? [w, 0] : [0, w];
  let status;
  if (!started) status = 'Not started';
  else if (leader === null) status = done ? 'Tied' : 'Even';
  else status = `${Math.max(sides[0].birdies, sides[1].birdies)}–${Math.min(sides[0].birdies, sides[1].birdies)}`;
  return {
    played, remaining: total - played, done, diff, leader, up, status, sides,
    points: done ? projected : null, projected,
    holes: match.holes.map((hole) => ({ hole, a: null, b: null, winner: null, diff: null })),
  };
}

// Returns the live state of one match. `diff` > 0 means side 0 is up.
// Holes are won on net scores (see `strokes`).
export function computeMatch(match, roundScores) {
  if (match.type === 'teamstroke') return computeTeamStroke(match, roundScores);
  if (match.type === 'teambirdies') return computeTeamBirdies(match, roundScores);
  const total = match.holes.length;
  let diff = 0;
  let played = 0;
  let clinched = false;
  const holes = [];

  for (const hole of match.holes) {
    const a = sideScore(roundScores, match.sides[0].players, hole, match);
    const b = sideScore(roundScores, match.sides[1].players, hole, match);
    // A hole only counts once everyone in the match has a score on it, so a
    // best ball hole can't be decided (or a match clinched) early.
    const allIn = match.sides.every((side) => side.players.every((p) => isScore(roundScores?.[p]?.[hole])));
    let winner = null;
    if (allIn && !clinched) {
      played++;
      winner = a < b ? 0 : b < a ? 1 : 'halve';
      if (winner === 0) diff++;
      if (winner === 1) diff--;
      if (Math.abs(diff) > total - played) clinched = true;
    }
    holes.push({ hole, a, b, winner, diff: winner === null ? null : diff });
  }

  const remaining = total - played;
  const done = clinched || remaining === 0;
  const leader = diff > 0 ? 0 : diff < 0 ? 1 : null;
  const up = Math.abs(diff);

  let points = null; // final points, only once the match is decided
  let projected = null; // "if it ended right now"
  if (played > 0) {
    // Tuesday's back 9 is worth more (`weight`); a halve splits whatever it's worth.
    const w = match.weight || 1;
    projected = leader === null ? [POINTS.halve * w, POINTS.halve * w]
      : leader === 0 ? [POINTS.win * w, POINTS.loss] : [POINTS.loss, POINTS.win * w];
  }
  if (done) points = projected;

  let status;
  if (played === 0) status = 'Not started';
  else if (done && leader === null) status = 'Halved';
  else if (done && remaining > 0) status = `Won ${up}&${remaining}`;
  else if (done) status = `Won ${up} UP`;
  else if (leader === null) status = 'All square';
  else if (up === remaining) status = `${up} UP · Dormie`;
  else status = `${up} UP`;

  return { played, remaining, done, diff, leader, up, status, points, projected, holes };
}

// Team and individual standings across every enabled round.
// Best ball results credit both teammates individually; singles credit the
// one player. Team totals = the points from every match.
export function computeStandings(config, scores) {
  const matches = buildMatches(config);
  const teams = (config.teams || []).map((t, idx) => ({
    idx, name: t.name, players: t.players, points: 0, projected: 0, w: 0, l: 0, h: 0,
  }));
  const players = {};
  (config.teams || []).forEach((t, idx) => t.players.forEach((p) => {
    players[p] = { id: p, team: idx, points: 0, projected: 0, w: 0, l: 0, h: 0 };
  }));

  const results = matches.map((m) => {
    const res = computeMatch(m, scores[m.roundId]);
    m.sides.forEach((side, si) => {
      const credit = (row, share = 1) => {
        if (!row) return;
        if (res.points) {
          row.points += res.points[si] * share;
          if (res.leader === null) row.h++;
          else if (res.leader === si) row.w++;
          else row.l++;
        }
        if (res.projected) row.projected += res.projected[si] * share;
      };
      credit(teams[side.team]);
      // Quicksands points are split between the four players.
      const share = isTeamMatch(m) ? 1 / side.players.length : 1;
      side.players.forEach((p) => credit(players[p], share));
    });
    return { match: m, result: res };
  });

  return { matches: results, teams, players };
}

export function parFor(config, roundId, hole) {
  return config.pars?.[roundId]?.[hole] ?? null;
}

// Scorecard marking: circle a birdie, double circle an eagle or better,
// square a bogey, double square a double bogey or worse.
export function scoreMark(score, par) {
  if (!isScore(score) || !par) return '';
  const d = score - par;
  if (d <= -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  return 'double';
}

// Birdies per player across every enabled round, starting at Circling Raven
// (Friday's Captain Round doesn't count); an eagle or better counts as a birdie.
export function birdieCounts(config, scores, playerIds) {
  const counts = {};
  playerIds.forEach((p) => { counts[p] = { id: p, birdies: 0 }; });
  for (const round of config.rounds) {
    if (!round.enabled || round.format === 'stroke') continue;
    for (const [pid, holes] of Object.entries(scores[round.id] || {})) {
      if (!counts[pid]) continue;
      for (const [hole, score] of Object.entries(holes)) {
        const mark = scoreMark(score, parFor(config, round.id, hole));
        if (mark === 'birdie' || mark === 'eagle') counts[pid].birdies++;
      }
    }
  }
  return counts;
}

// ---------- Ranking, tiebreakers and seeding ----------

// Tiebreakers, in order, when teams are level on points.
// (With two teams, head-to-head is just the points, so it isn't one.)
export const TIEBREAKERS = [
  { key: 'wins', label: 'Most matches won' },
  { key: 'margin', label: 'Holes-up margin' },
  { key: 'strokes', label: 'Fewest total strokes' },
  { key: 'puttoff', label: 'Putt-off' },
];

// Putt-off results are stored per stage ('seed' after Monday, 'final' after
// the last round, 'captain' for Friday) and per group of tied teams or
// players, in finishing order.
export const puttoffKey = (teamIdxs) => [...teamIdxs].sort((a, b) => a - b).join('-');

// Ranks teams on final match results in the given rounds.
// Returns { ranked, ties }:
// - ranked: team stats in order, each with `rank`, `tiebreak` (label of the
//   tiebreaker that placed it, or null) and `unresolved` (still tied until a
//   putt-off is recorded).
// - ties: one entry per group of teams level on points, with every
//   tiebreaker step it took to separate them.
export function rankTeams(config, scores, roundIds, stage = 'final') {
  const stats = (config.teams || []).map((t, idx) => ({
    idx, name: t.name, players: t.players, points: 0, wins: 0, margin: 0, strokes: 0,
  }));

  for (const m of buildMatches(config).filter((x) => roundIds.includes(x.roundId))) {
    const res = computeMatch(m, scores[m.roundId]);
    if (!res.points) continue;
    m.sides.forEach((side, si) => {
      const t = stats[side.team];
      t.points += res.points[si];
      if (res.leader === si) t.wins++;
      // Holes-up margin is match play only (Quicksands is counted in strokes).
      if (res.leader !== null && !isTeamMatch(m)) t.margin += res.leader === si ? res.up : -res.up;
    });
  }
  for (const t of stats) {
    for (const rid of roundIds) {
      for (const p of t.players) {
        for (const v of Object.values(scores[rid]?.[p] || {})) if (isScore(v)) t.strokes += v;
      }
    }
  }

  const puttoffs = config.puttoffs?.[stage] || {};
  const keys = ['points', ...TIEBREAKERS.map((tb) => tb.key)];
  // Display value and sort value (higher sorts first) for one criterion.
  const measure = (t, key, putKey) => {
    if (key === 'points') return [t.points, t.points];
    if (key === 'strokes') return [t.strokes, -t.strokes];
    if (key === 'puttoff') {
      const pos = (puttoffs[putKey] || []).indexOf(t.idx);
      return pos < 0 ? [null, -99] : [pos + 1, -pos];
    }
    return [t[key], t[key]];
  };

  const ties = [];
  // Split a group by criterion k, recording each tiebreaker step.
  const order = (group, k, tie, putKey) => {
    if (group.length === 1) return group;
    if (k === keys.length) {
      group.forEach((t) => { t.unresolved = true; });
      (tie.pending ||= []).push({ key: putKey, teams: group.map((t) => t.idx), done: puttoffs[putKey] || [] });
      return group;
    }
    const key = keys[k];
    const pk = key === 'puttoff' ? puttoffKey(group.map((t) => t.idx)) : putKey;
    const buckets = new Map();
    const values = {};
    for (const t of group) {
      const [shown, v] = measure(t, key, pk);
      values[t.idx] = shown;
      if (!buckets.has(v)) buckets.set(v, []);
      buckets.get(v).push(t);
    }
    const sorted = [...buckets.entries()].sort((a, b) => b[0] - a[0]).map(([, g]) => g);
    if (k === 0) {
      return sorted.flatMap((g) => {
        if (g.length === 1) return g;
        const newTie = { points: g[0].points, teams: g.map((t) => t.idx), steps: [] };
        ties.push(newTie);
        return order(g, 1, newTie, null);
      });
    }
    const played = key !== 'puttoff' || (puttoffs[pk] || []).length > 0;
    if (played) tie.steps.push({ key, label: TIEBREAKERS[k - 1].label, n: k, values, outcome: sorted.map((g) => g.map((t) => t.idx)) });
    if (sorted.length > 1) group.forEach((t) => { t.tiebreak = TIEBREAKERS[k - 1].label; });
    return sorted.flatMap((g) => order(g, k + 1, tie, pk));
  };

  stats.forEach((t) => { t.tiebreak = null; t.unresolved = false; });
  const ranked = order(stats, 0, null, null);
  ranked.forEach((t, i) => {
    const prev = ranked[i - 1];
    t.rank = prev && t.unresolved && prev.unresolved && prev.points === t.points ? prev.rank : i + 1;
  });
  return { ranked, ties };
}

// Tuesday's four matchups as [team 0 player, team 1 player], if all four
// are set and valid.
export function tuesdayPairs(config) {
  const pairs = config.tuePicks?.pairs || [];
  const [t0, t1] = config.teams || [];
  if (pairs.length !== 4 || !t0 || !t1) return null;
  const used = new Set(pairs.flat());
  const ok = used.size === 8 && pairs.every(([x, y]) => t0.players.includes(x) && t1.players.includes(y));
  return ok ? pairs : null;
}

// Fills in who plays who, round by round:
// - Friday (stroke) groups are fixed player lists.
// - Until the draft sets the two teams, every other round is `pending`.
// - Sat-Mon and Quicksands groups turn draft slots into players.
// - Tuesday waits for every earlier match to be final (`priorFinal`), then
//   for the leader (`leader`; a putt-off if the tiebreakers can't split
//   them, `needsPuttoff`), then for the leader's matchups (`needsPicks`).
//   `leaderNow` is who'd be picking if it ended right now.
export function resolveConfig(config, scores) {
  const resolved = structuredClone(config);
  const teams = resolved.teams || [];
  const teamsReady = teams.length === 2 && teams.every((t) => t.players?.length === 4);
  const earlier = [];
  for (const round of resolved.rounds) {
    if (!round.enabled || round.format === 'stroke') continue;
    if (!teamsReady) {
      round.pending = true;
      round.waitingOn = 'draft';
      continue;
    }
    if (round.format === 'escalating') {
      const priorIds = earlier.map((r) => r.id);
      const ready = earlier.length > 0
        && buildMatches({ ...resolved, rounds: earlier }).every((m) => computeMatch(m, scores[m.roundId]).done);
      const { ranked } = rankTeams(resolved, scores, priorIds, 'seed');
      round.priorIds = priorIds;
      round.priorFinal = ready;
      round.leaderNow = ranked[0].unresolved ? null : ranked[0].idx;
      round.leader = ready && !ranked[0].unresolved ? ranked[0].idx : null;
      const pairs = tuesdayPairs(resolved);
      if (!ready) {
        round.pending = true;
        round.waitingOn = 'standings';
      } else if (round.leader === null) {
        round.pending = true;
        round.needsPuttoff = true;
      } else if (!pairs) {
        round.pending = true;
        round.needsPicks = true;
      } else {
        round.groups = [0, 1].map((gi) => ({
          a: [pairs[gi * 2][0], pairs[gi * 2 + 1][0]],
          b: [pairs[gi * 2][1], pairs[gi * 2 + 1][1]],
        }));
      }
    } else {
      round.groups = round.groups.map((g) => ({
        a: g.a.map((i) => teams[0].players[i]),
        b: g.b.map((i) => teams[1].players[i]),
        cross: !!g.cross,
      }));
    }
    earlier.push(round);
  }
  return resolved;
}

// ---------- Friday: Captain Round and the draft ----------

// Friday's stroke play leaderboard. Live, it's sorted by score to par; once
// everyone has 18 holes in, by total, then back 9, then a putt-off (only if
// the tie decides a captain spot or who picks first).
// Returns { round, rows, allDone, captains, puttoff }.
export function captainRound(config, scores) {
  const round = config.rounds.find((r) => r.format === 'stroke' && r.enabled);
  if (!round) return null;
  const holes = holesOf(round);
  const [, back] = halvesOf(round);
  const pars = config.pars?.[round.id] || {};
  const rows = round.groups.flatMap((g) => g.players).map((id) => {
    const sc = scores[round.id]?.[id] || {};
    const played = holes.filter((h) => isScore(sc[h]));
    return {
      id,
      thru: played.length,
      gross: played.reduce((a, h) => a + sc[h], 0),
      back: back.filter((h) => isScore(sc[h])).reduce((a, h) => a + sc[h], 0),
      toPar: played.reduce((a, h) => a + sc[h] - (pars[h] || 0), 0),
      done: played.length === holes.length,
      tiebreak: null,
      unresolved: false,
    };
  });
  const allDone = rows.length > 0 && rows.every((r) => r.done);
  if (!allDone) {
    rows.sort((a, b) => (b.thru > 0) - (a.thru > 0) || a.toPar - b.toPar || b.thru - a.thru);
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.rank = prev && prev.thru && r.thru && prev.toPar === r.toPar ? prev.rank : i + 1;
    });
    return { round, rows, allDone, captains: null, puttoff: null };
  }

  const recorded = config.puttoffs?.captain || {};
  let puttoff = null;
  const ranked = [];
  const byKey = (key) => {
    const m = new Map();
    return (list) => {
      m.clear();
      list.forEach((r) => { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
      return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([, g]) => g);
    };
  };
  for (const same of byKey((r) => r.gross)(rows)) {
    if (same.length > 1) same.forEach((r) => { r.tiebreak = 'Back 9'; });
    for (const tied of byKey((r) => r.back)(same)) {
      if (tied.length === 1) { ranked.push(tied[0]); continue; }
      const key = puttoffKey(tied.map((r) => r.id));
      const order = (recorded[key] || []).filter((id) => tied.some((r) => r.id === id));
      const done = order.map((id) => tied.find((r) => r.id === id));
      const left = tied.filter((r) => !order.includes(r.id));
      done.forEach((r) => { r.tiebreak = 'Putt-off'; });
      ranked.push(...done);
      if (left.length === 1) {
        left[0].tiebreak = 'Putt-off';
        ranked.push(left[0]);
        continue;
      }
      // Still tied: only matters if it decides a captain spot or the first pick.
      if (ranked.length <= 1 && !puttoff) puttoff = { key, players: tied.map((r) => r.id), done: order };
      left.forEach((r) => { r.unresolved = true; });
      ranked.push(...left);
    }
  }
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    r.rank = prev && r.unresolved && prev.unresolved && prev.gross === r.gross && prev.back === r.back ? prev.rank : i + 1;
  });
  return { round, rows: ranked, allDone, captains: puttoff ? null : [ranked[0].id, ranked[1].id], puttoff };
}

// Where the draft is: captains (from Friday, or set by hand in Setup), then
// alternating picks with the low score first, until everyone's on a team.
// `rosters[i]` is team i so far, captain first.
export function draftState(config, scores, playerIds) {
  const cr = captainRound(config, scores);
  const manual = config.draft?.captains?.length === 2 ? config.draft.captains : null;
  const captains = manual || cr?.captains || null;
  if (!captains) return { stage: 'captains', cr, captains: null };
  const picks = [];
  for (const p of config.draft?.picks || []) {
    if (playerIds.includes(p) && !captains.includes(p) && !picks.includes(p)) picks.push(p);
  }
  const pool = playerIds.filter((p) => !captains.includes(p) && !picks.includes(p));
  const rosters = [[captains[0]], [captains[1]]];
  picks.forEach((p, i) => rosters[i % 2].push(p));
  const done = pool.length === 0;
  return {
    stage: done ? 'done' : 'drafting', cr, captains, manual: !!manual, picks, pool, rosters,
    turn: done ? null : picks.length % 2,
  };
}

// ---------- Skins ----------

// Every par 3 (or every hole, for `skins: 'all'`) in rounds with skins. Once
// everyone has a score on the hole, the outright low score wins `stake` from
// each other player; any tie for low and nobody wins it. Nothing carries.
// Returns { holes: [{ roundId, hole, par, winner, score, tied, waiting }], net }.
export function computeSkins(config, scores, playerIds, stake = 5) {
  const net = Object.fromEntries(playerIds.map((p) => [p, 0]));
  const holes = [];
  for (const round of config.rounds) {
    if (!round.enabled || !round.skins) continue;
    for (const hole of holesOf(round)) {
      const par = parFor(config, round.id, hole);
      if (round.skins === 'par3' && par !== 3) continue;
      const vals = playerIds.map((p) => scores[round.id]?.[p]?.[hole]);
      const row = { roundId: round.id, hole, par, winner: null, score: null, tied: [], waiting: [] };
      holes.push(row);
      row.waiting = playerIds.filter((p, i) => !isScore(vals[i]));
      if (row.waiting.length) continue;
      row.score = Math.min(...vals);
      const low = playerIds.filter((p, i) => vals[i] === row.score);
      if (low.length > 1) { row.tied = low; continue; }
      row.winner = low[0];
      playerIds.forEach((p) => { net[p] += p === row.winner ? stake * (playerIds.length - 1) : -stake; });
    }
  }
  return { holes, net };
}

// Fewest payments that settle everyone's net: biggest debtor pays biggest winner.
export function settleUp(net) {
  const owe = Object.entries(net).filter(([, v]) => v < 0).map(([p, v]) => ({ p, v: -v })).sort((a, b) => b.v - a.v);
  const get = Object.entries(net).filter(([, v]) => v > 0).map(([p, v]) => ({ p, v })).sort((a, b) => b.v - a.v);
  const out = [];
  while (owe.length && get.length) {
    const amt = Math.min(owe[0].v, get[0].v);
    out.push({ from: owe[0].p, to: get[0].p, amount: amt });
    owe[0].v -= amt;
    get[0].v -= amt;
    if (!owe[0].v) owe.shift();
    if (!get[0].v) get.shift();
    owe.sort((a, b) => b.v - a.v);
    get.sort((a, b) => b.v - a.v);
  }
  return out;
}

// ---------- Streaks, highlights and recap stats ----------

const isBirdieOrBetter = (score, par) => ['birdie', 'eagle'].includes(scoreMark(score, par));

// Holes won in a row by one side, counting back from the latest hole played
// in the match. Returns { side, n } or null (a halved hole ends a run).
export function matchStreak(res) {
  const played = res.holes.filter((h) => h.winner !== null);
  let side = null;
  let n = 0;
  for (let i = played.length - 1; i >= 0; i--) {
    const w = played[i].winner;
    if (w === 'halve' || (side !== null && w !== side)) break;
    side = w;
    n++;
  }
  return n ? { side, n } : null;
}

// Longest run of holes won in a row by either side at any point in a match.
export function longestMatchRun(res) {
  let best = null;
  let side = null;
  let n = 0;
  for (const h of res.holes) {
    if (h.winner === null) continue;
    if (h.winner === 'halve') { side = null; n = 0; continue; }
    n = h.winner === side ? n + 1 : 1;
    side = h.winner;
    if (!best || n > best.n) best = { side, n };
  }
  return best;
}

// Birdies (or better) in a row ending at the player's latest scored hole.
export function birdieStreak(config, roundId, playerScores) {
  const holes = Object.keys(playerScores || {}).map(Number).sort((a, b) => a - b);
  let n = 0;
  for (let i = holes.length - 1; i >= 0; i--) {
    if (i < holes.length - 1 && holes[i + 1] !== holes[i] + 1) break;
    if (!isBirdieOrBetter(playerScores[holes[i]], parFor(config, roundId, holes[i]))) break;
    n++;
  }
  return n;
}

// Longest birdie-or-better run for a player across the enabled rounds.
export function longestBirdieRun(config, scores, playerId) {
  let best = 0;
  for (const round of config.rounds) {
    if (!round.enabled || round.format === 'stroke') continue;
    const sc = scores[round.id]?.[playerId] || {};
    let n = 0;
    for (let h = 1; h <= 18; h++) {
      n = isBirdieOrBetter(sc[h], parFor(config, round.id, h)) ? n + 1 : 0;
      best = Math.max(best, n);
    }
  }
  return best;
}

// Automatic feed items worked out from the scores, so no phone has to post
// them and they fix themselves if a score is corrected. `times` gives when
// each hole was scored; every item has a stable id for reactions/comments.
export function highlights(config, scores, times, playerIds) {
  const items = [];
  const at = (roundId, players, hole) => Math.max(0, ...players.map((p) => times?.[roundId]?.[p]?.[hole] || 0));

  for (const round of config.rounds) {
    if (!round.enabled) continue;
    {
      for (const pid of playerIds) {
        const sc = scores[round.id]?.[pid] || {};
        // One item per birdie, plus one per run of 2+ that grows in place
        // (keyed by the run's first hole, so reactions stay with it).
        let start = 0;
        const endRun = (last) => {
          const n = last - start + 1;
          if (start && n >= 2) {
            items.push({
              id: `hl-${round.id}-${pid}-${start}-run`, type: 'birdieRun', n, player: pid,
              roundId: round.id, hole: last, at: at(round.id, [pid], last),
            });
          }
          start = 0;
        };
        const last = holesOf(round).length;
        for (let h = 1; h <= last; h++) {
          const par = parFor(config, round.id, h);
          if (!isBirdieOrBetter(sc[h], par)) { endRun(h - 1); continue; }
          if (!start) start = h;
          const type = sc[h] === 1 ? 'ace' : scoreMark(sc[h], par);
          items.push({
            id: `hl-${round.id}-${pid}-${h}-${type}`, type, player: pid, score: sc[h], par,
            roundId: round.id, hole: h, at: at(round.id, [pid], h),
          });
        }
        endRun(last);
      }
    }
  }

  for (const match of buildMatches(config)) {
    const res = computeMatch(match, scores[match.roundId]);
    const everyone = match.sides.flatMap((s) => s.players);
    // One item per run of 3+ holes won in a row, growing in place.
    let side = null;
    let run = [];
    const endRun = () => {
      if (run.length >= 3) {
        const last = run[run.length - 1];
        items.push({
          id: `hl-${match.id}-${run[0]}-run`, type: 'holeRun', match, side, n: run.length,
          roundId: match.roundId, hole: last, at: at(match.roundId, everyone, last),
        });
      }
      run = [];
    };
    for (const h of res.holes) {
      if (h.winner === null) continue;
      if (h.winner !== side || h.winner === 'halve') endRun();
      side = h.winner === 'halve' ? null : h.winner;
      if (side !== null) run.push(h.hole);
    }
    endRun();
    if (res.done) {
      const last = [...res.holes].reverse().find((h) => h.winner !== null) || res.holes[res.holes.length - 1];
      items.push({
        id: `hl-${match.id}-final`, type: 'matchFinal', match, res,
        roundId: match.roundId, hole: last.hole, at: at(match.roundId, everyone, last.hole),
      });
    }
  }

  return items.sort((a, b) => b.at - a.at);
}

// Gross totals for each player's complete 18-hole rounds.
export function roundTotals(config, scores, playerId) {
  return config.rounds.filter((r) => r.enabled).map((r) => {
    const sc = scores[r.id]?.[playerId] || {};
    const holes = Object.values(sc).filter(isScore);
    const par = Object.values(config.pars?.[r.id] || {}).reduce((a, b) => a + b, 0);
    return { roundId: r.id, day: r.day, course: r.course, gross: holes.reduce((a, b) => a + b, 0), holes: holes.length, par };
  });
}

// ---------- Tuesday: the matchup draft ----------
//
// Monday night the captains set Tuesday's front 9 matchups in turn: one puts
// a player out, the other picks who plays him. The trailing team puts out
// first, so the leader answers twice (matches 1 and 3); match 4 is whoever's
// left. Matches 1-2 are the first group, 3-4 the second; on the back 9 you
// play the other opponent in your group. 1 pt a nine.
// `moves` is every player named, in order: out, answer, out, answer, ...

export function tueDraftState(config, leader) {
  const teams = config.teams || [];
  const trail = 1 - leader;
  const order = [[trail, leader], [leader, trail], [trail, leader]]; // [puts out, answers] per match
  const used = new Set();
  const moves = [];
  for (const pid of config.tueDraft?.moves || []) {
    const i = moves.length;
    if (i >= 6) break;
    const team = order[Math.floor(i / 2)][i % 2];
    if (!teams[team]?.players.includes(pid) || used.has(pid)) break;
    used.add(pid);
    moves.push(pid);
  }
  const byTeam = (a, b, ta) => (ta === 0 ? [a, b] : [b, a]); // [team 0 player, team 1 player]
  const front = [];
  for (let m = 0; m * 2 + 1 < moves.length; m++) front.push(byTeam(moves[m * 2], moves[m * 2 + 1], order[m][0]));
  const pool = [0, 1].map((t) => (teams[t]?.players || []).filter((p) => !used.has(p)));
  let turn = null;
  if (moves.length < 6) {
    const m = Math.floor(moves.length / 2);
    const role = moves.length % 2 ? 'answer' : 'out';
    turn = { match: m, role, team: order[m][role === 'out' ? 0 : 1], out: role === 'answer' ? moves[moves.length - 1] : null };
  } else if (pool[0].length === 1 && pool[1].length === 1) {
    front.push([pool[0][0], pool[1][0]]);
  }
  const done = front.length === 4;
  // Back 9: opponents swap within each group.
  const back = done ? [0, 1].flatMap((g) => {
    const [x, y] = [front[g * 2], front[g * 2 + 1]];
    return [[x[0], y[1]], [y[0], x[1]]];
  }) : null;
  // The front 9 pairs are what resolveConfig expects.
  return { leader, trail, order, moves, front, back, pool, turn, done, pairs: done ? front : null };
}
