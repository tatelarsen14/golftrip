// Pure match-play scoring logic. No DOM, no storage — easy to test.

export const FRONT_NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const BACK_NINE = [10, 11, 12, 13, 14, 15, 16, 17, 18];

export const POINTS = { win: 1, halve: 0.5, loss: 0 };

// Every day: each group (two teams of two) plays a best ball match on the
// front nine, then two singles matches on the back nine.
export function buildMatches(config) {
  const matches = [];
  for (const round of config.rounds) {
    if (!round.enabled || round.pending) continue;
    if (round.format === 'bracket') {
      matches.push(...bracketMatches(config, round));
      continue;
    }
    round.groups.forEach((group, gi) => {
      const [ta, tb] = group.teams;
      const teamA = config.teams[ta];
      const teamB = config.teams[tb];
      if (!teamA || !teamB) return;
      const base = { roundId: round.id, group: gi };
      matches.push({
        ...base,
        id: `${round.id}-g${gi + 1}-bb`,
        type: 'bestball',
        holes: FRONT_NINE,
        sides: [
          { team: ta, players: [...teamA.players] },
          { team: tb, players: [...teamB.players] },
        ],
      });
      const pairs = group.cross ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
      pairs.forEach(([pa, pb], si) => {
        matches.push({
          ...base,
          id: `${round.id}-g${gi + 1}-s${si + 1}`,
          type: 'singles',
          holes: BACK_NINE,
          sides: [
            { team: ta, players: [teamA.players[pa]] },
            { team: tb, players: [teamB.players[pb]] },
          ],
        });
      });
    });
  }
  return matches;
}

export function isScore(v) {
  return Number.isInteger(v) && v > 0;
}

// Best ball: lowest score among the side's players. A blank (picked up)
// score is ignored as long as a teammate posted one.
export function sideScore(roundScores, players, hole) {
  const vals = players
    .map((p) => roundScores?.[p]?.[hole])
    .filter(isScore);
  return vals.length ? Math.min(...vals) : null;
}

