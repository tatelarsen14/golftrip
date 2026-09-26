// Pure match-play scoring logic. No DOM, no storage — easy to test.

export const FRONT_NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const BACK_NINE = [10, 11, 12, 13, 14, 15, 16, 17, 18];

export const POINTS = { win: 1, halve: 0.5, loss: 0 };

// Every day: each group (two teams of two) plays a best ball match on the
// front nine, then two singles matches on the back nine.
export function buildMatches(config) {
  const matches = [];
  for (const round of config.rounds) {
    if (!round.enabled) continue;
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
