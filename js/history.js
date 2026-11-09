// The record book: every trip's results added up, for the History tab.
// Finished trips come from their saved SNAPSHOT (trips/*.snapshot.js); the
// trip being played comes from the live scores, so records update as they
// happen. Everything is worked out with the same scoring as the Leaderboard.
import {
  resolveConfig, buildMatches, computeMatch, computeStandings, computeSkins, rankTeams, soloTable,
  holesOf, isScore, parFor, scoreMark,
} from './scoring.js';

const SKIN_STAKE = 5;

// One trip's results: champion, each player's matches, rounds, birdies,
// aces and skins, plus every match for head-to-head and records.
// `config` is the full setup (defaults + what was saved); `scores` is
// { round: { player: { hole: score } } }.
export function tripSummary(trip, config, scores) {
  const rc = resolveConfig(config, scores);
  const ids = trip.PLAYERS.map((p) => p.id);
  const rounds = rc.rounds.filter((r) => r.enabled);
  const matches = buildMatches(rc);
  const results = matches.map((m) => ({ match: m, result: computeMatch(m, scores[m.roundId]) }));
  const final = results.length > 0 && !rounds.some((r) => r.pending) && results.every((x) => x.result.done);
  const courseOf = (rid) => rounds.find((r) => r.id === rid)?.course || '';

  const players = Object.fromEntries(ids.map((id) => [id, {
    id, points: 0, w: 0, l: 0, h: 0, rounds: [], birdies: 0, eagles: 0, aces: [], skinsWon: 0, skinsNet: 0,
  }]));

  // Points and records: the Cup credits every player's matches; solo trips
  // use the same points table as the Leaderboard.
  if (trip.MODE === 'solo') {
    for (const r of soloTable(matches, scores, ids)) Object.assign(players[r.id], { points: r.points, w: r.w, l: r.l, h: r.h });
  } else {
    const st = computeStandings(rc, scores);
    for (const [id, p] of Object.entries(st.players)) if (players[id]) Object.assign(players[id], { points: p.points, w: p.w, l: p.l, h: p.h });
  }

  // Rounds, birdies and aces from every score (the Captain Round counts too).
  for (const round of rounds) {
    const holes = holesOf(round);
    for (const id of ids) {
      const sc = scores[round.id]?.[id];
      if (!sc) continue;
      const played = holes.filter((h) => isScore(sc[h]));
      if (!played.length) continue;
      let birdies = 0;
      for (const h of played) {
        const mark = scoreMark(sc[h], parFor(rc, round.id, h));
        if (mark === 'birdie' || mark === 'eagle') birdies++;
        if (mark === 'eagle') players[id].eagles++;
        if (sc[h] === 1) players[id].aces.push({ roundId: round.id, course: round.course, hole: h, par: parFor(rc, round.id, h) });
      }
      players[id].birdies += birdies;
      players[id].rounds.push({
        roundId: round.id, course: round.course, day: round.day, holes: holes.length, played: played.length,
        complete: played.length === holes.length,
        gross: played.reduce((a, h) => a + sc[h], 0),
        toPar: played.reduce((a, h) => a + sc[h] - (parFor(rc, round.id, h) || 0), 0),
        birdies,
      });
    }
  }

  const skins = computeSkins(rc, scores, ids, SKIN_STAKE);
  for (const h of skins.holes) if (h.winner) players[h.winner].skinsWon++;
  for (const [id, v] of Object.entries(skins.net)) players[id].skinsNet = v;

  // Champion (or who's leading, until it's final).
  let champion = null;
  if (trip.MODE === 'solo') {
    const t = soloTable(matches, scores, ids);
    const tied = t[1] && t[1].points === t[0].points && t[1].strokes === t[0].strokes;
    if (t[0] && (t[0].played || t[0].points)) champion = { label: tied ? 'Tied' : trip.PLAYERS.find((p) => p.id === t[0].id).name, players: tied ? [] : [t[0].id], points: t[0].points, tied };
  } else if (rc.teams?.length === 2) {
    const scoring = rounds.filter((r) => r.format !== 'stroke').map((r) => r.id);
    const st = computeStandings(rc, scores);
    const top = rankTeams(rc, scores, scoring, 'final').ranked[0];
    const other = st.teams.find((t) => t.idx !== top.idx);
    const t = st.teams[top.idx];
    champion = top.unresolved ? { label: 'Tied', players: [], tied: true }
      : { label: t.name, players: [...t.players], points: t.points, against: other.points, team: true };
  }

  return {
    id: trip.ID, name: trip.TRIP.name, dates: trip.TRIP.shortDates, year: trip.TRIP.year, place: trip.TRIP.short,
    mode: trip.MODE, final, champion,
    names: Object.fromEntries(trip.PLAYERS.map((p) => [p.id, p.name])),
    players,
    matches: results.filter((x) => ['bestball', 'singles'].includes(x.match.type)).map(({ match, result }) => ({
      type: match.type, roundId: match.roundId, course: courseOf(match.roundId), label: match.label || '',
      sides: match.sides.map((s) => [...s.players]), done: result.done, leader: result.leader,
      status: result.status, up: result.up, remaining: result.remaining,
    })),
  };
}