// Returns the live state of one match. `diff` > 0 means side 0 is up.
export function computeMatch(match, roundScores) {
  const total = match.holes.length;
  let diff = 0;
  let played = 0;
  let clinched = false;
  const holes = [];

  for (const hole of match.holes) {
    const a = sideScore(roundScores, match.sides[0].players, hole);
    const b = sideScore(roundScores, match.sides[1].players, hole);
    let winner = null;
    if (a !== null && b !== null && !clinched) {
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
    // Bracket finals are worth more (`weight`); a halve splits whatever it's worth.
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
// one player. Team totals = best ball points + their players' singles points.
export function computeStandings(config, scores) {
  const matches = buildMatches(config);
  const teams = config.teams.map((t, idx) => ({
    idx, name: t.name, players: t.players, points: 0, projected: 0, w: 0, l: 0, h: 0,
  }));
  const players = {};
  config.teams.forEach((t, idx) => t.players.forEach((p) => {
    players[p] = { id: p, team: idx, points: 0, projected: 0, w: 0, l: 0, h: 0 };
  }));

  const results = matches.map((m) => {
    const res = computeMatch(m, scores[m.roundId]);
    m.sides.forEach((side, si) => {
      const credit = (row) => {
        if (!row) return;
        if (res.points) {
          row.points += res.points[si];
          if (res.leader === null) row.h++;
          else if (res.leader === si) row.w++;
          else row.l++;
        }
        if (res.projected) row.projected += res.projected[si];
      };
      credit(teams[side.team]);
      side.players.forEach((p) => credit(players[p]));
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

// Birdies per player across every enabled round; an eagle or better counts as a birdie.
export function birdieCounts(config, scores) {
  const counts = {};
  config.teams.forEach((t) => t.players.forEach((p) => { counts[p] = { id: p, birdies: 0 }; }));
  for (const round of config.rounds) {
    if (!round.enabled) continue;
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
export const TIEBREAKERS = [
  { key: 'h2h', label: 'Head-to-head points' },
  { key: 'wins', label: 'Most matches won' },
  { key: 'margin', label: 'Holes-up margin' },
  { key: 'strokes', label: 'Fewest total strokes' },
  { key: 'puttoff', label: 'Putt-off' },
];

// Putt-off results are stored per stage ('seed' after the earlier rounds,
// 'final' after the last) and per group of tied teams, as team indexes in
// finishing order.
export const puttoffKey = (teamIdxs) => [...teamIdxs].sort((a, b) => a - b).join('-');

// Ranks teams on final match results in the given rounds.
// Returns { ranked, ties }:
// - ranked: team stats in order, each with `rank`, `tiebreak` (label of the
//   tiebreaker that placed it, or null) and `unresolved` (still tied until a
//   putt-off is recorded).
// - ties: one entry per group of teams level on points, with every
//   tiebreaker step it took to separate them.
export function rankTeams(config, scores, roundIds, stage = 'final') {
  const stats = config.teams.map((t, idx) => ({
    idx, name: t.name, players: t.players, points: 0, wins: 0, margin: 0, strokes: 0, h2h: {},
  }));

  for (const m of buildMatches(config).filter((x) => roundIds.includes(x.roundId))) {
    const res = computeMatch(m, scores[m.roundId]);
    if (!res.points) continue;
    m.sides.forEach((side, si) => {
      const t = stats[side.team];
      const opp = m.sides[1 - si].team;
      t.points += res.points[si];
      t.h2h[opp] = (t.h2h[opp] || 0) + res.points[si];
      if (res.leader === si) t.wins++;
      if (res.leader !== null) t.margin += res.leader === si ? res.up : -res.up;
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
  const measure = (t, key, tied, putKey) => {
    if (key === 'points') return [t.points, t.points];
    if (key === 'h2h') {
      const v = tied.reduce((a, o) => a + (o === t ? 0 : t.h2h[o.idx] || 0), 0);
      return [v, v];
    }
    if (key === 'strokes') return [t.strokes, -t.strokes];
    if (key === 'puttoff') {
      const pos = (puttoffs[putKey] || []).indexOf(t.idx);
      return pos < 0 ? [null, -99] : [pos + 1, -pos];
    }
    return [t[key], t[key]];
  };

  const ties = [];
  // Split a group by criterion k, recording each tiebreaker step. Head-to-head
  // only counts matches among the teams still tied at that step.
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
      const [shown, v] = measure(t, key, group, pk);
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

// Fills in seeded rounds: 1st v 2nd and 3rd v 4th on the standings from the
// earlier rounds, once every one of those matches is final. Until then the
// round is `pending` (matchups TBD) and `seeding` holds the matchups as they
// stand right now. A tie between 2nd and 3rd that only a putt-off can break
// also keeps it pending (`needsPuttoff`).
export function resolveConfig(config, scores) {
  const resolved = structuredClone(config);
  const enabled = resolved.rounds.filter((r) => r.enabled);
  enabled.forEach((round, i) => {
    if (!round.seeded) return;
    const prior = enabled.slice(0, i);
    const priorIds = prior.map((r) => r.id);
    const priorMatches = buildMatches({ ...resolved, rounds: prior });
    const ready = prior.length > 0
      && priorMatches.every((m) => computeMatch(m, scores[m.roundId]).done);
    const { ranked } = rankTeams(resolved, scores, priorIds, 'seed');
    round.priorIds = priorIds;
    round.priorFinal = ready;
    if (round.format === 'bracket') {
      // Every seed matters in a bracket (1 v 4, 2 v 3), so any tie left for a
      // putt-off holds it up.
      round.seeding = [[ranked[0].idx, ranked[3].idx], [ranked[1].idx, ranked[2].idx]];
      if (!ready || ranked.some((t) => t.unresolved)) {
        round.pending = true;
        round.needsPuttoff = ready;
        return;
      }
      resolveBracket(resolved, round, scores, ranked.map((t) => t.idx));
      return;
    }
    const seeding = [[ranked[0].idx, ranked[1].idx], [ranked[2].idx, ranked[3].idx]];
    round.seeding = seeding;
    const splitUndecided = ranked[1].unresolved && ranked[2].unresolved && ranked[1].rank === ranked[2].rank;
    if (ready && !splitUndecided) {
      round.groups = seeding.map((teams, gi) => ({ teams, cross: !!round.groups[gi]?.cross }));
    } else {
      round.pending = true;
      round.needsPuttoff = ready && splitUndecided;
    }
  });
  return resolved;
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
    if (!round.enabled) continue;
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
export function highlights(config, scores, times) {
  const items = [];
  const at = (roundId, players, hole) => Math.max(0, ...players.map((p) => times?.[roundId]?.[p]?.[hole] || 0));

  for (const round of config.rounds) {
    if (!round.enabled) continue;
    for (const team of config.teams) {
      for (const pid of team.players) {
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
        for (let h = 1; h <= 18; h++) {
          const par = parFor(config, round.id, h);
          if (!isBirdieOrBetter(sc[h], par)) { endRun(h - 1); continue; }
          if (!start) start = h;
          const type = sc[h] === 1 ? 'ace' : scoreMark(sc[h], par);
          items.push({
            id: `hl-${round.id}-${pid}-${h}-${type}`, type, player: pid, score: sc[h], par,
            roundId: round.id, hole: h, at: at(round.id, [pid], h),
          });
        }
        endRun(18);
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
      const last = [...res.holes].reverse().find((h) => h.winner !== null);
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

// ---------- Bracket Day (Tuesday) ----------
//
// Seeds 1-4 from the standings after the earlier rounds. Each team puts one
// player in Bracket A and the other in Bracket B (picked in order 4th, 3rd,
// 2nd, 1st, so the leader picks last). In each bracket, the front 9 is
// semifinals (1 v 4, 2 v 3) and the back 9 is the final (semi winners) and
// 3rd place (semi losers). A halved semi is ½ each, and the higher seed
// advances.

export const BRACKETS = ['A', 'B'];
export const BRACKET_POINTS = { semi: 1, final: 2, third: 1 };

// The order teams make their A/B picks: last seed first.
export const pickOrder = (seeds) => [...seeds].reverse();

// Semifinal matches for one bracket group; finals once the group has them.
function bracketMatches(config, round) {
  const matches = [];
  round.groups.forEach((group, gi) => {
    if (!group.players) return; // not set until the picks are in
    const seat = (seed) => ({ team: group.teams[seed], players: [group.players[seed]], seed: seed + 1 });
    const base = { roundId: round.id, group: gi, type: 'singles', bracket: group.bracket };
    matches.push(
      { ...base, id: `${round.id}-${group.bracket}-semi1`, stage: 'semi', label: 'Semifinal · 1 v 4', weight: BRACKET_POINTS.semi, holes: FRONT_NINE, sides: [seat(0), seat(3)] },
      { ...base, id: `${round.id}-${group.bracket}-semi2`, stage: 'semi', label: 'Semifinal · 2 v 3', weight: BRACKET_POINTS.semi, holes: FRONT_NINE, sides: [seat(1), seat(2)] },
    );
    if (group.final) {
      matches.push(
        { ...base, id: `${round.id}-${group.bracket}-final`, stage: 'final', label: `Bracket ${group.bracket} Final · ${BRACKET_POINTS.final} pts`, weight: BRACKET_POINTS.final, holes: BACK_NINE, sides: group.final.map(seat) },
        { ...base, id: `${round.id}-${group.bracket}-third`, stage: 'third', label: '3rd place · 1 pt', weight: BRACKET_POINTS.third, holes: BACK_NINE, sides: group.third.map(seat) },
      );
    }
  });
  return matches;
}

// Fills in a bracket round from the seeds, the A/B picks and the semis.
function resolveBracket(config, round, scores, seeds) {
  const picks = config.bracketPicks || {};
  const valid = (t) => config.teams[t]?.players.includes(picks[t]);
  const order = pickOrder(seeds);
  round.seeds = seeds;
  round.pickTurn = order.find((t) => !valid(t));
  if (round.pickTurn !== undefined) {
    round.pending = true;
    round.needsPicks = true;
    return;
  }
  const other = (t) => config.teams[t].players.find((p) => p !== picks[t]);
  round.groups = BRACKETS.map((bracket) => ({
    bracket,
    teams: [...seeds],
    players: seeds.map((t) => (bracket === 'A' ? picks[t] : other(t))),
  }));
  // Back 9 matchups once both semis in a bracket are final.
  for (const group of round.groups) {
    const semis = bracketMatches(config, { ...round, groups: [group] }).map((m) => ({ m, res: computeMatch(m, scores[round.id]) }));
    if (!semis.every(({ res }) => res.done)) continue;
    const winnerLoser = ({ m, res }) => {
      // Halved semi: the higher seed (side 0) advances.
      const w = res.leader === null ? 0 : res.leader;
      return [m.sides[w].seed - 1, m.sides[1 - w].seed - 1];
    };
    const [[w1, l1], [w2, l2]] = semis.map(winnerLoser);
    group.final = [w1, w2].sort((a, b) => a - b);
    group.third = [l1, l2].sort((a, b) => a - b);
  }
}
