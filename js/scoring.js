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
    projected = leader === null ? [POINTS.halve, POINTS.halve]
      : leader === 0 ? [POINTS.win, POINTS.loss] : [POINTS.loss, POINTS.win];
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

// Birdies and eagles (or better) per player across every enabled round.
export function birdieCounts(config, scores) {
  const counts = {};
  config.teams.forEach((t) => t.players.forEach((p) => { counts[p] = { id: p, birdies: 0, eagles: 0 }; }));
  for (const round of config.rounds) {
    if (!round.enabled) continue;
    for (const [pid, holes] of Object.entries(scores[round.id] || {})) {
      if (!counts[pid]) continue;
      for (const [hole, score] of Object.entries(holes)) {
        const mark = scoreMark(score, parFor(config, round.id, hole));
        if (mark === 'birdie') counts[pid].birdies++;
        if (mark === 'eagle') counts[pid].eagles++;
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
];

// Ranks teams on final match results in the given rounds.
// Returns team stats in order, each with `rank`, `tiebreak` (label of the
// tiebreaker that placed it, or null) and `unresolved` (still tied after
// every tiebreaker: flip a coin).
export function rankTeams(config, scores, roundIds) {
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

  const value = (t, key, tied) => {
    if (key === 'points') return t.points;
    if (key === 'h2h') return tied.reduce((a, o) => a + (o === t ? 0 : t.h2h[o.idx] || 0), 0);
    if (key === 'strokes') return -t.strokes;
    return t[key];
  };
  const keys = ['points', ...TIEBREAKERS.map((tb) => tb.key)];

  // Split a tied group by the next criterion; head-to-head only counts
  // matches among the teams still tied.
  const order = (group, k) => {
    if (group.length === 1) return group;
    if (k === keys.length) {
      group.forEach((t) => { t.unresolved = true; });
      return group;
    }
    const buckets = new Map();
    for (const t of group) {
      const v = value(t, keys[k], group);
      if (!buckets.has(v)) buckets.set(v, []);
      buckets.get(v).push(t);
    }
    if (buckets.size > 1 && k > 0) group.forEach((t) => { t.tiebreak = TIEBREAKERS[k - 1].label; });
    return [...buckets.entries()].sort((a, b) => b[0] - a[0]).flatMap(([, g]) => order(g, k + 1));
  };

  stats.forEach((t) => { t.tiebreak = null; t.unresolved = false; });
  const ranked = order(stats, 0);
  ranked.forEach((t, i) => {
    const prev = ranked[i - 1];
    t.rank = prev && t.unresolved && prev.unresolved && prev.points === t.points ? prev.rank : i + 1;
  });
  return ranked;
}

// Fills in seeded rounds: 1st v 2nd and 3rd v 4th on the standings from the
// earlier rounds, once every one of those matches is final. Until then the
// round is `pending` (matchups TBD) and `projected` holds the seeding as it
// stands right now.
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
    const ranked = rankTeams(resolved, scores, priorIds).map((t) => t.idx);
    const seeding = [[ranked[0], ranked[1]], [ranked[2], ranked[3]]];
    round.seeding = seeding;
    if (ready) {
      round.groups = seeding.map((teams, gi) => ({ teams, cross: !!round.groups[gi]?.cross }));
    } else {
      round.pending = true;
    }
  });
  return resolved;
}