const pairKey = (a, b) => [a, b].sort().join('|');

// Everything added up across trips (newest first in `trips`).
export function allTime(trips) {
  const players = {};
  const row = (id, name) => (players[id] ||= {
    id, name, trips: 0, titles: [], w: 0, l: 0, h: 0, points: 0, birdies: 0, eagles: 0, aces: [],
    skinsWon: 0, skinsNet: 0, rounds: [], best: null,
  });
  const h2h = {}; // 'a|b' (sorted) -> { [a]: wins, [b]: wins, h, games: [...] }
  const partners = {}; // 'a|b' -> { w, l, h }
  const courses = {}; // course -> best 18-hole round
  const records = { low: null, birdies: null, win: null, trip: null };

  for (const t of [...trips].reverse()) { // oldest first, so ties keep the first to do it
    for (const [id, p] of Object.entries(t.players)) {
      if (!p.rounds.length && !p.w && !p.l && !p.h) continue; // didn't play
      const r = row(id, t.names[id]);
      r.trips++;
      for (const k of ['w', 'l', 'h', 'points', 'birdies', 'eagles', 'skinsWon', 'skinsNet']) r[k] += p[k];
      r.aces.push(...p.aces.map((a) => ({ ...a, trip: t.name, year: t.year })));
      for (const rd of p.rounds) {
        const full = { ...rd, trip: t.name, year: t.year, player: id };
        r.rounds.push(full);
        if (!rd.complete) continue;
        if (rd.holes === 18) {
          if (!r.best || rd.gross < r.best.gross) r.best = full;
          if (!courses[rd.course] || rd.gross < courses[rd.course].gross) courses[rd.course] = full;
          if (!records.low || rd.gross < records.low.gross) records.low = full;
        }
        if (!records.birdies || rd.birdies > records.birdies.birdies) records.birdies = full;
      }
      if (!records.trip || p.points > records.trip.points) records.trip = { player: id, points: p.points, w: p.w, l: p.l, h: p.h, trip: t.name, year: t.year };
    }
    if (t.final && t.champion?.players.length) {
      for (const id of t.champion.players) row(id, t.names[id]).titles.push({ trip: t.name, year: t.year, team: t.champion.team ? t.champion.label : null });
    }
    for (const m of t.matches) {
      if (!m.done) continue;
      if (m.type === 'singles') {
        const [a, b] = [m.sides[0][0], m.sides[1][0]];
        const k = pairKey(a, b);
        const rec = (h2h[k] ||= { [a]: 0, [b]: 0, h: 0, games: [] });
        if (m.leader === null) rec.h++;
        else rec[m.sides[m.leader][0]]++;
        rec.games.push({ ...m, trip: t.name, year: t.year });
      }
      m.sides.forEach((side, si) => {
        if (side.length !== 2) return;
        const rec = (partners[pairKey(...side)] ||= { w: 0, l: 0, h: 0 });
        if (m.leader === null) rec.h++;
        else if (m.leader === si) rec.w++;
        else rec.l++;
      });
      // Biggest win: holes up, then holes left (5&4 beats 5&3).
      if (m.leader !== null && (!records.win || m.up > records.win.up || (m.up === records.win.up && m.remaining > records.win.remaining))) {
        records.win = { ...m, winners: m.sides[m.leader], losers: m.sides[1 - m.leader], trip: t.name, year: t.year };
      }
    }
  }
  for (const r of Object.values(players)) {
    const full = r.rounds.filter((x) => x.complete && x.holes === 18);
    r.avg = full.length ? full.reduce((a, x) => a + x.gross, 0) / full.length : null;
    r.played = full.length;
  }
  return { players, h2h, partners, courses, records };
}

// One player's record against another in singles: { w, l, h, games }.
export function headToHead(book, a, b) {
  const rec = book.h2h[pairKey(a, b)];
  if (!rec) return { w: 0, l: 0, h: 0, games: [] };
  return { w: rec[a] || 0, l: rec[b] || 0, h: rec.h, games: rec.games };
}
