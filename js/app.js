import { createStore, MAX_VIDEO_MB } from './store.js';
import { PLAYERS, TEAM_COLORS, TRIP, ITINERARY, FLIGHTS, HOLE_HANDICAPS } from './data.js';
import {
  buildMatches, computeMatch, computeStandings, birdieCounts, parFor, scoreMark, rankTeams, resolveConfig,
  TIEBREAKERS, puttoffKey, holesOf, halvesOf, groupRoster, roundPoints, ESCALATING_BACK_POINTS, TEAMSTROKE_POINTS,
  BIRDIE_POINTS, STROKES_PER_NINE, TEAMSTROKE_STROKES, HCP_BUCKETS, isTeamMatch, netScore,
  matchStreak, birdieStreak, highlights, longestBirdieRun, longestMatchRun, roundTotals,
  captainRound, draftState, computeSkins, settleUp, tueDraftState, hardestHoles,
} from './scoring.js';
import { SCOUTING, HIGHLIGHTS, DRAFT_THEME } from './draftkit.js';

const UI_KEY = 'golftrip:ui';
// Setup only shows on phones where the organizer picked his own name.
const ORGANIZER = 'tate';
const PLAYER_IDS = PLAYERS.map((p) => p.id);
const SKIN_STAKE = 5;
// Shown at the bottom of the Trip tab, to check a phone has the latest version.
const APP_VERSION = 'Oct 1 · 2';
const app = document.getElementById('app');

let store;
let view; // store.config with each round's matchups filled in (or marked pending)
let draft; // Friday's captains and the draft, from draftState()
let pickedSlot = null; // Setup: first player tapped in a swap
const drafts = {}; // unsent text in the composer and comment boxes, by field
let pendingMedia = []; // photos/videos picked for the next post: { file, url, type }
let posting = null; // { done, total, frac } while a post uploads
let renderQueued = false;
let advanceTimer = null; // moves to the next hole once everyone in the group has a score
const ui = loadUI();

// ---------- helpers ----------

function loadUI() {
  try {
    return { tab: 'board', hole: 1, ...JSON.parse(localStorage.getItem(UI_KEY)) };
  } catch {
    return { tab: 'board', hole: 1 };
  }
}
function saveUI() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Spectators are stored as "g:<name>"; they can post but not enter scores.
const GUEST = 'g:';
const playerName = (id) => (id?.startsWith(GUEST) ? id.slice(GUEST.length) : PLAYERS.find((p) => p.id === id)?.name ?? id);
const isPlayer = () => PLAYERS.some((p) => p.id === ui.me);
const isAdmin = () => ui.me === ORGANIZER;
const teamOf = (config, pid) => (config.teams || []).findIndex((t) => t.players.includes(pid));
// Each team's color is the captain's pick; grey for anyone before the draft.
const teamColor = (idx) => (idx >= 0 ? (view || store?.config)?.teams?.[idx]?.color || TEAM_COLORS[idx % TEAM_COLORS.length] : '#8a938a');
const teamName = (config, idx) => config.teams?.[idx]?.name || `Team ${idx + 1}`;
const captainOf = (config, idx) => config.teams?.[idx]?.players[0];
// Points with a ½ glyph, like a Cup scoreboard: 7.5 -> 7½.
const fmtHalf = (n) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ''}½`);
// Player points can be quarters (Quicksands points are split four ways).
const fmtQuarter = (n) => {
  const whole = Math.floor(n + 1e-9);
  const frac = { 25: '¼', 50: '½', 75: '¾' }[Math.round((n - whole) * 100)] || '';
  return `${whole || (frac ? '' : '0')}${frac}`;
};
const fmtPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
const fmtToPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
const fmtMoney = (n) => (n === 0 ? '$0' : n > 0 ? `+$${n}` : `−$${-n}`);
const sideLabel = (side) => (side.players.length > 2 ? teamName(view, side.team) : side.players.map(playerName).join(' & '));
const dayName = (r) => esc(r.day.split(' ')[0]);
const todayStr = () => new Date().toLocaleDateString('en-CA');

// A score with its scorecard mark: circle, double circle, square, double square.
function marked(score, par) {
  if (!score) return '';
  return `<span class="mk ${scoreMark(score, par)}">${score}</span>`;
}

// Highest score allowed on a hole: triple bogey.
const MAX_OVER_PAR = 3;
const SCORE_NAMES = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double', 3: 'Triple' };
// Buttons on the score screen: an ace on par 3s and par 4s (some are
// drivable), otherwise eagle, up to the max.
const scoreChoices = (par) => {
  const list = [];
  for (let n = par <= 4 ? 1 : par - 2; n <= par + MAX_OVER_PAR; n++) list.push(n);
  return list;
};
const scoreName = (n, par) => (n === 1 ? 'Ace' : SCORE_NAMES[n - par] || '');

// Who's a 3 and who's a 12, for the Format panel.
function hcpList(config) {
  return HCP_BUCKETS.map((b) => `${b}s: ${esc(PLAYERS.filter((p) => (config.hcp?.[p.id] ?? HCP_BUCKETS[0]) === b).map((p) => p.name).join(', ') || 'nobody')}`).join(' · ');
}

// Handicap stroke holes for a player in a match, marked with a dot.
const strokeDot = '<span class="stk" title="Handicap stroke">●</span>';

const LEGEND = `<div class="legend">
  <span><span class="mk eagle">3</span> Eagle+</span>
  <span><span class="mk birdie">3</span> Birdie</span>
  <span><span class="mk bogey">5</span> Bogey</span>
  <span><span class="mk double">6</span> Double+</span>
</div>`;

function enabledRounds(config) {
  return config.rounds.filter((r) => r.enabled);
}

// Everyone in a tee group, with their team (-1 before the draft).
function groupPlayers(config, group) {
  return groupRoster(group).map((p) => ({ id: p.id, team: p.team >= 0 ? p.team : teamOf(config, p.id) }));
}
const inGroup = (config, group, pid) => groupPlayers(config, group).some((p) => p.id === pid);

// Done when every match is final (or, for Friday, everyone has every hole in).
function roundComplete(config, r) {
  if (r.pending) return false;
  if (r.format === 'stroke') {
    const ids = r.groups.flatMap((g) => g.players);
    return ids.every((p) => holesOf(r).every((h) => store.scores[r.id]?.[p]?.[h]));
  }
  const matches = buildMatches({ ...config, rounds: [r] });
  return matches.length > 0 && matches.every((m) => computeMatch(m, store.scores[r.id]).done);
}

// Today's round during the trip (the first one still going on a two-round
// day), otherwise the first round still in play.
function defaultRoundId(config) {
  const rounds = enabledRounds(config);
  if (!rounds.length) return null;
  const todays = rounds.filter((r) => r.date === todayStr());
  if (todays.length) return (todays.find((r) => !roundComplete(config, r)) || todays[todays.length - 1]).id;
  const open = rounds.find((r) => !roundComplete(config, r));
  return (open || rounds[rounds.length - 1]).id;
}

function currentRound() {
  const rounds = enabledRounds(view);
  let round = rounds.find((r) => r.id === ui.roundId);
  if (!round) {
    ui.roundId = defaultRoundId(view);
    round = rounds.find((r) => r.id === ui.roundId);
  }
  return round;
}

function groupLabel(config, group) {
  return groupPlayers(config, group).map((p) => esc(playerName(p.id))).join(' · ');
}

function groupTitle(round, gi) {
  return `Group ${gi + 1}${round.tees?.[gi] ? ` · ${esc(round.tees[gi])}` : ''}`;
}

const FORMAT_LABELS = { stroke: 'Captain Round', match: 'Match play', teamstroke: 'Team stroke play', escalating: 'Escalating singles' };

// Shown in place of a round's matches until its matchups are set.
function pendingNote(config, round) {
  if (round.waitingOn === 'draft') {
    return `<div class="card tbd">
      <div class="tbd-title">Teams TBD</div>
      <p>Set by Friday's draft. The two low scores at Indian Canyon are the captains and pick the teams.</p>
    </div>`;
  }
  if (round.needsPicks) return tuePicksCard(config, round);
  if (round.needsPuttoff) {
    return `<div class="card tbd">
      <div class="tbd-title">Putt-off needed</div>
      <p>The teams are dead even after every tiebreaker. The putt-off decides who picks ${dayName(round)}'s matchups (see the Leaderboard).</p>
    </div>`;
  }
  const now = round.leaderNow != null ? `<p class="muted">If it ended now: ${esc(teamName(config, round.leaderNow))} would pick.</p>` : '';
  return `<div class="card tbd">
    <div class="tbd-title">${dayName(round)} matchups TBD</div>
    <p>Once every match through Monday is final, the captains set the front 9 singles matchups Monday night, Presidents Cup style
      (the trailing team puts a player out first). Front 9 matches are worth 1, then opponents swap for the back 9, also worth ${ESCALATING_BACK_POINTS}.</p>
    ${now}
  </div>`;
}

// ---------- shared components ----------

// Short day name, with AM/PM on a two-round day.
function roundDay(r) {
  const same = enabledRounds(view).filter((x) => x.date === r.date);
  return same.length > 1 ? `${dayName(r)} ${same.indexOf(r) === 0 ? 'AM' : 'PM'}` : dayName(r);
}

function roundChips(activeId) {
  return `<div class="chips" role="tablist">${enabledRounds(view).map((r) => `
    <button class="chip ${r.id === activeId ? 'on' : ''}" data-action="round" data-id="${r.id}">
      <span>${roundDay(r)}</span><small>${esc(r.course)}</small>
    </button>`).join('')}</div>`;
}

function teamDot(idx) {
  return `<span class="dot" style="background:${teamColor(idx)}"></span>`;
}

const matchKind = (match) => match.label || (match.type === 'bestball' ? 'Best Ball · Front 9' : 'Singles · Back 9');

function matchCard(match, res, { compact = false } = {}) {
  const label = matchKind(match);
  const thru = res.played === 0 ? '' : res.done ? 'Final' : `Thru ${res.played}`;
  // 🔥 for winning 2+ holes in a row, 🥶 for the side on the wrong end of it.
  const streak = !res.done ? matchStreak(res) : null;
  const row = (side, si) => {
    const lead = res.leader === si;
    const badge = streak?.n >= 2
      ? (streak.side === si ? `<span class="streak hot" title="Won ${streak.n} holes in a row">🔥${streak.n}</span>`
        : '<span class="streak cold" title="Lost the last holes">🥶</span>') : '';
    const pts = res.points ? `<span class="pts">${fmtPts(res.points[si])} pt</span>` : '';
    let tag = '';
    if (lead) tag = `<span class="tag ${res.done ? 'win' : 'up'}">${esc(res.status)}</span>`;
    return `<div class="side ${lead ? 'lead' : ''} ${res.done && res.leader !== null && !lead ? 'lost' : ''}">
      ${teamDot(side.team)}
      <span class="who">${esc(sideLabel(side))}${badge}</span>
      ${tag}${pts}
    </div>`;
  };
  const center = res.leader === null && res.played > 0
    ? `<div class="as ${res.done ? 'win' : ''}">${esc(res.status)}</div>` : '';
  return `<article class="match ${compact ? 'compact' : ''} ${res.done ? 'done' : res.played ? 'live' : ''}">
    <header><span>${label}</span><span class="thru">${thru}</span></header>
    ${row(match.sides[0], 0)}${center}${row(match.sides[1], 1)}
  </article>`;
}

// True once every match of every counting round is final.
function tripFinal(config, scores) {
  const rounds = enabledRounds(config);
  const matches = buildMatches(config);
  return matches.length > 0 && !rounds.some((r) => r.pending)
    && matches.every((m) => computeMatch(m, scores[m.roundId]).done);
}

// ---------- Tiebreakers ----------

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

function fmtTieValue(key, v) {
  if (key === 'wins') return `${v} won`;
  if (key === 'margin') return v > 0 ? `+${v}` : String(v);
  if (key === 'strokes') return `${v} strokes`;
  if (key === 'puttoff') return v ? ORDINALS[v - 1] : '–';
  return String(v);
}

// Step-by-step breakdown of each tie, down the tiebreaker list until it's
// settled, with putt-off buttons if it comes to that.
// With two teams a putt-off always matters: it decides who picks Tuesday's
// matchups, or who wins the Cup.
function puttoffMatters(ranked, teams) {
  return teams.length > 1;
}

function tiePanel(config, title, sub, ties, stage, ranked) {
  const name = (idx) => esc(config.teams[idx].name);
  const names = (idxs) => idxs.map(name).join(' & ');
  const puttoffUndo = (key) => `<button class="link" data-action="puttoff-reset" data-stage="${stage}" data-key="${key}">Undo putt-off</button>`;

  const stepHtml = (step, tie) => {
    const order = step.outcome.flat();
    const result = step.outcome.length === 1 ? 'Still tied → next tiebreaker'
      : step.outcome.every((g) => g.length === 1)
        ? (order.length === 2 ? `✓ ${name(order[0])} wins` : `✓ Order: ${order.map(name).join(', ')}`)
        : `✓ ${step.outcome.map((g) => (g.length > 1 ? `${names(g)} still tied` : name(g[0]))).join(' › ')}`;
    const undo = step.key === 'puttoff' ? puttoffUndo(puttoffKey(order)) : '';
    // A putt-off still in progress is shown once, in its own card below.
    if (step.key === 'puttoff' && tie.pending?.some((p) => p.key === puttoffKey(order))) return '';
    return `<div class="tie-step">
      <div class="step-label">${step.n}. ${esc(step.label)}</div>
      <div class="step-vals">${order.map((idx) => `
        <span>${teamDot(idx)}${name(idx)} <b>${fmtTieValue(step.key, step.values[idx])}</b></span>`).join('')}</div>
      <div class="step-result ${step.outcome.length === 1 ? 'still' : ''}">${result} ${undo}</div>
    </div>`;
  };

  const pendingHtml = (p) => {
    const left = p.teams.filter((t) => !p.done.includes(t));
    const sofar = p.done.length
      ? `<p>So far: ${p.done.map((t, i) => `<b>${ORDINALS[i]}</b> ${name(t)}`).join(', ')}</p>` : '';
    if (!puttoffMatters(ranked, left)) {
      return `<div class="tie-step">
        <div class="step-label">${TIEBREAKERS.length}. Putt-off</div>
        ${sofar}
        <p class="muted">${names(left)} stay tied. No putt-off needed.</p>
        ${p.done.length ? puttoffUndo(p.key) : ''}
      </div>`;
    }
    return `<div class="tie-step puttoff">
      <div class="step-label">${TIEBREAKERS.length}. Putt-off ⛳</div>
      ${sofar}
      <p>${names(left)} are still dead even. Head to the putting green!</p>
      ${isPlayer() ? `<p class="muted">Tap the winner${left.length > 2 ? ', then the next finisher, and so on' : ''}:</p>
      <div class="puttoff-btns">${left.map((t) => `
        <button data-action="puttoff" data-stage="${stage}" data-key="${p.key}" data-team="${t}">${teamDot(t)}${name(t)}</button>`).join('')}</div>`
        : '<p class="muted">A player records the winner here.</p>'}
      ${p.done.length ? puttoffUndo(p.key) : ''}
    </div>`;
  };

  return `<div class="card tie-panel">
    <div class="tie-head">⚖️ Tiebreaker · ${title}</div>
    <p class="muted">${sub}</p>
    ${ties.map((tie) => `
      <div class="tie">
        <div class="tie-title">Tied on ${fmtPts(tie.points)} pts: ${names(tie.teams)}</div>
        ${tie.steps.map((st) => stepHtml(st, tie)).join('')}
        ${(tie.pending || []).map(pendingHtml).join('')}
      </div>`).join('')}
  </div>`;
}

// How the tournament works, for the Format dropdown on the Leaderboard.
function formatInfo(config) {
  const total = enabledRounds(config).reduce((a, r) => a + roundPoints(r), 0);
  return `<div class="info-panel">
    <p><b>Friday · Captain Round.</b> Stroke play at Indian Canyon, no points or skins. The two low scores are the captains
      (tie: lower back 9, then a putt-off). They draft the two teams of 4 right here: low score picks first, then they alternate.</p>
    <p><b>Sat · Sun · Mon · Match play.</b> Two groups of 4, with two players from each team in each group.</p>
    <ul>
      <li><b>Front 9: Best ball.</b> 2 v 2. Everyone plays their own ball; the lower score on each side counts.</li>
      <li><b>Back 9: Singles.</b> 1 v 1 against a player from the other team.</li>
    </ul>
    <p>Partners rotate so you play with each teammate once and face three different opponents. 6 points a day.</p>
    <p><b>Mon AM · Quicksands.</b> Team stroke play over 14 par 3s. All four net scores on each team count; the lower team total wins
      ${TEAMSTROKE_POINTS} points (tie = 1 each). Plus ${BIRDIE_POINTS} point for the team with the most birdies (eagles count, gross; tie = ½ each).</p>
    <p><b>Tuesday · Singles.</b> Monday night the captains set the front 9 matchups in turn: one puts a player out, the other picks who plays him.
      The trailing team puts out first, so the team in first answers twice; match 4 is whoever's left. On the back 9 you play the other guy
      in your group. 1 point a nine, ${roundPoints({ format: 'escalating' })} points.</p>
    <p><b>Points:</b> Win = 1 · Tie = ½ · Loss = 0. ${total} points in all, so ${fmtHalf(total / 2 + 0.5)} wins the Cup.
      Level at the end goes to the tiebreakers: there's no shared Cup.</p>
    <p><b>Handicaps:</b> everyone plays as a 3 or a 12 (${hcpList(config)}). In the Sat–Mon and Tuesday matches, a 12 gets
      ${STROKES_PER_NINE} strokes a nine against a 3, one on each of the ${STROKES_PER_NINE} hardest holes of that nine (● on the score screen).
      Best ball strokes go off the lowest player in the group. 3 v 3 or 12 v 12: no strokes. At Quicksands each 12 takes
      ${TEAMSTROKE_STROKES} off his total. Friday, skins and birdies are gross. Enter your real score; the app does the math.</p>
    <p><b>Max score:</b> triple bogey (par + 3) on every hole.</p>
    <p><b>Reading a match:</b> <i>2 UP thru 6</i> = leading by 2 holes after 6. <i>A/S</i> = all square. <i>Dormie</i> = up by
      exactly the holes left. <i>Won 3&2</i> = 3 up with 2 to play.</p>
    <p><b>Skins:</b> every par 3 at the four main courses plus every hole at Quicksands, all 8 players. The outright low score
      wins $${SKIN_STAKE} from each of the other 7; any tie and nobody wins it. Nothing carries over.</p>
  </div>`;
}

// Quicksands: team-vs-team cards, one for net score to par and one for
// the birdie point.
function strokeCard(config, match, res) {
  const birdies = match.type === 'teambirdies';
  const side = (si) => {
    const s = res.sides[si];
    const t = match.sides[si].team;
    const lead = res.leader === si;
    const lost = res.done && res.leader !== null && !lead;
    const off = s.strokes - (s.net ?? s.strokes); // handicap strokes taken so far
    const shown = birdies ? `<div class="bc-names">${s.birdies} 🐦</div><div class="bc-sub">birdie${s.birdies === 1 ? '' : 's'}</div>`
      : `<div class="bc-names">${fmtToPar(s.toPar)} net</div><div class="bc-sub">${s.strokes} gross${off ? ` · −${off} hcp` : ''}</div>`;
    return `<div class="bc-side ${si ? 'b' : 'a'} ${lead ? 'lead' : 'trail'} ${lost ? 'lost' : ''}" style="--c:${teamColor(t)}">
      <div class="bc-team">${esc(teamName(config, t))}</div>
      ${s.entered ? shown
        : !birdies && off ? `<div class="bc-names">${fmtToPar(s.toPar)} net</div><div class="bc-sub">−${off} hcp · not started</div>`
          : `<div class="bc-names">${match.sides[si].players.map((p) => esc(playerName(p))).join(' / ')}</div>`}
    </div>`;
  };
  let status;
  if (!res.projected && !birdies && res.leader !== null) {
    // Quicksands before anyone tees off: the 12s' strokes are already in.
    status = `<div class="bc-status up ${res.leader === 0 ? 'left' : 'right'}" style="--c:${teamColor(match.sides[res.leader].team)}">
      <div class="big">${res.up}</div><div class="small">stroke head start</div></div>`;
  } else if (!res.projected) {
    status = '<div class="bc-status"><div class="big">–</div><div class="small">Not started</div></div>';
  } else if (res.done) {
    const big = res.leader === null ? 'Tied' : birdies ? esc(res.status) : `By ${res.up}`;
    status = `<div class="bc-status final"><div class="big ${res.leader === null ? 'sm' : ''}">${big}</div><div class="small">Final</div></div>`;
  } else if (res.leader === null) {
    status = `<div class="bc-status"><div class="big">${birdies ? 'Even' : 'A/S'}</div><div class="small">Thru ${res.played}</div></div>`;
  } else {
    status = `<div class="bc-status up ${res.leader === 0 ? 'left' : 'right'}" style="--c:${teamColor(match.sides[res.leader].team)}">
      <div class="big">${birdies ? esc(res.status) : res.up}</div><div class="small">${birdies ? 'birdies' : `stroke${res.up === 1 ? '' : 's'} up`}</div></div>`;
  }
  return `<article class="bc-match">
    <div class="bc-kind"><span>${esc(match.label)}</span><span>${res.done ? 'Final' : res.projected ? `All thru ${res.played}` : ''}</span></div>
    <div class="bc-bar">${side(0)}${status}${side(1)}</div>
  </article>`;
}

// TV-broadcast style match bar for the Leaderboard: the leading side lights
// up in its team color, the middle box shows the score, and a hole-by-hole
// strip above shows who won each hole.
function broadcastCard(config, match, res) {
  if (isTeamMatch(match)) return strokeCard(config, match, res);
  const color = (si) => teamColor(match.sides[si].team);
  const kind = matchKind(match);
  const streak = !res.done ? matchStreak(res) : null;
  const side = (si) => {
    const s = match.sides[si];
    const lead = res.leader === si;
    const lost = res.done && res.leader !== null && !lead;
    const badge = streak?.n >= 2 ? (streak.side === si ? ` <span class="bc-streak">🔥${streak.n}</span>` : ' <span class="bc-streak">🥶</span>') : '';
    return `<div class="bc-side ${si ? 'b' : 'a'} ${lead ? 'lead' : 'trail'} ${lost ? 'lost' : ''}" style="--c:${color(si)}">
      <div class="bc-team">${esc(teamName(config, s.team))}</div>
      <div class="bc-names">${s.players.map((p) => esc(playerName(p))).join(' / ')}${badge}</div>
    </div>`;
  };
  let status;
  if (res.played === 0) {
    status = '<div class="bc-status"><div class="big">–</div><div class="small">Not started</div></div>';
  } else if (res.done) {
    const big = res.leader === null ? 'Halved' : esc(res.status.replace('Won ', ''));
    status = `<div class="bc-status final"><div class="big ${res.leader === null ? 'sm' : ''}">${big}</div><div class="small">Final</div></div>`;
  } else if (res.leader === null) {
    status = `<div class="bc-status"><div class="big">A/S</div><div class="small">Thru ${res.played}</div></div>`;
  } else {
    const dormie = res.up === res.remaining ? 'Dormie<br>' : '';
    status = `<div class="bc-status up ${res.leader === 0 ? 'left' : 'right'}" style="--c:${color(res.leader)}">
      <div class="big">${res.up} UP</div><div class="small">${dormie}Thru ${res.played}</div></div>`;
  }
  const holes = res.holes.map((h) => {
    if (h.winner === 0 || h.winner === 1) return `<div class="w" style="--c:${color(h.winner)}">${h.hole}</div>`;
    return `<div class="${h.winner === 'halve' ? 'h' : ''}">${h.hole}</div>`;
  }).join('');
  return `<article class="bc-match">
    <div class="bc-kind"><span>${kind}</span><span>${res.done ? 'Final' : res.played ? `Thru ${res.played}` : ''}</span></div>
    ${res.played ? `<div class="bc-holes">${holes}</div>` : ''}
    <div class="bc-bar">${side(0)}${status}${side(1)}</div>
  </article>`;
}

// "Your match" card at the top of the Leaderboard: your round today, otherwise
// a countdown to your next tee time (Friday's Captain Round has no countdown).
function yourMatchCard(config, standings) {
  const rounds = enabledRounds(config);
  if (!rounds.length || tripFinal(config, store.scores)) return '';
  const today = todayStr();
  const daysUntil = (date) => Math.round((new Date(`${date}T00:00`) - new Date(`${today}T00:00`)) / 86400000);
  const me = isPlayer() ? ui.me : null;
  const todays = rounds.filter((r) => r.date === today);
  const todayRound = todays.find((r) => !roundComplete(config, r)) || todays[todays.length - 1];
  const todayCard = todayRound && me ? todayMatchCard(config, standings, todayRound, me) : '';
  if (todayCard) return todayCard;

  // Friday's players count down to the Captain Round; everyone else to Saturday.
  const next = rounds.find((r) => r.date > today
    && (r.format !== 'stroke' || (me && r.groups.some((g) => inGroup(config, g, me)))));
  if (!next) return '';
  const days = daysUntil(next.date);
  const beforeTrip = today < rounds[0].date;
  const when = days === 1 ? 'Tomorrow' : beforeTrip ? `${days} days to tee off` : `${dayName(next)} · in ${days} days`;
  let sub = '';
  const gi = me && !next.pending ? next.groups.findIndex((g) => inGroup(config, g, me)) : -1;
  if (gi >= 0 && next.format === 'stroke') {
    const others = next.groups[gi].players.filter((p) => p !== me).map((p) => esc(playerName(p)));
    sub = `${next.tees?.[gi] ? `${esc(next.tees[gi])} · ` : ''}Captain Round with ${others.join(' & ')} · low 2 are captains`;
  } else if (gi >= 0) {
    const g = next.groups[gi];
    const mine = g.a.includes(me) ? g.a : g.b;
    const opp = mine === g.a ? g.b : g.a;
    const tee = esc(next.tees?.[gi] || '');
    if (next.format === 'match') {
      sub = `${tee} · Best ball with ${esc(playerName(mine.find((p) => p !== me)))} vs ${opp.map((p) => esc(playerName(p))).join(' & ')}`;
    } else if (next.format === 'escalating') {
      const i = mine.indexOf(me);
      sub = `${tee} · Front 9 vs ${esc(playerName(opp[i]))}, back 9 vs ${esc(playerName(opp[1 - i]))}`;
    } else {
      sub = `${tee} · ${FORMAT_LABELS[next.format]}`;
    }
  } else if (next.waitingOn === 'draft') {
    sub = "Teams set by Friday's draft";
  } else if (next.needsPicks) {
    sub = `${esc(teamName(config, next.leader))} is setting the matchups`;
  } else if (next.pending) {
    sub = 'Matchups TBD';
  } else if (next.tees?.length) {
    sub = `First tee ${esc(next.tees[0])}`;
  }
  const detail = `${dayName(next)} · ${esc(next.course)}${sub ? `<div class="yours-sub">${sub}</div>` : ''}`;
  return `<div class="yours card countdown">
    <div class="yours-kicker">${beforeTrip ? 'Countdown' : 'Next up'}</div>
    <div class="yours-title">⛳ ${when}</div>
    <div class="yours-detail">${detail}</div>
  </div>`;
}

// Your round today: Friday's Captain Round, Quicksands, or your live match.
function todayMatchCard(config, standings, round, me) {
  const kicker = `Today · ${roundDay(round)} · ${esc(round.course)}`;
  if (round.pending) {
    return `<div class="yours card"><div class="yours-kicker">${kicker}</div>
      <div class="yours-title">${round.waitingOn === 'draft' ? 'Teams TBD' : 'Matchups TBD'}</div>
      <p class="muted">${round.waitingOn === 'draft' ? "Set by Friday's draft." : 'Set once the earlier rounds are final.'}</p></div>`;
  }
  const gi = round.groups.findIndex((g) => inGroup(config, g, me));
  if (gi < 0) return '';
  const tee = round.tees?.[gi];
  const go = `<button class="btn yours-go" data-action="go-scores" data-round="${round.id}" data-group="${gi}">Enter scores →</button>`;
  if (round.format === 'stroke') {
    const r = draft.cr?.rows.find((x) => x.id === me);
    return `<div class="yours card"><div class="yours-kicker">${kicker}</div>
      <div class="yours-title">Captain Round</div>
      <p class="muted">Straight stroke play. The two low scores are the captains.${r?.done ? ` You shot <b>${r.gross}</b> (${fmtToPar(r.toPar)}).` : r?.thru ? ` You're <b>${fmtToPar(r.toPar)}</b> thru ${r.thru}.` : ''}</p>${go}</div>`;
  }
  if (round.format === 'teamstroke') {
    const ms = standings.matches.filter((x) => x.match.roundId === round.id);
    return `<div class="yours bc-wrap">
      <div class="bc-top"><span>Your round · ${roundDay(round)}</span><span class="yours-tee">${ms[0]?.result.projected ? esc(round.course) : `Tee time ${esc(tee || '')}`}</span></div>
      <div class="yours-body">${ms.map((m) => strokeCard(config, m.match, m.result)).join('')}</div>${go}</div>`;
  }
  const mine = standings.matches.filter((m) => m.match.roundId === round.id && m.match.group === gi
    && m.match.sides.some((sd) => sd.players.includes(me)));
  const current = mine.find((m) => !m.result.done);
  if (current) {
    return `<div class="yours bc-wrap">
      <div class="bc-top"><span>Your match · ${roundDay(round)}</span><span class="yours-tee">${current.result.played ? esc(round.course) : `Tee time ${esc(tee || '')}`}</span></div>
      <div class="yours-body">${broadcastCard(config, current.match, current.result)}</div>
      ${go}
    </div>`;
  }
  const lines = mine.map(({ match, result }) => {
    const si = match.sides.findIndex((sd) => sd.players.includes(me));
    const outcome = result.leader === null ? 'Halved' : result.leader === si ? result.status : `Lost ${result.status.replace('Won ', '')}`;
    return `<div class="kv"><span>${esc(matchKind(match))}</span><b>${esc(outcome)}</b></div>`;
  }).join('');
  const pts = mine.reduce((a, { match, result }) => a + (result.points?.[match.sides.findIndex((sd) => sd.players.includes(me))] || 0), 0);
  return `<div class="yours card"><div class="yours-kicker">${kicker}</div>
    <div class="yours-title">You're done · ${fmtHalf(pts)} pt${pts === 1 ? '' : 's'}</div>${lines}</div>`;
}

// ---------- Friday: Captain Round and the draft ----------

// Friday's stroke play board: live to par, then final with the captains.
function captainBoard(config) {
  const cr = draft.cr;
  if (!cr) return '';
  const started = cr.rows.some((r) => r.thru);
  const final = cr.allDone;
  const caps = draft.captains || [];
  // Masters colors: red under par, green even or over.
  const num = (v) => `<span class="${v < 0 ? 'ms-red' : 'ms-grn'}">${v === 0 ? 'E' : v < 0 ? -v : `+${v}`}</span>`;
  const rows = cr.rows.map((r, i) => {
    const cap = final ? caps.includes(r.id) : started && i < 2 && r.thru > 0;
    const first = final && caps[0] === r.id;
    // Tiebreak notes only where they decide a captain spot or the first pick.
    const tb = final && r.tiebreak && i < 3 && !(r.unresolved && !cr.puttoff?.players.includes(r.id)) ? r.tiebreak : null;
    const note = [first ? 'picks first' : '', tb ? (r.unresolved ? 'still tied' : `on ${esc(tb.toLowerCase())}`) : ''].filter(Boolean).join(' · ');
    return `<div class="ms-row ${cap ? 'cap' : ''}">
      <span class="ms-pos">${r.thru ? `${cr.rows.filter((x) => x.rank === r.rank && x.thru).length > 1 ? 'T' : ''}${r.rank}` : ''}</span>
      <span class="ms-name">${esc(playerName(r.id).toUpperCase())}${cap ? '<i class="ms-c" title="Captain">C</i>' : ''}${note ? `<small>${note}</small>` : ''}</span>
      <span class="ms-par">${r.thru ? num(r.toPar) : '<span class="ms-grn">–</span>'}</span>
      <span class="ms-thru">${r.done ? 'F' : r.thru || ''}</span>
      <span class="ms-tot">${r.thru ? (r.done && tb ? `${r.gross}<small>${r.back} in</small>` : r.gross) : ''}</span>
    </div>`;
  }).join('');
  // Below the leaders: a normal scorecard (actual scores, birdies circled,
  // bogeys squared), with out, in and total.
  const holes = holesOf(cr.round);
  const [front, back] = halvesOf(cr.round);
  const pars = config.pars?.[cr.round.id] || {};
  const sum = (hs, get) => hs.reduce((a, h) => a + (get(h) || 0), 0);
  const cols = (get, sub) => `${front.map((h) => `<td>${get(h)}</td>`).join('')}<td class="ms-sum">${sub(front)}</td>
    ${back.map((h) => `<td>${get(h)}</td>`).join('')}<td class="ms-sum">${sub(back)}</td><td class="ms-sum">${sub(holes)}</td>`;
  const grid = cr.rows.map((r) => {
    const sc = store.scores[cr.round.id]?.[r.id] || {};
    return `<tr><th>${esc(playerName(r.id).toUpperCase())}</th>${cols((h) => marked(sc[h], pars[h]), (hs) => sum(hs, (h) => sc[h]) || '')}</tr>`;
  }).join('');
  const bigBoard = started ? `<div class="ms-big"><table>
      <tr class="ms-hole"><th>HOLE</th>${front.map((h) => `<td>${h}</td>`).join('')}<td>OUT</td>${back.map((h) => `<td>${h}</td>`).join('')}<td>IN</td><td>TOT</td></tr>
      <tr class="ms-parrow"><th>PAR</th>${cols((h) => pars[h] ?? '', (hs) => sum(hs, (h) => pars[h]))}</tr>
      ${grid}</table></div>` : '';
  let puttoff = '';
  if (cr.puttoff && !draft.manual) {
    const left = cr.puttoff.players.filter((p) => !cr.puttoff.done.includes(p));
    puttoff = `<div class="tie-step puttoff">
      <div class="step-label">Putt-off ⛳</div>
      <p>${left.map((p) => esc(playerName(p))).join(' & ')} are dead even on total and back 9. Head to the putting green!</p>
      ${isPlayer() ? `<p class="muted">Tap the winner${left.length > 2 ? ', then the next finisher' : ''}:</p>
        <div class="puttoff-btns">${left.map((p) => `<button data-action="cap-puttoff" data-key="${cr.puttoff.key}" data-player="${p}">${esc(playerName(p))}</button>`).join('')}</div>` : ''}
      ${cr.puttoff.done.length ? `<button class="link" data-action="cap-puttoff-reset" data-key="${cr.puttoff.key}">Undo putt-off</button>` : ''}
    </div>`;
  }
  const sub = draft.manual ? 'Captains were set by hand in Setup.'
    : final ? (caps.length ? 'The two low scores are the captains.' : 'Tied for a captain spot after the back 9.')
      : started ? 'Live. The top two when everyone finishes are the captains (tie: lower back 9, then a putt-off).'
        : 'Straight stroke play. The two low scores are the captains.';
  return `<div class="card cr-card masters">
    <div class="ms-top"><span class="ms-title">Leaders</span><span class="ms-course">${esc(cr.round.course)} · Captain Round</span></div>
    <div class="ms-board">
      <div class="ms-row ms-cols"><span class="ms-pos">Pos</span><span class="ms-name">Player</span><span class="ms-par">Score</span><span class="ms-thru">Thru</span><span class="ms-tot">Tot</span></div>
      ${rows}
    </div>
    ${bigBoard}
    <p class="ms-sub">${sub}</p>
    ${puttoff}
  </div>`;
}

// The live draft: captains alternate picks, low score first. Every pick
// shows up on everyone's phone. Once it's done, captains name their team and
// pick a color.
function draftCard(config) {
  const d = draft;
  if (d.stage === 'captains') return '';
  const total = PLAYER_IDS.length - 2;
  const color = (i) => (config.teams?.[i]?.color) || TEAM_COLORS[i];
  const canPick = isAdmin() || ui.me === d.captains[d.turn];
  const started = !!store.config.draft?.started;
  const replay = (p) => `<button class="dr-replay" data-action="replay-reveal" data-player="${p}">${esc(playerName(p))} ▶</button>`;
  const cols = [0, 1].map((i) => {
    const slots = Array.from({ length: total / 2 }, (_, k) => {
      const p = d.rosters[i][k + 1];
      return `<li class="${p ? '' : 'open'}">${p ? replay(p) : `Pick ${k * 2 + i + 1}`}</li>`;
    }).join('');
    const name = d.stage === 'done' ? esc(teamName(config, i)) : `Team ${esc(playerName(d.captains[i]))}`;
    return `<div class="dr-team ${d.turn === i ? 'turn' : ''}" style="--c:${color(i)}">
      <div class="dr-name">${name}</div>
      <div class="dr-cap">${started ? replay(d.captains[i]) : esc(playerName(d.captains[i]))} <small>Captain</small></div>
      <ol>${slots}</ol>
    </div>`;
  }).join('');
  let action = '';
  const room = audioUnlocked ? '<div class="dr-room on">🎧 You\'re in the draft room</div>'
    : '<button class="btn dr-room" data-action="enter-room">🎧 Enter the draft room <small>turns on the music</small></button>';
  if (d.stage === 'drafting' && !started) {
    action = `<div class="dr-clock">🎬 The draft starts later tonight. <b>${esc(playerName(d.captains[0]))}</b> picks first.</div>
      ${room}
      ${isAdmin() ? '<button class="btn dr-start" data-action="draft-start">Start the draft</button>' : '<p class="muted dr-wait">Tate starts it when everyone\'s together.</p>'}`;
  } else if (d.stage === 'drafting') {
    const on = esc(playerName(d.captains[d.turn]));

    action = `<div class="dr-clock">Pick ${d.picks.length + 1} of ${total} · <b>${on}</b> is on the clock</div>
      ${audioUnlocked ? '' : room}
      <button class="btn dr-start" data-action="draft-room-open">🎬 Open the draft room</button>
      ${canPick ? `<div class="dr-pool">${d.pool.map((p) => `<button data-action="draft-pick" data-player="${p}">${esc(playerName(p))}</button>`).join('')}</div>`
        : `<p class="muted dr-wait">Waiting on ${on}… Picks show up here live.</p>`}
      ${isAdmin() && d.picks.length ? '<button class="link" data-action="draft-undo">Undo last pick</button>' : ''}`;
  } else {
    const mine = [0, 1].filter((i) => isAdmin() || ui.me === d.captains[i]);
    action = mine.length ? mine.map((i) => `<div class="dr-edit" style="--c:${color(i)}">
        <label>${mine.length > 1 ? `${esc(playerName(d.captains[i]))}'s team` : 'Your team'}
          <input type="text" id="team-name-${i}" value="${esc(teamName(config, i))}" data-edit="team-name" data-team="${i}" maxlength="24" enterkeyhint="done"></label>
        <div class="swatches">${TEAM_COLORS.map((c) => {
          const taken = color(1 - i) === c;
          return `<button class="sw ${color(i) === c ? 'on' : ''}" style="--sw:${c}" data-action="team-color" data-team="${i}" data-color="${c}" ${taken ? 'disabled' : ''} aria-label="Color"></button>`;
        }).join('')}</div>
      </div>`).join('') : '<p class="muted">The captains can name their teams and pick colors here.</p>';
  }
  return `<div class="card dr-card">
    <div class="cr-head"><span>🎯 ${d.stage === 'done' ? 'The teams' : 'The Draft'}</span><span>${d.stage === 'done' ? 'Draft complete · tap a name to rewatch' : started ? 'Live' : 'Starts tonight'}</span></div>
    <div class="dr-cols">${cols}</div>
    ${action}
  </div>`;
}

// ---------- Tuesday: the matchup draft ----------

// Monday night on the Leaderboard: who's picking and the matchups so far.
// The picking itself happens in the draft room.
function tuePicksCard(config, round) {
  const L = round.leader;
  const td = store.config.tueDraft || {};
  const st = tueDraftState(store.config, L);
  const name = (p) => esc(playerName(p));
  const rows = [0, 1, 2, 3].map((m) => {
    const b = st.front[m];
    const label = `${esc(round.tees?.[m >> 1] || `Group ${(m >> 1) + 1}`)} · Match ${m + 1}`;
    return `<div class="tp-slot"><span class="tp-label">${label}</span>
      <span>${b ? `${teamDot(0)}${name(b[0])} <span class="vs">v</span> ${teamDot(1)}${name(b[1])}` : '<span class="muted">–</span>'}</span></div>`;
  }).join('');
  const room = audioUnlocked ? '<div class="dr-room on">🎧 You\'re in the draft room</div>'
    : '<button class="btn dr-room" data-action="enter-room">🎧 Enter the draft room <small>turns on the music</small></button>';
  const action = !td.started
    ? `${room}${isAdmin() ? '<button class="btn dr-start" data-action="tue-start">Start the matchups</button>'
      : '<p class="muted dr-wait">Tate starts it when everyone\'s together.</p>'}`
    : `${audioUnlocked ? '' : room}<button class="btn dr-start" data-action="draft-room-open">🎬 Open the draft room</button>`;
  return `<div class="card tp-card">
    <div class="cr-head"><span>👑 Tuesday matchups</span><span>${td.started ? 'Live' : 'Monday night'}</span></div>
    <p class="muted">${esc(teamName(config, L))} finished first. The captains set Tuesday's <b>front 9</b> matchups (1 pt each):
      ${name(captainOf(config, 1 - L))} puts a player out, ${name(captainOf(config, L))} picks who plays him, then they swap. The leader answers twice;
      match 4 is whoever's left. On the back 9 (1 pt each) you play the other guy in your group.</p>
    ${rows}
    ${action}
  </div>`;
}

// ---------- Skins ----------

const courseOf = (config, roundId) => config.rounds.find((r) => r.id === roundId)?.course || '';

function skinsCard(config) {
  const { holes, net } = computeSkins(config, store.scores, PLAYER_IDS, SKIN_STAKE);
  const won = holes.filter((h) => h.winner);
  const decided = holes.filter((h) => !h.waiting.length);
  if (!decided.length) {
    return `<div class="card sk-empty">💰 <b>${holes.length} skins</b> up for grabs: every par 3 at the main courses plus all 14 at Quicksands.
      The outright low score wins $${SKIN_STAKE} from each of the other ${PLAYER_IDS.length - 1}. Any tie, no skin.</div>`;
  }
  const count = {};
  won.forEach((h) => { count[h.winner] = (count[h.winner] || 0) + 1; });
  const pot = SKIN_STAKE * (PLAYER_IDS.length - 1);
  const rows = PLAYER_IDS.map((p) => ({ p, v: net[p], n: count[p] || 0 }))
    .sort((a, b) => b.v - a.v || playerName(a.p).localeCompare(playerName(b.p)));
  const recent = [...won].reverse().map((h) => `<div class="sk-hole">
      <span>${esc(courseOf(config, h.roundId))} #${h.hole}</span>
      <b>${esc(playerName(h.winner))} ${marked(h.score, h.par)}</b>
    </div>`).join('');
  const open = ui.info === 'settle';
  const pays = settleUp(net);
  return `<div class="card sk-card">
    <div class="sk-sum">${won.length} won · ${decided.length - won.length} tied · ${holes.length - decided.length} to play</div>
    <p class="sk-how">Win a skin and everyone else pays you $${SKIN_STAKE} ($${pot} a skin). You pay $${SKIN_STAKE} on every skin someone else wins.
      The number on the right is where you stand overall.</p>
    ${rows.map((r) => {
      const paid = r.n * pot - r.v;
      return `<div class="sk-row">
      <span class="sk-name">${teamDot(teamOf(config, r.p))}${esc(playerName(r.p))}</span>
      <span class="sk-n">${r.n ? `${r.n} skin${r.n === 1 ? '' : 's'} · won $${r.n * pot}` : ''}${paid ? `${r.n ? ' · ' : ''}paid $${paid}` : ''}</span>
      <b class="sk-v ${r.v > 0 ? 'up' : r.v < 0 ? 'down' : ''}">${fmtMoney(r.v)}</b>
    </div>`;
    }).join('')}
    ${recent ? `<div class="sk-recent">${recent}</div>` : ''}
    <button class="info-btn ${open ? 'on' : ''}" data-action="info" data-id="settle">Settle up ${open ? '▴' : '▾'}</button>
    ${open ? `<div class="sk-settle"><p class="sk-how">Everything combined into the fewest payments, so nobody has to send eight $5 Venmos.</p>${pays.length ? pays.map((x) => `<div class="kv"><span>${esc(playerName(x.from))} → ${esc(playerName(x.to))}</span><b>$${x.amount}</b></div>`).join('')
      : '<p class="muted">Everyone is even.</p>'}</div>` : ''}
  </div>`;
}

// Birdie Board: podium for the top 3, bars for everyone else with a birdie,
// and one line for whoever's still waiting on their first.
function birdieBoard(config, birdies) {
  const withBirdies = birdies.filter((b) => b.birdies > 0);
  if (!withBirdies.length) {
    return '<div class="card bb-empty">No birdies yet. The first one gets a shoutout in the Feed 🐦</div>';
  }
  const rankOf = (b) => 1 + birdies.filter((o) => o.birdies > b.birdies).length;
  const medal = (r) => ['🥇', '🥈', '🥉'][r - 1] || '';
  const max = withBirdies[0].birdies;
  const podium = withBirdies.slice(0, 3);
  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium; // 2nd, 1st, 3rd
  const rest = withBirdies.slice(3);
  const zeros = birdies.filter((b) => b.birdies === 0);
  return `<div class="card bb-card">
    <div class="podium n${podium.length}">${order.map((b) => {
      const r = rankOf(b);
      return `<div class="pod r${Math.min(r, 3)}" style="--c:${teamColor(teamOf(config, b.id))}">
        <div class="pod-medal">${medal(r)}</div>
        <div class="pod-name">${esc(playerName(b.id))}</div>
        <div class="pod-block"><span>${b.birdies}</span></div>
      </div>`;
    }).join('')}</div>
    ${rest.map((b) => `<div class="bb-row">
      <span class="bb-rank">${rankOf(b)}</span>
      <span class="bb-name">${teamDot(teamOf(config, b.id))} ${esc(playerName(b.id))}</span>
      <span class="bb-bar"><span style="width:${(b.birdies / max) * 100}%;background:${teamColor(teamOf(config, b.id))}"></span></span>
      <b>${b.birdies}</b>
    </div>`).join('')}
    ${zeros.length ? `<div class="bb-zero">Still hunting: ${zeros.map((b) => esc(playerName(b.id))).join(', ')}</div>` : ''}
  </div>`;
}

// ---------- Leaderboard ----------

function renderBoard() {
  const config = view;
  const { scores } = store;
  const standings = computeStandings(config, scores);
  const round = currentRound();
  const rounds = enabledRounds(config);
  const scoring = rounds.filter((r) => r.format !== 'stroke');
  const allIds = scoring.map((r) => r.id);
  const hasTeams = config.teams.length === 2;
  const allFinal = hasTeams && tripFinal(config, scores);

  // Tiebreakers only show at the two checkpoints: once everything through
  // Monday is final (until Tuesday starts), and at the very end.
  const tue = rounds.find((r) => r.format === 'escalating');
  const tueStarted = tue && standings.matches.some((m) => m.match.roundId === tue.id && m.result.played > 0);
  const seedStage = hasTeams && !allFinal && tue?.priorFinal && !tueStarted;
  const stage = seedStage ? 'seed' : 'final';
  const { ranked } = rankTeams(config, scores, seedStage ? tue.priorIds : allIds, stage);
  let panel = '';
  if (allFinal) {
    const { ties } = rankTeams(config, scores, allIds, 'final');
    if (ties.length) panel = tiePanel(config, 'The Cup', 'The teams finished level on points, so the tiebreakers decide the Cup.', ties, 'final', ranked);
  } else if (seedStage) {
    const { ties } = rankTeams(config, scores, tue.priorIds, 'seed');
    if (ties.length) panel = tiePanel(config, `Who picks ${dayName(tue)}`, `The teams are level on points after Monday, so the tiebreakers decide who sets ${dayName(tue)}'s matchups.`, ties, 'seed', ranked);
  }
  const showTiebreaks = !!panel;

  // Cup scoreboard: big points, team colors, the leader lit up, and a bar
  // toward the points it takes to win.
  const total = scoring.reduce((a, r) => a + roundPoints(r), 0);
  const toWin = total / 2 + 0.5;
  const leaderPts = Math.max(0, ...ranked.map((r) => r.points));
  const teamRows = ranked.map((r, i) => {
    const t = standings.teams[r.idx];
    const rank = i > 0 && ranked[i - 1].rank === r.rank ? '' : r.rank;
    const swing = t.projected - t.points;
    const live = swing > 0 ? `<div class="cup-live">+${fmtHalf(swing)} live</div>` : '';
    const tb = !showTiebreaks ? '' : r.unresolved ? '<div class="cup-tb">Tied on every tiebreaker</div>'
      : r.tiebreak ? `<div class="cup-tb">Ahead on tiebreaker: ${esc(r.tiebreak)}</div>` : '';
    const winner = allFinal && i === 0 && !r.unresolved;
    const lead = winner || (!allFinal && t.points > 0 && t.points === leaderPts);
    const pct = (n) => `${Math.min(100, (n / toWin) * 100)}%`;
    return `<div class="cup-row ${lead ? 'lead' : ''} ${winner ? 'winner' : ''}" style="--c:${teamColor(t.idx)}">
      <div class="cup-rank">${winner ? '🏆' : rank}</div>
      <div class="cup-team">
        <div class="cup-name">${esc(t.name)}</div>
        <div class="cup-players">${t.players.map(playerName).join(', ')} · ${t.w}-${t.l}-${t.h}</div>
        <div class="cup-bar"><span class="proj" style="width:${pct(t.projected)}"></span><span style="width:${pct(t.points)}"></span></div>
        ${tb}
      </div>
      <div class="cup-pts">${fmtHalf(t.points)}${live}</div>
    </div>`;
  }).join('');

  const roundMatches = standings.matches.filter((m) => m.match.roundId === round?.id);
  const birdies = Object.values(birdieCounts(config, scores, PLAYER_IDS)).sort((a, b) => (
    b.birdies - a.birdies || playerName(a.id).localeCompare(playerName(b.id))));

  const champ = allFinal ? ranked[0] : null;
  let champBanner = '';
  if (champ && !champ.unresolved) {
    champBanner = `<div class="champ" style="--team:${teamColor(champ.idx)}">
      <div class="champ-cup">🏆</div>
      <div><div class="champ-name">${esc(champ.name)} win the Cup</div>
      <div class="champ-sub">${champ.players.map(playerName).join(', ')} · ${fmtPts(champ.points)} pts${champ.tiebreak ? ` · on ${esc(champ.tiebreak.toLowerCase())}` : ''}</div>
      <button class="champ-link" data-action="tab" data-tab="recap">See the trip recap →</button></div>
    </div>`;
  } else if (champ) {
    champBanner = `<div class="champ">
      <div class="champ-cup">⛳</div>
      <div><div class="champ-name">Dead even for the Cup</div>
      <div class="champ-sub">Every tiebreaker is level. The putt-off decides it (see below).</div></div>
    </div>`;
  }

  // Top of the board: Friday's board and the draft until the teams are set
  // and Saturday starts, Tuesday's picks while the leader sets them, and
  // always your own match.
  const fri = rounds.find((r) => r.format === 'stroke');
  const firstMatch = scoring[0];
  const friLive = fri && (todayStr() >= fri.date || draft.cr?.rows.some((r) => r.thru));
  const satStarted = firstMatch && Object.keys(scores[firstMatch.id] || {}).length > 0;
  let feature = '';
  let featureKind = '';
  if (draft.stage === 'captains' && friLive) [feature, featureKind] = [captainBoard(config), 'captains'];
  else if (draft.stage !== 'captains' && !satStarted) [feature, featureKind] = [draftCard(config), 'draft'];
  else if (tue?.needsPicks) [feature, featureKind] = [tuePicksCard(config, tue), 'tue'];

  let matchesHtml;
  if (!round) matchesHtml = '<p class="empty">No rounds enabled.</p>';
  else if (round.format === 'stroke') {
    matchesHtml = `${featureKind === 'captains' ? '' : captainBoard(config)}${draft.stage !== 'captains' && featureKind !== 'draft' ? draftCard(config) : ''}`
      || '<p class="empty">The Captain Round is live at the top of the Leaderboard.</p>';
  } else if (round.pending) matchesHtml = round.needsPicks && featureKind === 'tue' ? '<div class="card tbd"><div class="tbd-title">Matchups being set</div><p>See the top of the Leaderboard.</p></div>' : pendingNote(config, round);
  else {
    matchesHtml = `${round.format === 'escalating' ? tueReplayCard(round) : ''}<div class="bc-wrap">
      <div class="bc-top"><span>Buckle Up · ${esc(FORMAT_LABELS[round.format])}</span>
        ${roundMatches.some((m) => (m.result.played > 0 || m.result.projected) && !m.result.done) ? '<span class="bc-live">LIVE</span>' : ''}</div>
      ${round.format === 'teamstroke'
        ? `<div class="bc-session"><span>${roundDay(round)} · ${esc(round.course)}</span><span>All four count · net</span></div>
          ${roundMatches.map((m) => strokeCard(config, m.match, m.result)).join('')}`
        : round.groups.map((g, gi) => `
          <div class="bc-session"><span>${roundDay(round)} · ${esc(round.course)}</span><span>${groupTitle(round, gi)}</span></div>
          ${roundMatches.filter((m) => m.match.group === gi).map((m) => broadcastCard(config, m.match, m.result)).join('')}`).join('')}
    </div>`;
  }

  return `
    ${recapBanner()}
    ${champBanner}
    ${yourMatchCard(config, standings)}
    ${feature}
    <section>
      <div class="cup">
        <div class="cup-head"><span>The Cup</span><span>${hasTeams ? `${fmtHalf(toWin)} of ${total} to win` : `${total} points`}</span></div>
        ${hasTeams ? teamRows : `<div class="cup-empty">Two teams of 4, picked by the captains in Friday's draft.</div>`}
      </div>
      ${panel}
      <div class="info-toggles">
        <button class="info-btn ${ui.info === 'format' ? 'on' : ''}" data-action="info" data-id="format">Format ${ui.info === 'format' ? '▴' : '▾'}</button>
        <button class="info-btn ${ui.info === 'tiebreakers' ? 'on' : ''}" data-action="info" data-id="tiebreakers">Tiebreakers ${ui.info === 'tiebreakers' ? '▴' : '▾'}</button>
      </div>
      ${ui.info === 'format' ? formatInfo(config) : ''}
      ${ui.info === 'tiebreakers' ? `<div class="info-panel">
        <p>If the teams are level on points (after Monday, for who sets Tuesday's matchups, and at the end, for the Cup):</p>
        <ol>${TIEBREAKERS.map((tb) => `<li>${tb.label}</li>`).join('')}</ol>
        <p><b>Holes-up margin</b> adds up how much each match was won or lost by (Won 3&2 = +3, lost 1 UP = −1). <b>Total strokes</b> is every player's score added up over the rounds that count. <b>Putt-off</b>: if it's still dead even, settle it on the putting green and record the winner here.</p>
        <p><b>Captains</b> (Friday): tied on total, the lower back 9 wins; still tied, a putt-off.</p>
      </div>` : ''}
    </section>
    <section>
      <h2>Matches</h2>
      ${roundChips(round?.id)}
      ${matchesHtml}
    </section>
    <section>
      <h2>Skins 💰</h2>
      ${skinsCard(config)}
    </section>
    <section>
      <h2>Birdie Board 🐦</h2>
      ${birdieBoard(config, birdies)}
    </section>`;
}

// ---------- Nightly recap card ----------
//
// Once a day's last match is final, the Leaderboard offers a summary card for
// the group chat: the Cup, the day's results, stars of the day and tomorrow's
// tee times and matchups (or, after Tuesday, the champion and settle-up).
// Tate gets a Share button so it's sent once; everyone else can open it.
// It goes away once the next round's first score is in.

// The latest day whose rounds are all final, while the next day hasn't started.
function recapDay() {
  const rounds = enabledRounds(view);
  const dates = [...new Set(rounds.map((r) => r.date))].sort();
  let day = null;
  for (const date of dates) {
    if (rounds.filter((r) => r.date === date).every((r) => roundComplete(view, r))) day = date;
    else break;
  }
  if (!day) return null;
  const started = rounds.some((r) => r.date > day && Object.keys(store.scores[r.id] || {}).length);
  return started ? null : day;
}
const weekday = (date) => new Date(`${date}T12:00`).toLocaleDateString('en-US', { weekday: 'long' });

function recapBanner() {
  const date = recapDay();
  if (!date) return '';
  const what = tripFinal(view, store.scores) ? 'The final recap' : `${weekday(date)}'s recap`;
  return isAdmin()
    ? `<button class="card rc-banner" data-action="recap-open"><span>📲 <b>${what} is ready</b></span><span class="rc-go">Share →</span></button>`
    : `<button class="rc-link" data-action="recap-open">📋 See ${what.replace('The final', 'the final')} →</button>`;
}

function recapCard(date) {
  const config = view;
  const { scores } = store;
  const rounds = enabledRounds(config);
  const todays = rounds.filter((r) => r.date === date);
  const nextDate = rounds.map((r) => r.date).filter((d) => d > date).sort()[0];
  const tomorrow = rounds.filter((r) => r.date === nextDate);
  const final = tripFinal(config, scores);
  const standings = computeStandings(config, scores);
  const hasTeams = config.teams.length === 2;
  const name = (p) => esc(playerName(p));
  const dot = (t) => `<span class="rc-dot" style="background:${teamColor(t)}"></span>`;
  const courses = todays.map((r) => esc(r.course)).join(' + ');
  const friday = todays.every((r) => r.format === 'stroke');

  // ---- Top: the Cup (or Friday's captains) ----
  let top;
  if (friday || !hasTeams) {
    const caps = draft.captains || [];
    top = `<div class="rc-title">${weekday(date)} final · ${courses}</div>
      <div class="rc-caps">${caps.length === 2 ? `🎖️ Captains: <b>${name(caps[0])}</b> (picks first) &amp; <b>${name(caps[1])}</b>` : 'Captains TBD'}</div>`;
  } else {
    const scoring = rounds.filter((r) => r.format !== 'stroke');
    const total = scoring.reduce((a, r) => a + roundPoints(r), 0);
    const pts = standings.teams.map((t) => t.points);
    const today = [0, 0];
    standings.matches.filter(({ match, result }) => todays.some((r) => r.id === match.roundId) && result.points)
      .forEach(({ match, result }) => match.sides.forEach((sd, si) => { today[sd.team] += result.points[si]; }));
    const left = total - pts[0] - pts[1];
    const lead = pts[0] > pts[1] ? 0 : pts[1] > pts[0] ? 1 : -1;
    let title = `${weekday(date)} final · ${courses}`;
    let champ = '';
    if (final) {
      const { ranked } = rankTeams(config, scores, scoring.map((r) => r.id), 'final');
      title = `Final · ${courses}`;
      if (!ranked[0].unresolved) champ = `<div class="rc-champ">🏆 ${esc(teamName(config, ranked[0].idx))} win the Cup</div>`;
    }
    const side = (t, r) => `<div class="rc-team ${r ? 'r' : ''} ${lead === t ? 'lead' : ''}">
      <span class="rc-tn">${esc(teamName(config, t))}</span><span class="rc-tp">${fmtHalf(pts[t])}</span></div>`;
    top = `<div class="rc-title">${title}</div>${champ}
      <div class="rc-cup">${side(0, false)}<div class="rc-mid">The Cup</div>${side(1, true)}</div>
      <div class="rc-bar"><i style="left:0;width:${(pts[0] / total) * 100}%;background:${teamColor(0)}"></i><i style="right:0;width:${(pts[1] / total) * 100}%;background:${teamColor(1)}"></i></div>
      <div class="rc-sub"><span>Today ${fmtHalf(today[0])}</span><span>${final ? `${total} points` : `${fmtHalf(total / 2 + 0.5)} to win · ${fmtHalf(left)} left`}</span><span>Today ${fmtHalf(today[1])}</span></div>`;
  }

  // ---- Today's results ----
  let results = '';
  if (friday) {
    const cr = draft.cr;
    const rows = (cr?.rows || []).map((r) => `<div class="rc-row"><span class="rc-kind">${r.rank}</span>
      <span>${(draft.captains || []).includes(r.id) ? '🎖️ ' : ''}<b>${name(r.id)}</b></span>
      <span class="rc-pill plain">${r.gross} <small>${fmtToPar(r.toPar)}</small></span></div>`).join('');
    results = `<div class="rc-sec"><div class="rc-h">Captain Round <small>Stroke play</small></div><div class="rc-box">${rows}</div></div>`;
    if (hasTeams) {
      results += `<div class="rc-sec"><div class="rc-h">The teams</div><div class="rc-teams">${config.teams.map((t, i) => `
        <div class="rc-box rc-roster" style="--t:${teamColor(i)}"><b>${esc(t.name)}</b>${t.players.map((p, j) => `<span>${j ? '' : '🎖️ '}${name(p)}</span>`).join('')}</div>`).join('')}</div></div>`;
    }
  } else {
    const row = ({ match, result: res }) => {
      const kind = { bestball: 'Best ball', teamstroke: 'Net total', teambirdies: 'Birdies' }[match.type]
        || (match.label?.includes('Front') ? 'Front 9' : match.label?.includes('Back') ? 'Back 9' : 'Singles');
      const lab = (si) => esc(sideLabel(match.sides[si]));
      if (res.leader === null) {
        const word = match.type === 'teambirdies' ? 'split it' : match.type === 'teamstroke' ? 'tied' : 'halved';
        return `<div class="rc-row"><span class="rc-kind">${kind}</span><span><b>${lab(0)}</b> <i>and</i> <b>${lab(1)}</b> <i>${word}</i></span><span class="rc-pill h">${match.type === 'teambirdies' ? '½–½' : 'A/S'}</span></div>`;
      }
      const w = res.leader;
      const pill = match.type === 'teamstroke' ? `By ${res.up}` : match.type === 'teambirdies' ? esc(res.status) : esc(res.status.replace('Won ', ''));
      return `<div class="rc-row"><span class="rc-kind">${kind}</span><span>${dot(match.sides[w].team)}<b>${lab(w)}</b> <i>def. ${lab(1 - w)}</i></span>
        <span class="rc-pill" style="background:${teamColor(match.sides[w].team)}">${pill}</span></div>`;
    };
    const blocks = todays.map((r) => {
      const ms = standings.matches.filter((m) => m.match.roundId === r.id);
      const pre = todays.length > 1 ? `${esc(r.course)} · ` : '';
      if (r.format === 'teamstroke') return `<div class="rc-grp">${pre}All 8 · ${roundPoints(r)} pts</div>${ms.map(row).join('')}`;
      return r.groups.map((g, gi) => `<div class="rc-grp">${pre}Group ${gi + 1}${r.tees?.[gi] ? ` · ${esc(r.tees[gi].replace(' PM', '').replace(' AM', ''))}` : ''}</div>
        ${ms.filter((m) => m.match.group === gi).map(row).join('')}`).join('');
    }).join('');
    const pts = todays.reduce((a, r) => a + roundPoints(r), 0);
    results = `<div class="rc-sec"><div class="rc-h">${final ? "Tuesday's matches" : "Today's matches"} <small>${pts} points</small></div><div class="rc-box">${blocks}</div></div>`;

    // ---- Stars of the day ----
    const ids = PLAYER_IDS;
    const full = ids.flatMap((p) => todays.filter((r) => r.format !== 'teamstroke')
      .map((r) => ({ p, ...roundTotals(config, scores, p).find((x) => x.roundId === r.id) }))).filter((x) => x.holes === 18);
    const low = full.length ? Math.min(...full.map((x) => x.gross)) : null;
    const lowWho = [...new Set(full.filter((x) => x.gross === low).map((x) => x.p))];
    const birds = {};
    for (const r of todays) {
      for (const [p, holes] of Object.entries(scores[r.id] || {})) {
        for (const [h, v] of Object.entries(holes)) {
          const par = parFor(config, r.id, h);
          if (par && v < par) (birds[p] ||= []).push(`${v === 1 ? 'ace ' : par - v >= 2 ? 'eagle ' : ''}#${h}`);
        }
      }
    }
    const birdTotal = Object.values(birds).reduce((a, l) => a + l.length, 0);
    const birdList = Object.entries(birds).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .map(([p, l]) => (l.length === 1 ? `${name(p)} ${l[0]}` : `${name(p)} ×${l.length}`)).join(' · ');
    const skinsWon = computeSkins(config, scores, ids, SKIN_STAKE).holes.filter((h) => h.winner && todays.some((r) => r.id === h.roundId));
    const done = standings.matches.filter((m) => todays.some((r) => r.id === m.match.roundId) && !isTeamMatch(m.match) && m.result.done);
    const close = done.filter((m) => m.result.leader === null || (m.result.up === 1 && m.result.remaining === 0));
    const big = done.filter((m) => m.result.leader !== null).sort((a, b) => b.result.up - a.result.up)[0];
    const star = (k, v, d, cls = '') => `<div class="rc-star"><div class="rc-k">${k}</div><div class="rc-v ${cls}">${v}</div><div class="rc-d">${d}</div></div>`;
    const fourth = close.length
      ? star('Closest finish', `${close.length} went to 18`, close.slice(0, 2).map((m) => `${esc(sideLabel(m.match.sides[0]))} v ${esc(sideLabel(m.match.sides[1]))}`).join(' · '))
      : big ? star('Biggest win', esc(big.result.status.replace('Won ', '')), esc(sideLabel(big.match.sides[big.result.leader]))) : '';
    results += `<div class="rc-sec"><div class="rc-h">Stars of the day</div><div class="rc-stars">
      ${low !== null ? star('Low round', low, lowWho.map(name).join(', ')) : ''}
      ${star('Birdies 🐦', birdTotal, birdTotal ? birdList : 'None. Ice cold 🥶', 'red')}
      ${star('Skins 💰', `${skinsWon.length} won`, skinsWon.length ? `${skinsWon.slice(0, 4).map((h) => `${name(h.winner)} #${h.hole}`).join(' · ')} · $${SKIN_STAKE * (ids.length - 1)} each` : 'All pushed')}
      ${fourth}
    </div></div>`;
  }

  // ---- Tomorrow, or the wrap-up after Tuesday ----
  let next = '';
  const strokeLine = (ms) => {
    const by = {};
    ms.filter((m) => !isTeamMatch(m)).forEach((m) => Object.entries(m.strokes || {}).forEach(([p, hs]) => { (by[p] ||= new Set()); hs.forEach((h) => by[p].add(h)); }));
    const list = Object.entries(by).map(([p, hs]) => `${name(p)} ${[...hs].sort((a, b) => a - b).join(', ')}`);
    return `<div class="rc-stk">${list.length ? `● Strokes: ${list.join(' · ')}` : 'No strokes: straight up'}</div>`;
  };
  if (tomorrow.length) {
    const all = buildMatches(config);
    const blocks = tomorrow.map((r) => {
      const head = `<div class="rc-nt"><b>${esc(r.course)} · ${roundDay(r)}</b><span>${r.tees?.length ? `First tee ${esc(r.tees[0])}` : ''}</span></div>`;
      if (r.pending) {
        const why = r.waitingOn === 'draft' ? "Teams set by tonight's draft"
          : r.needsPicks ? `Matchups set tonight · ${esc(teamName(config, r.leader))} finished first` : 'Matchups TBD';
        return `${head}<div class="rc-ng"><div class="rc-m">${why}</div></div>`;
      }
      if (r.format === 'teamstroke') {
        return `${head}<div class="rc-ng"><div class="rc-m">Team stroke play, all 8 count (12s take ${TEAMSTROKE_STROKES} off) + the birdie point</div>
          ${r.groups.map((g, gi) => `<div class="rc-m"><span class="rc-kk">${esc(r.tees?.[gi] || `Group ${gi + 1}`)}</span><span>${groupPlayers(config, g).map((p) => name(p.id)).join(', ')}</span></div>`).join('')}</div>`;
      }
      return head + r.groups.map((g, gi) => {
        const ms = all.filter((m) => m.roundId === r.id && m.group === gi);
        const vs = (m) => `${m.sides[0].players.map(name).join(' &amp; ')} v ${m.sides[1].players.map(name).join(' &amp; ')}`;
        const lines = r.format === 'escalating'
          ? `<div class="rc-m"><span class="rc-kk">Front 9</span><span>${ms.filter((m) => m.holes[0] === 1).map(vs).join(' · ')}</span></div>
             <div class="rc-m"><span class="rc-kk">Back 9</span><span>${ms.filter((m) => m.holes[0] !== 1).map(vs).join(' · ')}</span></div>`
          : `<div class="rc-m"><span class="rc-kk">Best ball</span><span>${ms.filter((m) => m.type === 'bestball').map(vs).join('')}</span></div>
             <div class="rc-m"><span class="rc-kk">Singles</span><span>${ms.filter((m) => m.type === 'singles').map(vs).join(' · ')}</span></div>`;
        return `<div class="rc-ng"><div class="rc-tee">${esc(r.tees?.[gi] || '')} · Group ${gi + 1}</div>${lines}${strokeLine(ms)}</div>`;
      }).join('');
    }).join('');
    next = `<div class="rc-sec"><div class="rc-h">Tomorrow</div><div class="rc-next">${blocks}</div></div>`;
  } else if (final) {
    const birdies = birdieCounts(config, scores, PLAYER_IDS);
    const top = (val) => {
      const best = Math.max(...PLAYER_IDS.map(val));
      return { best, who: PLAYER_IDS.filter((p) => val(p) === best).map(name).join(', ') };
    };
    const mvp = top((p) => standings.players[p]?.points || 0);
    const bk = top((p) => birdies[p]?.birdies || 0);
    const { net } = computeSkins(config, scores, PLAYER_IDS, SKIN_STAKE);
    const sk = top((p) => net[p]);
    const pay = settleUp(net);
    next = `<div class="rc-sec"><div class="rc-h">The week</div><div class="rc-stars">
        <div class="rc-star"><div class="rc-k">MVP</div><div class="rc-v">${fmtQuarter(mvp.best)} pts</div><div class="rc-d">${mvp.who}</div></div>
        <div class="rc-star"><div class="rc-k">Birdie king 🐦</div><div class="rc-v red">${bk.best}</div><div class="rc-d">${bk.who}</div></div>
      </div></div>
      <div class="rc-sec"><div class="rc-h">Skins settle-up 💰 <small>${sk.best > 0 ? `Top: ${sk.who} +$${sk.best}` : ''}</small></div>
        <div class="rc-next"><div class="rc-ng">${pay.length ? pay.map((x) => `<div class="rc-m">${name(x.from)} → ${name(x.to)} <b class="rc-amt">$${x.amount}</b></div>`).join('') : '<div class="rc-m">Nobody owes anybody</div>'}</div></div></div>`;
  }

  return `<div class="rc-top"><div class="rc-brand"><b>BUCKLE UP</b><span>${esc(TRIP.short)} · ${esc(TRIP.shortDates)}</span></div>${top}</div>
    ${results}${next}
    <div class="rc-foot"><span>${esc(location.host)}</span><span>Full scores in the app</span></div>`;
}

let html2canvasLoad;
function loadHtml2canvas() {
  html2canvasLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => { html2canvasLoad = null; reject(new Error("Couldn't load the image maker. Check your signal and try again.")); };
    document.head.appendChild(s);
  });
  return html2canvasLoad;
}

function openRecap() {
  const date = recapDay();
  if (!date || document.querySelector('.rc-overlay')) return;
  const el = document.createElement('div');
  el.className = 'rc-overlay';
  el.innerHTML = `<div class="rc-scroll"><div class="rc-card">${recapCard(date)}</div><p class="rc-hint" hidden></p></div>
    <div class="rc-actions">${isAdmin() ? '<button class="btn rc-share">📲 Share</button>' : ''}<button class="btn ghost rc-close">Close</button></div>`;
  document.body.appendChild(el);
  el.querySelector('.rc-close').addEventListener('click', () => el.remove());
  el.querySelector('.rc-share')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Making the image…';
    try {
      const h2c = await loadHtml2canvas();
      const card = el.querySelector('.rc-card');
      const canvas = await h2c(card, { scale: 3, backgroundColor: '#f4efe3', useCORS: true, logging: false });
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], `buckle-up-${date}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch((err) => { if (err.name !== 'AbortError') throw err; });
      } else {
        // No share sheet: show the image so it can be saved with a long press.
        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        img.className = 'rc-img';
        card.replaceWith(img);
        const hint = el.querySelector('.rc-hint');
        hint.hidden = false;
        hint.textContent = 'Press and hold the image to save or share it.';
      }
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = '📲 Share';
    }
  });
}

// ---------- Score entry ----------

// Scores tab: enter scores hole by hole, or flip to the scorecards.
function renderScores() {
  const card = ui.scoresView === 'card';
  const toggle = `<div class="view-toggle">
    <button class="${card ? '' : 'on'}" data-action="scores-view" data-id="enter">✏️ Enter scores</button>
    <button class="${card ? 'on' : ''}" data-action="scores-view" data-id="card">📋 Scorecards</button>
  </div>`;
  return toggle + (card ? renderCards() : renderEntry());
}

// What's being played on a hole, for the badge and the match bar.
function segmentLabel(round, hole) {
  const [front] = halvesOf(round);
  const isFront = front.includes(hole);
  if (round.format === 'stroke') return ['Stroke play', 'Captain Round'];
  if (round.format === 'teamstroke') return ['Team stroke', 'Team stroke play'];
  if (round.format === 'escalating') return isFront ? ['Singles · 1 pt', 'Front 9 singles'] : [`Singles · ${ESCALATING_BACK_POINTS} pt${ESCALATING_BACK_POINTS === 1 ? '' : 's'}`, 'Back 9 singles'];
  return isFront ? ['Best Ball', 'Best ball match'] : ['Singles', 'Singles matches'];
}

function renderEntry() {
  const config = view;
  const { scores } = store;
  const round = currentRound();
  if (!round) return '<p class="empty">No rounds enabled. Turn one on in Setup.</p>';
  if (round.pending) return `${roundChips(round.id)}${pendingNote(config, round)}`;

  if (ui.group == null || !round.groups[ui.group]) {
    const mine = ui.me ? round.groups.findIndex((g) => inGroup(config, g, ui.me)) : -1;
    ui.group = Math.max(0, mine);
  }
  const all = holesOf(round);
  const [front] = halvesOf(round);
  if (!all.includes(ui.hole)) ui.hole = all[all.length - 1];
  const group = round.groups[ui.group];
  const hole = ui.hole;
  const last = all.length;
  const roundScores = scores[round.id] || {};
  const players = groupPlayers(config, group);
  const isFront = front.includes(hole);
  const par = parFor(config, round.id, hole);
  const [badge, segment] = segmentLabel(round, hole);

  // Holes where someone in this group gets a handicap stroke.
  const strokeHoles = new Set(buildMatches(config)
    .filter((m) => m.roundId === round.id && m.group === ui.group)
    .flatMap((m) => Object.values(m.strokes || {}).flat()));
  const holeBtns = all.map((h) => {
    const complete = players.every((p) => roundScores[p.id]?.[h]);
    const some = players.some((p) => roundScores[p.id]?.[h]);
    return `<button class="hole ${h === hole ? 'on' : ''} ${complete ? 'full' : some ? 'part' : ''} ${strokeHoles.has(h) ? 'sh' : ''}"
      data-action="hole" data-hole="${h}">${h}</button>${h === front[front.length - 1] ? '<span class="turn"></span>' : ''}`;
  }).join('');

  const bStreak = (pid) => {
    const n = birdieStreak(config, round.id, roundScores[pid]);
    return n >= 2 ? `<span class="streak hot" title="${n} birdies in a row">🐦🔥${n}</span>` : '';
  };
  const canScore = isPlayer();
  // Handicap strokes on this hole: in the group's matches (Quicksands has
  // none per hole: 12s just take strokes off the total).
  const segmentMatches = buildMatches(config)
    .filter((m) => m.roundId === round.id && (m.group === ui.group || m.group === -1) && m.holes.includes(hole));
  const getsStroke = new Set(segmentMatches.filter((m) => !isTeamMatch(m))
    .flatMap((m) => Object.entries(m.strokes || {}).filter(([, hs]) => hs.includes(hole)).map(([pid]) => pid)));
  // Quicksands: 12s have their strokes off the total from the start, so no stroke holes.
  const off = segmentMatches.filter((m) => m.allowance).flatMap((m) => Object.keys(m.allowance))
    .filter((pid) => players.some((p) => p.id === pid));
  const strokeNote = getsStroke.size
    ? `<div class="stroke-note">${strokeDot} Stroke hole: <b>${[...getsStroke].map((pid) => esc(playerName(pid))).join(' & ')}</b> ${getsStroke.size > 1 ? 'get' : 'gets'} a stroke</div>`
    : off.length ? `<div class="stroke-note">${strokeDot} <b>${off.map((pid) => esc(playerName(pid))).join(' & ')}</b>: ${TEAMSTROKE_STROKES} strokes already off ${off.length > 1 ? 'their totals' : 'his total'}. No stroke holes here.</div>` : '';
  const rows = players.map((p) => {
    const v = roundScores[p.id]?.[hole];
    const done = all.filter((h) => roundScores[p.id]?.[h]);
    const total = done.reduce((a, h) => a + roundScores[p.id][h], 0);
    const toPar = done.reduce((a, h) => a + roundScores[p.id][h] - (parFor(config, round.id, h) || 0), 0);
    // One tap per score: eagle through triple bogey (the max). Tap the
    // selected number again to clear it.
    const quick = canScore && par ? `<div class="quick" style="--n:${scoreChoices(par).length}">${scoreChoices(par).map((n) => `
      <button class="q ${v === n ? 'on' : ''}" data-action="set-score" data-player="${p.id}" data-value="${n}">
        <span class="qn ${scoreMark(n, par)}">${n}</span><small>${scoreName(n, par)}</small></button>`).join('')}</div>` : '';
    return `<div class="entry-row">
      <div class="entry-top">
        ${teamDot(p.team)}
        <div class="entry-name">${esc(playerName(p.id))}${getsStroke.has(p.id) ? ` <span class="stk-tag">${strokeDot} Stroke${v ? ` · net ${v - 1}` : ''}</span>` : ''}${bStreak(p.id)}<small>${total ? `${total} · ${fmtToPar(toPar)}` : ''}</small></div>
        <div class="stepper"><output class="${v ? '' : 'blank'}">${v ? marked(v, par) : '–'}</output></div>
      </div>
      ${quick}
    </div>`;
  }).join('');

  const skinHole = round.skins === 'all' || (round.skins === 'par3' && par === 3);
  let below = '';
  if (round.format === 'stroke') {
    below = captainBoard(config);
  } else {
    below = `<div class="bc-wrap bc-mini">
      <div class="bc-session"><span>${segment}</span><span>${round.format === 'teamstroke' ? 'Both groups' : groupTitle(round, ui.group)}</span></div>
      ${segmentMatches.map((m) => broadcastCard(config, m, computeMatch(m, roundScores))).join('')}
    </div>`;
  }

  return `
    ${roundChips(round.id)}
    <div class="seg">${round.groups.map((g, gi) => `
      <button class="${gi === ui.group ? 'on' : ''}" data-action="group" data-group="${gi}">
        ${groupTitle(round, gi)}<small>${groupLabel(config, g)}</small>
      </button>`).join('')}</div>
    <div class="holes" style="--holes:${last}">${holeBtns}</div>
    <div class="card entry">
      <div class="entry-head">
        <div><div class="hole-num">Hole ${hole}${skinHole ? ' <span class="skin-tag">💰 Skin</span>' : ''}</div>
        <div class="hole-par">Par ${par ?? '–'}${HOLE_HANDICAPS[round.id] ? ` · Hcp ${HOLE_HANDICAPS[round.id][hole - 1]}` : ''}${par ? ` <span class="hole-max">Max ${par + MAX_OVER_PAR}</span>` : ''}</div></div>
        <span class="badge ${isFront ? 'bb' : 'sg'}">${badge}</span>
      </div>
      ${strokeNote}
      ${rows}
      ${canScore ? '' : `<p class="spectator-note">👀 Spectator view: only players enter scores.${ui.me ? '' : ' <button class="link" data-action="change-me">Are you a player?</button>'}</p>`}
      <div class="nav-row">
        <button class="btn ghost" data-action="hole" data-hole="${Math.max(1, hole - 1)}" ${hole === 1 ? 'disabled' : ''}>← Hole ${hole - 1 || ''}</button>
        <button class="btn" data-action="hole" data-hole="${Math.min(last, hole + 1)}" ${hole === last ? 'disabled' : ''}>Hole ${hole < last ? hole + 1 : ''} →</button>
      </div>
    </div>
    ${below}`;
}

// ---------- Scorecards ----------

function scorecard(match, res, roundScores, pars) {
  const holes = match.holes;
  const playerRows = match.sides.flatMap((side) => side.players.map((p) => {
    const vals = holes.map((h) => roundScores?.[p]?.[h]);
    const tot = vals.filter(Boolean).reduce((a, b) => a + b, 0);
    return `<tr><th>${teamDot(side.team)}${esc(playerName(p))}</th>
      ${vals.map((v, i) => {
        const h = res.holes[i];
        const hole = match.holes[i];
        const counted = match.type === 'bestball' && v && netScore(match, p, hole, v) === (side === match.sides[0] ? h.a : h.b);
        const stroke = match.strokes?.[p]?.includes(hole);
        return `<td class="${counted ? 'counted' : ''} ${stroke ? 'has-stk' : ''}">${marked(v, pars?.[hole])}${stroke ? strokeDot : ''}</td>`;
      }).join('')}<td class="tot">${tot || ''}</td></tr>`;
  }));
  const status = res.holes.map((h) => {
    if (h.diff === null) return '<td></td>';
    if (h.diff === 0) return '<td class="st">AS</td>';
    const leader = h.diff > 0 ? 0 : 1;
    return `<td class="st" style="color:${teamColor(match.sides[leader].team)}">${Math.abs(h.diff)}</td>`;
  }).join('');
  return `<div class="sc-wrap"><table class="sc">
    <thead><tr><th>Hole</th>${holes.map((h) => `<th>${h}</th>`).join('')}<th>Tot</th></tr></thead>
    <tbody>${playerRows.join('')}
      <tr class="status-row"><th>Match</th>${status}<td></td></tr>
    </tbody></table></div>`;
}

// Traditional 18-hole card for the whole field, marked up like a paper card.
function courseCard(config, round, roundScores) {
  const pars = config.pars?.[round.id] || {};
  const [FRONT, BACK] = halvesOf(round);
  const sum = (holes, fn) => holes.reduce((a, h) => a + (fn(h) || 0), 0);
  const nine = (holes, fn, cls = '') => holes.map((h) => `<td class="${cls}">${fn(h)}</td>`).join('');
  const parOut = sum(FRONT, (h) => pars[h]);
  const parIn = sum(BACK, (h) => pars[h]);

  const rows = round.groups.map((g, gi) => groupPlayers(config, g).map(({ id: p, team: t }, pi) => {
    const sc = roundScores[p] || {};
    const played = holesOf(round).filter((h) => sc[h]);
    const out = sum(FRONT, (h) => sc[h]);
    const inn = sum(BACK, (h) => sc[h]);
    const toPar = played.reduce((a, h) => a + sc[h] - (pars[h] || 0), 0);
    const toParTxt = !played.length ? '' : toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : String(toPar);
    return `<tr class="${gi > 0 && pi === 0 ? 'group-start' : ''}">
      <th>${teamDot(t)}${esc(playerName(p))}</th>
      ${nine(FRONT, (h) => marked(sc[h], pars[h]))}<td class="sub">${out || ''}</td>
      ${nine(BACK, (h) => marked(sc[h], pars[h]))}<td class="sub">${inn || ''}</td>
      <td class="tot">${out + inn || ''}</td><td class="topar ${toPar < 0 ? 'under' : ''}">${toParTxt}</td>
    </tr>`;
  }).join('')).join('');

  return `<div class="card sc-card"><div class="sc-wrap"><table class="sc full">
    <thead><tr><th>Hole</th>${FRONT.map((h) => `<th>${h}</th>`).join('')}<th>Out</th>
      ${BACK.map((h) => `<th>${h}</th>`).join('')}<th>In</th><th>Tot</th><th>±</th></tr></thead>
    <tbody>
      <tr class="par-row"><th>Par</th>${nine(FRONT, (h) => pars[h] ?? '')}<td class="sub">${parOut}</td>
        ${nine(BACK, (h) => pars[h] ?? '')}<td class="sub">${parIn}</td><td class="tot">${parOut + parIn}</td><td></td></tr>
      ${rows}
    </tbody></table></div></div>`;
}

function renderCards() {
  const config = view;
  const { scores } = store;
  const round = currentRound();
  if (!round) return '<p class="empty">No rounds enabled.</p>';
  const title = `<h2>${esc(round.course)} · ${esc(round.day)}</h2>`;
  if (round.pending) {
    return `${roundChips(round.id)}${title}${courseCard(config, { ...round, groups: [] }, {})}${pendingNote(config, round)}`;
  }
  const roundScores = scores[round.id] || {};
  const pars = config.pars?.[round.id];
  const matches = buildMatches(config).filter((m) => m.roundId === round.id);
  let extra = '';
  if (round.format === 'stroke') {
    extra = captainBoard(config);
  } else if (round.format === 'teamstroke') {
    extra = `<h2>Team totals</h2><div class="bc-wrap">${matches.map((m) => strokeCard(config, m, computeMatch(m, roundScores))).join('')}</div>`;
  } else {
    extra = `<h2>Match cards</h2>
    ${round.groups.map((g, gi) => `
      <h3>${groupTitle(round, gi)} · ${groupLabel(config, g)}</h3>
      ${matches.filter((m) => m.group === gi).map((m) => {
        const res = computeMatch(m, roundScores);
        return `<div class="card sc-card">${matchCard(m, res, { compact: true })}${scorecard(m, res, roundScores, pars)}</div>`;
      }).join('')}`).join('')}
    <div class="legend"><span><span class="mk counted-swatch">4</span> Counted for best ball</span><span>${strokeDot} Handicap stroke</span><span>Max score: triple bogey</span></div>`;
  }
  return `
    ${roundChips(round.id)}
    ${title}
    ${courseCard(config, round, roundScores)}
    ${LEGEND}
    ${extra}`;
}

// ---------- Trip ----------

function renderTrip() {
  const recap = tripFinal(view, store.scores)
    ? '<button class="card recap-link" data-action="tab" data-tab="recap">🏆 <b>Trip recap is ready</b> · standings, awards, best photos →</button>' : '';
  return `
    ${recap}
    <div class="hero">
      <div class="hero-dates">${esc(TRIP.dates)}</div>
      <div class="hero-tag">${esc(TRIP.tagline)}</div>
    </div>
    ${ITINERARY.map((d) => `
      <article class="card day">
        <header><div><b>${d.day}</b> <span class="muted">${d.date}</span></div><div class="day-title">${esc(d.title)}</div></header>
        <ul>${d.items.map((it) => `
          <li><span class="ico">${it.icon}</span><div>
            ${it.time ? `<b>${esc(it.time)}</b> · ` : ''}${esc(it.text)}
            ${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div></li>`).join('')}
          ${d.stay ? `<li><span class="ico">🛏️</span><div>Stay: <b>${esc(d.stay.name)}</b></div></li>` : ''}
        </ul>
      </article>`).join('')}
    <h2>Flights</h2>
    <div class="card">${FLIGHTS.map((f) => `<div class="kv"><b>✈️ ${f.route}</b><span>${f.when}</span></div>`).join('')}</div>
    <p class="app-version">App version ${APP_VERSION}</p>`;
}

// ---------- Setup ----------

function renderSetup() {
  const { config } = store;
  const d = draft;
  const name = (p) => esc(playerName(p));
  const chip = (kind, a, b, pid) => `<button class="player-chip ${pickedSlot?.kind === kind && pickedSlot.a === a && pickedSlot.b === b ? 'picked' : ''}"
    data-action="pick-player" data-kind="${kind}" data-a="${a}" data-b="${b}">${name(pid)}</button>`;
  const manual = config.draft?.captains || [];
  const fri = config.rounds.find((r) => r.format === 'stroke');

  const draftStatus = d.stage === 'captains'
    ? (d.cr?.allDone ? 'Tied for a captain spot: waiting on the putt-off.' : "Waiting on Friday's scores.")
    : `Captains: <b>${name(d.captains[0])}</b> (picks first) and <b>${name(d.captains[1])}</b>${d.manual ? ' · set by hand' : ' · from Friday'}.
      ${d.stage === 'done' ? 'Draft complete.' : config.draft?.started ? `Draft is live: ${d.picks.length} of ${PLAYER_IDS.length - 2} picks made.` : 'Draft not started yet.'}`;

  const tuePairs = config.tuePicks?.pairs || [];

  return `
    <div class="card admin-note">
      <p>🔒 <b>Only Tate sees this tab.</b> It shows when Tate is picked as the name; everyone else just sees the other tabs.</p>
      <button class="btn ghost" data-action="tab" data-tab="recap">Preview trip recap</button>
    </div>

    <h2>Captains &amp; draft</h2>
    <div class="card">
      <p class="setup-p">${draftStatus}</p>
      <p class="note">Set the captains by hand (say, if Friday gets rained out): tap the one who picks first, then the other.</p>
      <div class="cap-grid">${PLAYERS.map((p) => {
        const i = manual.indexOf(p.id);
        return `<button class="player-chip ${i >= 0 ? 'picked' : ''}" data-action="captain-set" data-player="${p.id}">${esc(p.name)}${i >= 0 ? ` <small>${i === 0 ? '1st' : '2nd'}</small>` : ''}</button>`;
      }).join('')}</div>
      <div class="setup-actions">
        ${manual.length ? '<button class="link" data-action="captain-auto">Use Friday\'s scores instead</button>' : ''}
        ${d.stage === 'drafting' && !config.draft?.started ? '<button class="link" data-action="draft-start">Start the draft</button>' : ''}
        ${d.stage === 'drafting' && config.draft?.started ? '<button class="link" data-action="draft-stop">Back to "starts later"</button>' : ''}
        ${d.picks?.length ? '<button class="link" data-action="draft-undo">Undo last pick</button>' : ''}
        ${d.picks?.length || config.teams.length ? '<button class="link danger" data-action="draft-reset">Reset the draft</button>' : ''}
      </div>
    </div>

    <h2>Teams</h2>
    ${config.teams.length === 2 ? `<p class="note">Tap a player, then another to swap them (across teams, or within a team to change the order: the first player is the captain, and the order sets the Sat–Mon rotation). Changes save for everyone right away.</p>
    ${config.teams.map((t, ti) => `
      <div class="card setup-team" style="--team:${teamColor(ti)}">
        <input type="text" id="setup-team-${ti}" value="${esc(t.name)}" data-edit="team-name" data-team="${ti}" aria-label="Team name" enterkeyhint="done">
        <div class="swatches">${TEAM_COLORS.map((c) => `<button class="sw ${t.color === c ? 'on' : ''}" style="--sw:${c}" data-action="team-color" data-team="${ti}" data-color="${c}"
          ${config.teams[1 - ti].color === c ? 'disabled' : ''} aria-label="Color"></button>`).join('')}</div>
        <div class="four">${t.players.map((pid, si) => chip('team', ti, si, pid)).join('')}</div>
      </div>`).join('')}` : '<div class="card"><p class="muted">Set by the draft.</p></div>'}

    <h2>Friday groups</h2>
    <p class="note">${esc(fri?.course || '')}: tap a player, then another to swap groups.</p>
    <div class="card"><div class="two">${(fri?.groups || []).map((g, gi) => `<div>
      <div class="setup-sub">Group ${gi + 1}</div>
      <div class="stack">${g.players.map((pid, si) => chip('fri', gi, si, pid)).join('')}</div>
    </div>`).join('')}</div></div>

    <h2>Handicaps</h2>
    <p class="note">Tap a player to switch him between a 3 and a 12. 12s get ${STROKES_PER_NINE} strokes a nine against 3s in matches, and take ${TEAMSTROKE_STROKES} off at Quicksands. Changes save for everyone right away.</p>
    <div class="card"><div class="two">${HCP_BUCKETS.map((b) => `<div>
      <div class="setup-sub">${b}s</div>
      <div class="stack">${PLAYERS.filter((p) => (config.hcp?.[p.id] ?? HCP_BUCKETS[0]) === b).map((p) => `
        <button class="player-chip" data-action="hcp-toggle" data-player="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    </div>`).join('')}</div></div>

    <h2>Rounds</h2>
    ${config.rounds.map((r, ri) => {
      const resolved = view.rounds[ri];
      let detail = '';
      if (r.format === 'match' && !resolved.pending) {
        detail = resolved.groups.map((g, gi) => {
          const pairs = g.cross ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
          return `<div class="singles-line">Group ${gi + 1}: best ball <b>${g.a.map(name).join(' & ')}</b> v <b>${g.b.map(name).join(' & ')}</b>
            · singles <b>${pairs.map(([pa, pb]) => `${name(g.a[pa])} v ${name(g.b[pb])}`).join(', ')}</b>
            <button class="link" data-action="cross" data-round="${ri}" data-group="${gi}">Swap</button></div>`;
        }).join('');
      } else if (r.format === 'escalating') {
        detail = `<div class="singles-line">${tuePairs.length === 4 ? `Matchups set: <b>${tuePairs.map(([x, y]) => `${name(x)} v ${name(y)}`).join(', ')}</b>
          <button class="link" data-action="tue-reset">Reset</button>` : resolved.needsPicks ? (config.tueDraft?.started ? 'Matchup draft is live.' : 'Ready: start the matchups from the Leaderboard.') : 'Set by the captains Monday night.'}</div>`;
      } else if (r.format === 'teamstroke') {
        detail = `<div class="singles-line">Team stroke play (net), ${TEAMSTROKE_POINTS} pts, plus ${BIRDIE_POINTS} for most birdies. Groups are Gamble Sands' groups.</div>`;
      } else if (r.format === 'stroke') {
        detail = '<div class="singles-line">Captain Round: no points, no skins.</div>';
      }
      return `<div class="card setup-round ${r.enabled ? '' : 'off'}">
        <label class="toggle"><input type="checkbox" data-edit="round-enabled" data-round="${ri}" ${r.enabled ? 'checked' : ''}>
          <b>${esc(r.day)}</b><span class="muted">${esc(FORMAT_LABELS[r.format])}${r.skins ? ' · skins' : ''}</span></label>
        <input type="text" id="setup-course-${ri}" value="${esc(r.course)}" data-edit="round-course" data-round="${ri}" aria-label="Course" enterkeyhint="done">
        ${detail}
      </div>`;
    }).join('')}

    <h2>Sync</h2>
    <div class="card">
      ${store.mode === 'firebase'
        ? `<p>✅ <b>Live sync is on.</b> Scores appear on everyone's phone instantly and are saved offline if you lose signal.</p>`
        : `<p>⚠️ <b>Local mode.</b> Scores are only saved on this device.</p>`}
    </div>`;
}

// True when every player in the current group has a score on the hole.
function groupHoleComplete(round, hole) {
  const group = view.rounds.find((r) => r.id === round.id)?.groups[ui.group];
  if (!group) return false;
  return groupPlayers(view, group).every((p) => store.scores[round.id]?.[p.id]?.[hole]);
}

// When the last score on a hole goes in, move to the next hole after a
// moment. Fixing a score during that moment restarts the wait; going back to
// fix an older hole never jumps you forward.
let advancePending = null; // hole waiting to auto-advance
function scheduleAdvance(round, wasComplete) {
  clearTimeout(advanceTimer);
  const hole = ui.hole;
  const justFinished = !wasComplete && groupHoleComplete(round, hole);
  if (!justFinished && advancePending !== hole) return;
  if (hole >= holesOf(round).length || !groupHoleComplete(round, hole)) { advancePending = null; return; }
  advancePending = hole;
  advanceTimer = setTimeout(() => {
    advancePending = null;
    if (ui.tab !== 'scores' || ui.hole !== hole || ui.roundId !== round.id) return;
    ui.hole = hole + 1;
    toast(`Hole ${hole} done → Hole ${hole + 1}`);
    render();
  }, 1500);
}

// Apply a Setup change and save it for everyone immediately.
function saveSetup(fn) {
  const config = structuredClone(store.config);
  fn(config);
  store.saveConfig(config).catch(showError);
  toast('Saved for everyone ✓');
}

let toastTimer;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------- Clubhouse feed ----------

const REACTIONS = ['🔥', '😂', '💀', '⛳', '👏'];

function fmtAgo(ms) {
  if (!ms) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  return new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function avatar(pid, config) {
  const t = teamOf(config, pid);
  return `<span class="avatar" style="background:${t >= 0 ? teamColor(t) : 'var(--muted)'}">${esc(playerName(pid).slice(0, 1))}</span>`;
}

function roundName(config, roundId) {
  return config.rounds.find((r) => r.id === roundId)?.course || '';
}

// Headline and detail for an automatic highlight.
function highlightText(config, h) {
  const who = esc(playerName(h.player));
  const where = `#${h.hole} · ${esc(roundName(config, h.roundId))}`;
  const side = (m, si) => esc(sideLabel(m.sides[si]));
  switch (h.type) {
    case 'ace': return [`⛳ HOLE IN ONE! ${who} aced the par ${h.par}`, where];
    case 'eagle': return [`🦅 EAGLE! ${who} made ${h.score} on the par ${h.par}`, where];
    case 'birdie': return [`🐦 ${who} birdied`, `${where} · ${h.score} on a par ${h.par}`];
    case 'birdieRun': return [`🔥 ${who}: ${h.n} birdies in a row!`, `#${h.hole - h.n + 1}–${h.hole} · ${esc(roundName(config, h.roundId))}`];
    case 'holeRun': return [`🔥 ${side(h.match, h.side)} won ${h.n} straight holes`, `vs ${side(h.match, 1 - h.side)} · thru #${h.hole}`];
    case 'skin': return [`💰 ${who} wins the skin: ${h.score} on the par ${h.par}`, `${where} · $${SKIN_STAKE * (PLAYER_IDS.length - 1)}`];
    case 'captains': return [`🎖️ Your captains: ${esc(playerName(h.captains[0]))} & ${esc(playerName(h.captains[1]))}`,
      `${esc(playerName(h.captains[0]))} picks first · ${esc(roundName(config, h.roundId))}`];
    case 'matchFinal': {
      if (h.match.type === 'teambirdies') {
        const tn = (si) => esc(teamName(config, h.match.sides[si].team));
        if (h.res.leader === null) return [`🐦 ${tn(0)} and ${tn(1)} split the birdie point`, `${esc(roundName(config, h.roundId))} · ${h.res.sides[0].birdies} birdies each`];
        return [`🐦 ${tn(h.res.leader)} win the birdie point, ${esc(h.res.status)}`, `${esc(roundName(config, h.roundId))} · ${BIRDIE_POINTS} pt`];
      }
      if (h.match.type === 'teamstroke') {
        const tn = (si) => esc(teamName(config, h.match.sides[si].team));
        if (h.res.leader === null) return [`🤝 ${tn(0)} and ${tn(1)} tie at ${esc(roundName(config, h.roundId))}`, `${TEAMSTROKE_POINTS / 2} pt each`];
        return [`🏁 ${tn(h.res.leader)} win ${esc(roundName(config, h.roundId))} by ${h.res.up}`, `Team stroke play · ${TEAMSTROKE_POINTS} pts`];
      }
      const kind = h.match.type === 'bestball' ? 'best ball' : 'singles';
      if (h.res.leader === null) return [`🤝 ${side(h.match, 0)} and ${side(h.match, 1)} halve their ${kind} match`, esc(roundName(config, h.roundId))];
      const w = h.res.leader;
      return [`🏁 ${side(h.match, w)} beat ${side(h.match, 1 - w)} ${esc(h.res.status.replace('Won ', ''))}`, `${kind} · ${esc(roundName(config, h.roundId))}`];
    }
    default: return ['', ''];
  }
}

function reactBar(itemId) {
  const soc = store.social[itemId] || {};
  const comments = soc.c || [];
  const open = ui.openComments === itemId;
  return `<div class="react-bar">
    ${REACTIONS.map((e) => {
      const who = soc.r?.[e] || [];
      return `<button class="react ${ui.me && who.includes(ui.me) ? 'mine' : ''}" data-action="react" data-item="${itemId}" data-emoji="${e}"
        title="${esc(who.map(playerName).join(', '))}">${e}${who.length ? `<span>${who.length}</span>` : ''}</button>`;
    }).join('')}
    <button class="react talk ${open ? 'mine' : ''}" data-action="toggle-comments" data-item="${itemId}">💬${comments.length ? `<span>${comments.length}</span>` : ''}</button>
  </div>
  ${comments.length ? `<div class="comments">${comments.map((c) => `
    <div class="comment"><b>${esc(playerName(c.by))}</b> ${esc(c.text)} <span class="muted">${fmtAgo(c.at)}</span></div>`).join('')}</div>` : ''}
  ${open ? `<div class="comment-box">
    <input type="text" id="c-${itemId}" data-draft="c:${itemId}" value="${esc(drafts[`c:${itemId}`] || '')}" placeholder="Add a comment…" enterkeyhint="send">
    <button class="btn small" data-action="comment" data-item="${itemId}">Send</button>
  </div>` : ''}`;
}

function postCard(config, post) {
  const itemId = `p-${post.id}`;
  const tag = post.roundId ? `<span class="post-tag">${post.hole ? `#${post.hole} · ` : ''}${esc(roundName(config, post.roundId))}</span>` : '';
  const media = (post.media || []).map((m) => (m.type === 'video'
    ? `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(m.url)}" alt="" loading="lazy" data-action="zoom" data-src="${esc(m.url)}">`)).join('');
  return `<article class="card post">
    <header>${avatar(post.by, config)}<div><b>${esc(playerName(post.by))}</b> ${tag}<div class="muted">${fmtAgo(post.at)}</div></div>
      ${post.by === ui.me ? `<button class="link del" data-action="del-post" data-id="${post.id}">Delete</button>` : ''}</header>
    ${post.text ? `<p class="post-text">${esc(post.text)}</p>` : ''}
    ${media ? `<div class="media n${Math.min(post.media.length, 3)}">${media}</div>` : ''}
    ${reactBar(itemId)}
  </article>`;
}

function highlightCard(config, h) {
  const [title, sub] = highlightText(config, h);
  return `<article class="card highlight ${h.type}">
    <div class="hl-title">${title}</div>
    <div class="muted">${sub}${h.at ? ` · ${fmtAgo(h.at)}` : ''}</div>
    ${reactBar(h.id)}
  </article>`;
}

function renderFeed() {
  const config = view;
  const round = currentRound();
  const hl = [...highlights(config, store.scores, store.scoreTimes, PLAYER_IDS), ...extraHighlights(config)];
  const filter = ui.feedFilter || 'all';
  let items = [
    ...store.posts.map((p) => ({ kind: 'post', at: p.at, p })),
    ...hl.map((h) => ({ kind: 'hl', at: h.at, h })),
  ];
  if (filter === 'posts') items = items.filter((i) => i.kind === 'post');
  if (filter === 'photos') items = items.filter((i) => i.kind === 'post' && i.p.media?.length);
  if (filter === 'highlights') items = items.filter((i) => i.kind === 'hl');
  items.sort((a, b) => b.at - a.at);
  const limit = ui.feedLimit || 40;

  const composer = !ui.me
    ? `<div class="card composer"><button class="btn" data-action="change-me">Pick your name to post</button></div>`
    : `<div class="card composer">
      <textarea id="post-text" data-draft="post" rows="2" placeholder="What's happening, ${esc(playerName(ui.me))}?">${esc(drafts.post || '')}</textarea>
      ${pendingMedia.length ? `<div class="previews">${pendingMedia.map((m, i) => `
        <div class="pv">${m.type === 'video' ? `<video src="${m.url}" muted playsinline></video><span class="pv-kind">▶</span>` : `<img src="${m.url}" alt="">`}
          <button data-action="unpick" data-i="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>` : ''}
      <div class="composer-row">
        <label class="btn ghost small ${posting ? 'disabled' : ''}">📷 Photo/Video
          <input type="file" id="media-input" accept="image/*,video/*" multiple hidden ${posting ? 'disabled' : ''}></label>
        <select id="post-hole" data-draft="hole" aria-label="Tag a hole">
          <option value="">${round ? `Tag a hole (${esc(round.course)})` : 'No tag'}</option>
          ${round ? holesOf(round).map((h) => `<option value="${h}" ${String(drafts.hole) === String(h) ? 'selected' : ''}>Hole ${h}</option>`).join('') : ''}
        </select>
        <button class="btn small" data-action="post" ${posting || (!drafts.post?.trim() && !pendingMedia.length) ? 'disabled' : ''}>Post</button>
      </div>
      ${posting ? `<div class="progress"><div style="width:${Math.round(((posting.done + posting.frac) / posting.total) * 100)}%"></div>
        <span>Uploading ${posting.done + 1} of ${posting.total}…</span></div>` : ''}
    </div>`;

  return `
    ${composer}
    <div class="chips feed-filter">${[['all', 'All'], ['posts', 'Posts'], ['photos', 'Photos'], ['highlights', 'Highlights']].map(([id, label]) => `
      <button class="chip ${filter === id ? 'on' : ''}" data-action="feed-filter" data-id="${id}"><span>${label}</span></button>`).join('')}</div>
    ${items.length ? items.slice(0, limit).map((i) => (i.kind === 'post' ? postCard(config, i.p) : highlightCard(config, i.h))).join('')
      : `<p class="empty">${filter === 'highlights' ? 'Birdies, streaks and match results show up here automatically.' : 'Nothing yet. Post the first photo!'}</p>`}
    ${items.length > limit ? '<button class="btn ghost more" data-action="feed-more">Show more</button>' : ''}`;
}

// Feed items the scoring module doesn't know about: skins won and the
// captains, timed to when the deciding score went in.
function extraHighlights(config) {
  const times = store.scoreTimes;
  const at = (roundId, players, hole) => Math.max(0, ...players.map((p) => times?.[roundId]?.[p]?.[hole] || 0));
  const items = computeSkins(config, store.scores, PLAYER_IDS, SKIN_STAKE).holes.filter((h) => h.winner).map((h) => ({
    id: `hl-skin-${h.roundId}-${h.hole}`, type: 'skin', player: h.winner, score: h.score, par: h.par,
    roundId: h.roundId, hole: h.hole, at: at(h.roundId, PLAYER_IDS, h.hole),
  }));
  const cr = draft.cr;
  if (draft.captains && cr?.allDone && !draft.manual) {
    const ids = cr.rows.map((r) => r.id);
    const last = Math.max(0, ...ids.map((p) => Math.max(0, ...Object.values(times?.[cr.round.id]?.[p] || {}))));
    items.push({ id: `hl-captains-${draft.captains.join('-')}`, type: 'captains', captains: draft.captains, roundId: cr.round.id, at: last });
  }
  return items;
}

async function submitPost() {
  const text = (drafts.post || '').trim();
  if (!ui.me || (!text && !pendingMedia.length) || posting) return;
  const files = pendingMedia;
  posting = { done: 0, total: Math.max(files.length, 1), frac: 0 };
  render();
  try {
    const media = [];
    for (const m of files) {
      media.push(await store.uploadMedia(m.file, (frac) => { posting.frac = frac; render(); }));
      posting.done++;
      posting.frac = 0;
    }
    const round = currentRound();
    const hole = Number(drafts.hole) || null;
    await store.addPost({ by: ui.me, text, media, roundId: round?.id || null, hole });
    files.forEach((m) => URL.revokeObjectURL(m.url));
    pendingMedia = [];
    drafts.post = '';
    drafts.hole = '';
    toast('Posted ✓');
  } catch (err) {
    console.error(err);
    const code = err.code || '';
    alert(code.startsWith('storage/') || /storage/i.test(err.message)
      ? "Couldn't upload. Photo and video uploads may not be turned on yet (Firebase Storage). Your post is still here to try again."
      : `Couldn't post: ${err.message || err}`);
  } finally {
    posting = null;
    render();
  }
}

function openLightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${esc(src)}" alt="">`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

// ---------- Trip recap ----------

function renderRecap() {
  const config = view;
  const { scores } = store;
  const final = tripFinal(config, scores);
  const rounds = enabledRounds(config);
  const allIds = rounds.filter((r) => r.format !== 'stroke').map((r) => r.id);
  const { ranked } = rankTeams(config, scores, allIds, 'final');
  const standings = computeStandings(config, scores);
  const birdies = birdieCounts(config, scores, PLAYER_IDS);
  const pids = PLAYER_IDS;
  const skins = computeSkins(config, scores, PLAYER_IDS, SKIN_STAKE);
  const reactCount = (id) => Object.values(store.social[id]?.r || {}).reduce((a, l) => a + l.length, 0);

  // Awards, worked out from the scores and the feed.
  const top = (list, val) => {
    const best = Math.max(...list.map(val));
    return best > 0 ? { best, who: list.filter((x) => val(x) === best) } : null;
  };
  const mvp = top(pids, (p) => standings.players[p]?.points || 0);
  const birdieKing = top(pids, (p) => birdies[p]?.birdies || 0);
  const rounds18 = pids.flatMap((p) => roundTotals(config, scores, p).filter((r) => r.holes === 18).map((r) => ({ ...r, p })));
  const lowRound = rounds18.sort((a, b) => a.gross - b.gross)[0];
  const hottest = top(pids, (p) => longestBirdieRun(config, scores, p));
  let runBest = null;
  for (const m of buildMatches(config)) {
    const run = longestMatchRun(computeMatch(m, scores[m.roundId]));
    if (run && (!runBest || run.n > runBest.n)) runBest = { ...run, m };
  }
  const posts = store.posts;
  const crowd = [...posts].sort((a, b) => reactCount(`p-${b.id}`) - reactCount(`p-${a.id}`))[0];
  const skinsKing = top(pids, (p) => skins.net[p]);
  const paparazzi = top(pids, (p) => posts.filter((x) => x.by === p).reduce((a, x) => a + (x.media?.length || 0), 0));
  const names = (list) => list.map((p) => esc(playerName(p))).join(' & ');

  const awards = [
    mvp && ['🎖️', 'MVP', names(mvp.who), `${fmtPts(mvp.best)} match points`],
    birdieKing && ['🐦', 'Birdie King', names(birdieKing.who), `${birdieKing.best} birdies`],
    skinsKing && ['💰', 'Skins King', names(skinsKing.who), `${fmtMoney(skinsKing.best)} in skins`],
    lowRound && ['⛳', 'Low Round', esc(playerName(lowRound.p)), `${lowRound.gross} (${lowRound.gross - lowRound.par >= 0 ? '+' : ''}${lowRound.gross - lowRound.par}) at ${esc(lowRound.course)}`],
    hottest?.best >= 2 && ['🔥', 'Hottest Hand', names(hottest.who), `${hottest.best} birdies in a row`],
    runBest?.n >= 3 && ['💪', 'Longest Run', esc(sideLabel(runBest.m.sides[runBest.side])), `won ${runBest.n} straight holes`],
    crowd && reactCount(`p-${crowd.id}`) > 0 && ['💬', 'Crowd Favorite', esc(playerName(crowd.by)), `${reactCount(`p-${crowd.id}`)} reactions`],
    paparazzi && ['📸', 'Paparazzi', names(paparazzi.who), `${paparazzi.best} photos & videos`],
  ].filter(Boolean);

  const photos = posts.flatMap((p) => (p.media || []).filter((m) => m.type === 'image').map((m) => ({ ...m, score: reactCount(`p-${p.id}`), by: p.by })))
    .sort((a, b) => b.score - a.score).slice(0, 9);
  const champ = ranked[0];

  const playerCards = pids.map((p) => ({ p, s: standings.players[p] || { points: 0, w: 0, l: 0, h: 0, team: -1 } }))
    .sort((a, b) => b.s.points - a.s.points)
    .map(({ p, s }) => {
      const totals = roundTotals(config, scores, p).filter((r) => r.holes);
      const best = totals.filter((r) => r.holes === 18).sort((a, b) => a.gross - b.gross)[0];
      return `<div class="card recap-player" style="--team:${teamColor(s.team)}">
        <div class="rp-head">${avatar(p, config)}<b>${esc(playerName(p))}</b><span class="muted">${s.team >= 0 ? esc(teamName(config, s.team)) : ''}</span>
          <span class="rp-pts">${fmtPts(s.points)} pts</span></div>
        <div class="rp-stats"><span>${s.w}-${s.l}-${s.h}</span><span>🐦 ${birdies[p]?.birdies || 0}</span>
          ${best ? `<span>Best ${best.gross} (${esc(best.day.split(' ')[0])})</span>` : ''}</div>
        <div class="rp-rounds">${totals.map((r) => `<span>${esc(r.day.split(' ')[0])} <b>${r.gross}</b>${r.holes < 18 ? `<small> thru ${r.holes}</small>` : ''}</span>`).join('')}</div>
      </div>`;
    }).join('');

  const days = rounds.filter((r) => !r.pending && r.format !== 'stroke').map((r) => {
    const day = rankTeams(config, scores, [r.id]).ranked;
    return `<div class="kv"><span><b>${roundDay(r)}</b> ${esc(r.course)}</span>
      <span class="day-pts">${day.map((t) => `${teamDot(t.idx)}${fmtPts(t.points)}`).join(' ')}</span></div>`;
  }).join('');

  return `
    ${final ? '' : '<div class="card tbd"><div class="tbd-title">Preview</div><p>The recap fills in as the trip goes and is final after the last match.</p></div>'}
    <div class="recap-hero">
      <div class="rh-kicker">Buckle Up · ${esc(TRIP.dates)}</div>
      <div class="rh-title">Trip Recap</div>
      ${champ && final && !champ.unresolved ? `<div class="rh-champ">🏆 ${esc(champ.name)} · ${champ.players.map(playerName).join(', ')}</div>` : ''}
      <button class="btn ghost small" data-action="share-recap">Share</button>
    </div>
    <h2>Final standings</h2>
    <div class="card teams">${ranked.map((t, i) => `
      <div class="team-row ${final && i === 0 && !t.unresolved ? 'winner' : ''}" style="--team:${teamColor(t.idx)}">
        <div class="rank">${final && i === 0 && !t.unresolved ? '🏆' : t.rank}</div>
        <div class="team-info"><div class="team-name">${esc(t.name)}</div>
          <div class="team-players">${t.players.map(playerName).join(', ')}</div></div>
        <div class="big-pts">${fmtPts(t.points)}</div></div>`).join('')}</div>
    <h2>Awards</h2>
    <div class="awards">${awards.length ? awards.map(([icon, title, who, why]) => `
      <div class="card award"><div class="aw-icon">${icon}</div><div class="aw-title">${title}</div>
        <div class="aw-who">${who}</div><div class="muted">${why}</div></div>`).join('') : '<p class="empty">Awards show up once scores are in.</p>'}</div>
    <h2>Day by day</h2>
    <div class="card">${days || '<p class="empty">No rounds played yet.</p>'}</div>
    ${photos.length ? `<h2>Best photos</h2><div class="photo-grid">${photos.map((m) => `
      <img src="${esc(m.url)}" alt="" loading="lazy" data-action="zoom" data-src="${esc(m.url)}">`).join('')}</div>` : ''}
    <h2>Players</h2>
    ${playerCards}`;
}

// ---------- Name picker ----------

function namePicker() {
  return `<div class="modal"><div class="modal-card">
    <div class="tbd-title">Who are you?</div>
    <p class="muted">Tap your name. Your group opens first on the Scores tab, and it's how your posts are signed. Saved on this phone.</p>
    <div class="name-grid">${PLAYERS.map((p) => `
      <button class="${ui.me === p.id ? 'on' : ''}" data-action="set-me" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="guest-box">
      <div class="guest-title">Not playing? Follow along as a spectator</div>
      <p class="muted">You can post photos, react and comment, but not enter scores.</p>
      <div class="comment-box">
        <input type="text" id="guest-name" data-draft="guest" maxlength="24" placeholder="Your name"
          value="${esc(drafts.guest ?? (ui.me?.startsWith(GUEST) ? playerName(ui.me) : ''))}" enterkeyhint="done">
        <button class="btn small" data-action="set-guest">Join</button>
      </div>
    </div>
    <button class="link" data-action="close-picker">${ui.me ? 'Cancel' : 'Just look around'}</button>
  </div></div>`;
}

// ---------- Draft night reveals ----------
//
// Full-screen reveals for the captains (when Tate starts the draft) and for
// every pick: a drumroll line, the name drop, the player's highlight and his
// scouting card, shown in the draft room (below). Music needs one tap per
// phone ("Enter the draft room") because phones block sound until the page
// has been touched.

let audioUnlocked = false;
// One audio element for everything (the theme and walk-up songs), so the
// one tap that unlocks it on iPhones covers every song.
let audioEl = null;
let audioSrc = null;

function track(src = DRAFT_THEME) {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
  }
  if (audioSrc !== src) {
    audioEl.src = src;
    audioSrc = src;
  }
  return audioEl;
}
const theme = () => track(DRAFT_THEME);
// A player's walk-up song, if he has one.
const songFor = (pid) => HIGHLIGHTS[pid]?.song || null;
function unlockAudio() {
  const a = theme();
  // Warm the cache so walk-up songs start right on the drop.
  Object.values(HIGHLIGHTS).forEach((h) => { if (h.song) fetch(h.song).catch(() => {}); });
  return a.play().then(() => { a.pause(); a.currentTime = 0; audioUnlocked = true; }).catch(() => {});
}
function playSong(src) {
  if (!audioUnlocked) return;
  const a = track(src);
  a.loop = false;
  a.currentTime = 0;
  a.play().catch(() => {});
}
function playTheme() {
  playSong(DRAFT_THEME);
}
// Under the Tuesday VS screen whatever's playing keeps looping until the next move.
function loopTheme() {
  if (!audioUnlocked || !audioEl) return;
  audioEl.loop = true;
  if (audioEl.paused) audioEl.play().catch(() => {});
}
function stopThemeLoop() {
  if (audioEl?.loop) { audioEl.loop = false; audioEl.pause(); }
}

const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;

// What a player did on Friday, for his scouting card (null if he didn't play).
function fridayStats(pid) {
  const cr = draft.cr;
  const r = cr?.rows.find((x) => x.id === pid);
  if (!r?.thru) return null;
  const round = cr.round;
  const sc = store.scores[round.id]?.[pid] || {};
  const pars = view.pars?.[round.id] || {};
  const [front, back] = halvesOf(round);
  const played = holesOf(round).filter((h) => sc[h]);
  const diff = (h) => sc[h] - (pars[h] || 0);
  const pick = (better) => played.reduce((b, h) => (b == null || better(diff(h), diff(b)) ? h : b), null);
  return {
    ...r, of: cr.rows.length, sc, pars,
    out: front.reduce((a, h) => a + (sc[h] || 0), 0),
    inn: back.reduce((a, h) => a + (sc[h] || 0), 0),
    birdies: played.filter((h) => diff(h) <= -1).length,
    doubles: played.filter((h) => diff(h) >= 2).length,
    best: pick((x, y) => x < y),
    worst: pick((x, y) => x > y),
  };
}

function scoutCard(pid) {
  const f = fridayStats(pid);
  const stats = f ? `
    <div class="rv-stats">
      <div><b>${f.done ? f.gross : fmtToPar(f.toPar)}</b><small>${f.done ? `${fmtToPar(f.toPar)} · ${ordinal(f.rank)} of ${f.of}` : `thru ${f.thru}`}</small></div>
      <div><b>${f.done ? `${f.out}/${f.inn}` : '–'}</b><small>Out / In</small></div>
      <div><b class="red">${f.birdies}</b><small>Birdies</small></div>
      <div><b>${f.doubles}</b><small>Double+</small></div>
    </div>
    <div class="rv-holes">
      <div>Best: ${marked(f.sc[f.best], f.pars[f.best])} on <b>#${f.best}</b></div>
      <div>Worst: ${marked(f.sc[f.worst], f.pars[f.worst])} on <b>#${f.worst}</b></div>
    </div>` : '<div class="rv-nofilm">Didn\'t play Friday 👀 No film from the Captain Round.</div>';
  return `<div class="rv-card">
    <div class="rv-card-head"><span>Scouting report</span><span>${f ? `Friday · ${esc(draft.cr.round.course)}` : 'Mystery man'}</span></div>
    ${stats}
    ${SCOUTING[pid] ? `<div class="rv-report"><span>The book on ${esc(playerName(pid))}</span>${esc(SCOUTING[pid])}</div>` : ''}
  </div>`;
}

// Fills `el` with one reveal and plays it: the drumroll lines, then the name
// drop, clip, confetti and scouting card. With `skipIntro` it lands straight
// on the finished reveal (a phone that joins late, or a rewatch).
// item: { pid, color, kicker, line1, line2, pill, selects, sub, roster, skipIntro }
//    or a title card: { title, sub, color }. Returns the timers to cancel.
function mountReveal(el, item) {
  const soundBtn = () => (audioUnlocked ? '🎵 Draft theme' : '🔊 Tap for music');
  el.style.setProperty('--c', item.color || '#16402b');
  if (item.title) {
    el.innerHTML = `<div class="rv-intro show-all">
      <div class="rv-kicker">The Buckle Up Draft</div>
      <div class="rv-l1 show">${item.title}</div>
      <div class="rv-l2 show">${item.sub || ''}</div>
      ${item.body || ''}
    </div>`;
    return [];
  }
  const h = HIGHLIGHTS[item.pid] || {};
  const media = h.video
    ? `<video class="rv-media" src="${h.video}" muted playsinline loop autoplay preload="auto" style="object-position:${h.focus || '50% 50%'}"></video>`
    : h.photo ? `<img class="rv-media rv-photo" src="${h.photo}" alt="">` : '';
  el.innerHTML = `
    <div class="rv-intro ${item.skipIntro ? 'gone' : ''}">
      <div class="rv-kicker">${item.kicker || 'The Buckle Up Draft'}</div>
      <div class="rv-l1">${item.line1 || ''}</div>
      <div class="rv-l2">${item.line2 || ''}<span class="rv-dots"><span>.</span><span>.</span><span>.</span></span></div>
    </div>
    <div class="rv-reveal ${media ? '' : 'plain'}">
      ${media}
      <div class="rv-shade"></div>
      <div class="rv-top"><span class="rv-pill">${item.pill || ''}</span><button class="rv-sound">${soundBtn()}</button></div>
      <div class="rv-confetti"></div>
      <div class="rv-bottom">
        <div class="rv-selects">${item.selects || ''}</div>
        <div class="rv-name">${esc(playerName(item.pid))}</div>
        <div class="rv-team"><i></i>${item.sub || ''}</div>
        ${item.card ?? scoutCard(item.pid)}
        ${item.roster ? `<div class="rv-roster">${item.roster}</div>` : ''}
      </div>
    </div>
    <div class="rv-flash"></div>
    ${item.vs ? `<div class="vs-screen">${item.vs}<button class="vs-sound">${audioUnlocked ? '🎵' : '🔊 Music'}</button></div>` : ''}`;
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const video = el.querySelector('video');
  const drop = () => {
    el.querySelector('.rv-intro').classList.add('gone');
    el.querySelector('.rv-reveal').classList.add('show');
    video?.play().catch(() => {});
    // Walk-up song on the drop (the theme covers the drumroll).
    if (!item.skipIntro && songFor(item.pid)) playSong(songFor(item.pid));
    // Captains get a long moment on screen, so their song keeps going.
    if (!item.skipIntro && item.loopSong) loopTheme();
    if (!item.skipIntro) {
      el.querySelector('.rv-flash').classList.add('go');
      const colors = [item.color || '#16402b', '#d9ad4a', '#f4efe3'];
      el.querySelector('.rv-confetti').innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${colors[i % 3]};animation-delay:${(Math.random() * 0.5).toFixed(2)}s;animation-duration:${(1.8 + Math.random()).toFixed(2)}s"></i>`).join('');
    }
    requestAnimationFrame(() => el.querySelector('.rv-name').classList.add('in'));
    at(item.skipIntro ? 50 : 2600, () => el.querySelector('.rv-card')?.classList.add('in'));
    at(item.skipIntro ? 100 : 3200, () => el.querySelector('.rv-roster')?.classList.add('in'));
    // Tuesday matchups: after the answer's reveal, flip to the VS screen.
    if (item.vs) {
      at(item.skipIntro ? 0 : 3400, () => {
        el.querySelector('.vs-screen').classList.add('in');
        video?.pause();
        loopTheme();
        el.querySelectorAll('.vs-screen video').forEach((v) => v.play().catch(() => {}));
      });
    }
  };
  if (item.skipIntro) drop();
  else {
    // The draft (captains and picks) gets a drumroll twice as long.
    const slow = item.slowIntro ? 2 : 1;
    at(400 * slow, () => el.querySelector('.rv-l1').classList.add('show'));
    at(1500 * slow, () => el.querySelector('.rv-l2').classList.add('show'));
    at(3200 * slow, drop);
  }
  el.querySelector('.vs-sound')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!audioUnlocked) unlockAudio().then(() => { playSong(songFor(item.pid) || DRAFT_THEME); loopTheme(); e.target.textContent = '🎵'; });
  });
  el.querySelector('.rv-sound').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!audioUnlocked) unlockAudio().then(() => { playSong(songFor(item.pid) || DRAFT_THEME); e.target.textContent = soundBtn(); });
  });
  return timers;
}

// Rewatching one pick from the draft board: its own overlay, tap to close.
function queueReveal(item) {
  if (document.querySelector('.rv-replay')) return;
  const el = document.createElement('div');
  el.className = 'rv rv-replay';
  el.style.setProperty('--c', item.color || '#16402b');
  document.body.appendChild(el);
  const scene = document.createElement('div');
  scene.className = 'rv-scene';
  el.appendChild(scene);
  const timers = mountReveal(scene, { skipIntro: true, ...item });
  if (item.skipIntro === false) playTheme();
  else if (songFor(item.pid)) playSong(songFor(item.pid));
  el.insertAdjacentHTML('beforeend', '<div class="rv-bar"><span>Replay</span><button class="rv-btn">Close</button></div>');
  el.addEventListener('click', (e) => {
    if (e.target.closest('.rv-sound, .vs-sound')) return;
    timers.forEach(clearTimeout);
    stopThemeLoop();
    audioEl?.pause();
    el.remove();
  });
}

// ---------- The draft room ----------
//
// Once Tate starts the draft, every phone shows one shared screen that
// follows the draft itself: the Captains Reveal on a fixed clock from the
// moment it started, then always the latest pick. Nobody has to tap to keep
// up; a phone that's behind (or reopens the app) jumps to where everyone is.
// Only the captain on the clock (or Tate) gets a "Make your pick" button.

const CAPTAIN_STEP_MS = 28000; // each captain's moment (and the "picks first" card)
let stageEl = null;
let stageKey = null;
let stageTimers = [];
let stageTick = null;
let pickSheetOpen = false;

// What the room should show right now, or null when there's no live draft.
function draftScene() {
  const dc = store.config.draft || {};
  if (!draft.captains || !dc.started) return null;
  const now = Date.now();
  if (!draft.picks?.length) {
    const t = Math.max(0, now - (dc.startedAt || now));
    const step = Math.min(2, Math.floor(t / CAPTAIN_STEP_MS));
    return { key: `cap:${dc.startedAt}:${step}`, kind: 'captains', step, startAt: (dc.startedAt || now) + step * CAPTAIN_STEP_MS };
  }
  const n = draft.picks.length - 1;
  return { key: `pick:${draft.captains.join('-')}:${n}:${draft.picks[n]}`, kind: 'pick', n, startAt: dc.times?.[n] || dc.at || now };
}

function closeStage() {
  stageTimers.forEach(clearTimeout);
  stopThemeLoop();
  stageEl?.remove();
  stageEl = null;
  stageKey = null;
  pickSheetOpen = false;
}

// ---------- Tuesday matchups in the draft room ----------

const tueRound = () => view.rounds.find((r) => r.format === 'escalating');
const teeFor = (m) => esc(tueRound()?.tees?.[m >> 1] || `Group ${(m >> 1) + 1}`);

// A player's Sat-Mon record, for the matchup cards.
function recordOf(pid) {
  const standings = computeStandings(view, store.scores);
  const r = standings.players[pid] || { points: 0, w: 0, l: 0, h: 0 };
  return { pts: fmtQuarter(r.points), wlh: `${r.w}-${r.l}-${r.h}` };
}

function recordCard(pid) {
  const r = recordOf(pid);
  const birdies = birdieCounts(view, store.scores, PLAYER_IDS)[pid]?.birdies || 0;
  return `<div class="rv-card">
    <div class="rv-card-head"><span>Sat – Mon</span><span>${esc(teamName(view, teamOf(view, pid)))}</span></div>
    <div class="rv-stats three">
      <div><b>${r.pts}</b><small>Points</small></div>
      <div><b>${r.wlh}</b><small>W-L-H</small></div>
      <div><b class="red">${birdies}</b><small>Birdies</small></div>
    </div>
    ${SCOUTING[pid] ? `<div class="rv-report"><span>The book on ${esc(playerName(pid))}</span>${esc(SCOUTING[pid])}</div>` : ''}
  </div>`;
}

// ---------- Tuesday VS screen ----------
//
// After a matchup is set, the room flips to a fight card: both clips split
// down the middle, a tale of the tape from the week so far, each player's
// last three rounds (hot or cold), any head to head, and Tuesday's strokes.

// A player's week so far (everything before Tuesday).
function weekStats(pid) {
  const standings = computeStandings(view, store.scores);
  const row = standings.players[pid] || { points: 0, w: 0, l: 0, h: 0 };
  const tue = tueRound();
  const earlier = enabledRounds(view).filter((r) => r !== tue);
  const singles = { w: 0, l: 0, h: 0 };
  for (const { match, result } of standings.matches) {
    if (match.type !== 'singles' || match.roundId === tue?.id || !result.done) continue;
    const si = match.sides.findIndex((sd) => sd.players.includes(pid));
    if (si < 0) continue;
    singles[result.leader === null ? 'h' : result.leader === si ? 'w' : 'l']++;
  }
  // Full 18-hole rounds (Friday counts for best round; Quicksands is 14 holes).
  const full = roundTotals(view, store.scores, pid)
    .filter((r) => r.holes === 18 && earlier.some((e) => e.id === r.roundId));
  const best = full.reduce((a, r) => (!a || r.gross < a.gross ? r : a), null);
  const recent = full.filter((r) => view.rounds.find((x) => x.id === r.roundId)?.format === 'match').slice(-3);
  const trend = recent.length >= 2 ? recent[0].gross - recent[recent.length - 1].gross : 0; // > 0: getting better
  // Best hole: best score to par anywhere (an ace beats everything).
  let bestHole = null;
  for (const r of earlier) {
    for (const [h, v] of Object.entries(store.scores[r.id]?.[pid] || {})) {
      const par = parFor(view, r.id, h);
      if (!par || !v) continue;
      const d = v === 1 ? -9 : v - par;
      if (!bestHole || d < bestHole.d) bestHole = { d, hole: h, course: r.course, v, par };
    }
  }
  const birdies = birdieCounts(view, store.scores, PLAYER_IDS)[pid]?.birdies || 0;
  const skins = computeSkins(view, store.scores, PLAYER_IDS, SKIN_STAKE).holes.filter((h) => h.winner === pid).length;
  return {
    pid, points: row.points, wlh: `${row.w}-${row.l}-${row.h}`, wins: row.w,
    singles, best, recent, trend, bestHole, birdies, skins, hcp: view.hcp?.[pid] ?? HCP_BUCKETS[0],
    heat: recent.length >= 2 ? (trend >= 3 ? 'hot' : trend <= -3 ? 'cold' : 'steady') : null,
  };
}

// Earlier matches where these two were on opposite sides.
function headToHead(x, y) {
  const standings = computeStandings(view, store.scores);
  const tue = tueRound();
  return standings.matches.filter(({ match, result }) => match.roundId !== tue?.id && result.done && !isTeamMatch(match)
    && match.sides.some((sd) => sd.players.includes(x)) && match.sides.some((sd) => sd.players.includes(y))
    && match.sides.findIndex((sd) => sd.players.includes(x)) !== match.sides.findIndex((sd) => sd.players.includes(y)))
    .map(({ match, result }) => {
      const r = view.rounds.find((rr) => rr.id === match.roundId);
      const kind = match.type === 'bestball' ? 'best ball' : 'singles';
      const out = result.leader === null ? 'halved'
        : `<b>${esc(sideLabel(match.sides[result.leader]))} won ${esc(result.status.replace('Won ', ''))}</b>`;
      return `Met <b>${dayName(r)}</b> in ${kind}: ${out}`;
    });
}

function vsScreen(m, st) {
  const [x, y] = st.front[m];
  const tue = tueRound();
  const a = weekStats(x);
  const b = weekStats(y);
  const half = (pid, side, t) => {
    const h = HIGHLIGHTS[pid] || {};
    const media = h.video ? `<video src="${h.video}" muted playsinline loop preload="auto" style="object-position:${h.focus || '50% 50%'}"></video>`
      : h.photo ? `<img src="${h.photo}" alt="">` : '';
    return `<div class="vs-half ${side}" style="--t:${teamColor(t)}">${media}<div class="vs-tint"></div></div>`;
  };
  const badge = (s) => (s.heat === 'hot' ? '<span class="vs-badge hot">🔥 On a heater</span>'
    : s.heat === 'cold' ? '<span class="vs-badge cold">🥶 Cooling off</span>'
      : s.heat === 'steady' ? '<span class="vs-badge">➖ Steady</span>' : '');
  const who = (s, side, t) => `<div class="vs-who ${side}">
    <div class="vs-team">${esc(teamName(view, t))} · ${s.hcp}</div>
    <div class="vs-name" style="font-size:${[42, 42, 42, 42, 42, 38, 34][playerName(s.pid).length] || 30}px">${esc(playerName(s.pid))}</div>${badge(s)}</div>`;
  // One stat row; `cmp` > 0 means the left player is better.
  const row = (label, l, r, cmp) => `<div class="vs-row">
    <div class="vs-v l ${cmp > 0 ? 'win' : ''}">${l}</div><div class="vs-k">${label}</div><div class="vs-v r ${cmp < 0 ? 'win' : ''}">${r}</div></div>`;
  const rec = (o) => `${o.w}-${o.l}${o.h ? `-${o.h}` : ''}`;
  const bestRound = (s) => (s.best ? `${s.best.gross}<small>${esc(s.best.course)}</small>` : '–');
  const HOLE_NAMES = { '-9': 'Ace', '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par' };
  const bestHole = (s) => {
    if (!s.bestHole) return '–';
    const name = HOLE_NAMES[s.bestHole.d] || (s.bestHole.d < -3 ? 'Albatross' : `+${s.bestHole.d}`);
    if (s.bestHole.d === -1) return `Birdie<small>${s.birdies} of them</small>`;
    return `${name}<small>#${s.bestHole.hole} ${esc(s.bestHole.course)}</small>`;
  };
  const skins = (s) => `${s.skins} · $${s.skins * SKIN_STAKE * (PLAYER_IDS.length - 1)}`;
  const sign = (v) => Math.sign(v);
  const rows = [
    row('Points', fmtQuarter(a.points), fmtQuarter(b.points), sign(a.points - b.points)),
    row('Record', a.wlh, b.wlh, sign(a.wins - b.wins)),
    row('Singles', rec(a.singles), rec(b.singles), sign(a.singles.w - a.singles.l - (b.singles.w - b.singles.l))),
    row('Best round', bestRound(a), bestRound(b), a.best && b.best ? sign(b.best.gross - a.best.gross) : 0),
    row('Birdies 🐦', a.birdies, b.birdies, sign(a.birdies - b.birdies)),
    row('Best hole', bestHole(a), bestHole(b), a.bestHole && b.bestHole ? sign(b.bestHole.d - a.bestHole.d) : 0),
    row('Skins 💰', skins(a), skins(b), sign(a.skins - b.skins)),
  ].join('');
  const form = (s, t) => {
    if (!s.recent.length) return `<div class="vs-form"><div class="vs-flab"><span>${esc(playerName(s.pid))}</span></div><p>No full rounds yet</p></div>`;
    const lo = Math.min(...s.recent.map((r) => r.gross));
    const hi = Math.max(...s.recent.map((r) => r.gross));
    const bars = s.recent.map((r, i) => {
      const pct = 45 + (hi === lo ? 55 : ((hi - r.gross) / (hi - lo)) * 55);
      const last = i === s.recent.length - 1;
      const bg = last && s.heat === 'hot' ? '#e2562b' : last && s.heat === 'cold' ? '#6fb7e6' : teamColor(t);
      return `<div style="height:${pct}%;background:${bg}"><span>${r.gross}</span></div>`;
    }).join('');
    const tr = s.trend > 0 ? `<span class="up">▲ ${s.trend}</span>` : s.trend < 0 ? `<span class="down">▼ ${-s.trend}</span>` : '';
    return `<div class="vs-form"><div class="vs-flab"><span>${esc(playerName(s.pid))} · last ${s.recent.length}</span>${tr}</div>
      <div class="vs-bars">${bars}</div>
      <div class="vs-days">${s.recent.map((r) => `<span>${esc(r.day.split(' ')[0])}</span>`).join('')}</div></div>`;
  };
  const meetings = headToHead(x, y);
  const [front] = halvesOf(tue || { holes: 18 });
  const hi = a.hcp > b.hcp ? a : b.hcp > a.hcp ? b : null;
  const holes = hi ? hardestHoles(view, tue?.id, front, STROKES_PER_NINE) : [];
  const notes = [
    `<div class="vs-note"><span>🤝</span><span>${meetings.length ? meetings.join('<br>') : 'First meeting this week'}</span></div>`,
    hi ? `<div class="vs-note stk"><span>●</span><span><b>${esc(playerName(hi.pid))} gets ${STROKES_PER_NINE} strokes</b> on the front: holes ${holes.join(', ').replace(/, (\d+)$/, ' and $1')}</span></div>`
      : '<div class="vs-note"><span>⚖️</span><span>Straight up, no strokes</span></div>',
  ].join('');
  return `<div class="vs-in" style="--t0:${teamColor(0)};--t1:${teamColor(1)}"><div class="vs-split">
      ${half(x, 'l', 0)}${half(y, 'r', 1)}<div class="vs-slash"></div>
      <div class="vs-pill">Match ${m + 1} · Front 9 · 1 pt · ${teeFor(m)}</div>
      <div class="vs-vs">VS</div>
      ${who(a, 'l', 0)}${who(b, 'r', 1)}
      <div class="vs-stripe l" style="background:${teamColor(0)}"></div><div class="vs-stripe r" style="background:${teamColor(1)}"></div>
    </div>
    <div class="vs-tape"><h3>Tale of the tape · the week so far</h3>${rows}</div>
    <div class="vs-forms">${form(a, 0)}${form(b, 1)}</div>
    <div class="vs-notes">${notes}</div></div>`;
}

// Once Tuesday is set: rewatch each matchup's pick (the answer's reveal,
// then the VS screen), from the Leaderboard's Tuesday matches.
function tueReplayCard(round) {
  if (round.leader == null) return '';
  const st = tueDraftState(store.config, round.leader);
  if (!st.done || !store.config.tueDraft?.started) return '';
  return `<div class="card tp-replay">
    <div class="cr-head"><span>🎬 Monday night's picks</span><span>Tap to rewatch</span></div>
    ${st.front.map(([x, y], m) => `<button class="tp-replay-row" data-action="tue-replay" data-m="${m}">
      <span class="tp-label">${teeFor(m)} · Match ${m + 1}</span>
      <span>${teamDot(0)}${esc(playerName(x))} <span class="vs">v</span> ${teamDot(1)}${esc(playerName(y))} <b>▶</b></span></button>`).join('')}
  </div>`;
}

function tueReplay(m) {
  const tue = tueRound();
  if (tue?.leader == null) return;
  const st = tueDraftState(store.config, tue.leader);
  if (!st.done) return;
  const sc = m === 3 ? { kind: 'last2', st } : { kind: 'answer', st, n: m * 2 + 2 };
  queueReveal({ ...tueItem(sc), skipIntro: false });
}

// What the room shows during the matchup draft, or null when it isn't on.
function tueScene() {
  const td = store.config.tueDraft || {};
  const tue = tueRound();
  if (!td.started || tue?.leader == null) return null;
  const st = tueDraftState(store.config, tue.leader);
  const n = st.moves.length;
  const at = (i) => td.times?.[i] || td.startedAt;
  if (n === 0) return { mode: 'tue', key: `tm:${td.startedAt}:0`, kind: 'start', st, startAt: td.startedAt };
  // After match 3 the room holds until Tate taps Next, then match 4 (the
  // last two) gets its reveal and VS screen, and holds again for the wrap-up.
  if (st.done) {
    const next = td.next || [];
    if (next.length >= 2) return { mode: 'tue', key: `tm:${td.startedAt}:done`, kind: 'done', st, startAt: next[1] };
    if (next.length === 1) {
      const second = Date.now() - next[0] >= LAST_STEP_MS;
      return { mode: 'tue', key: `tm:${td.startedAt}:m4${second ? 'b' : 'a'}`, kind: second ? 'last2' : 'last1', st,
        startAt: second ? next[0] + LAST_STEP_MS : next[0], tick: !second, waitNext: second };
    }
    return { mode: 'tue', key: `tm:${td.startedAt}:${n}`, kind: 'answer', st, n, startAt: at(n - 1), waitNext: true };
  }
  return { mode: 'tue', key: `tm:${td.startedAt}:${n}`, kind: n % 2 ? 'out' : 'answer', st, n, startAt: at(n - 1) };
}
const LAST_STEP_MS = 9000;

// Tate's Next button after match 3 and match 4.
function tueNext() {
  if (!isAdmin()) return;
  const want = (store.config.tueDraft?.next || []).length;
  store.updateConfig((c) => {
    const next = c.tueDraft.next || [];
    if (!c.tueDraft.started || next.length !== want) throw new Error('taken');
    c.tueDraft.next = [...next, Date.now()];
  }).catch((err) => { if (err.message !== 'taken') showError(err); });
}

function tueItem(sc) {
  const { st } = sc;
  const tn = (t) => esc(teamName(view, t));
  if (sc.kind === 'start') {
    return { title: 'Tuesday matchups', color: teamColor(st.trail),
      sub: `${tn(st.leader)} finished first · ${esc(playerName(captainOf(view, st.trail)))} puts out first` };
  }
  if (sc.kind === 'done') {
    const list = st.front.map((b, m) => `<div class="rv-set-row"><span>${teeFor(m)} · Match ${m + 1}</span>
      <b>${esc(playerName(b[0]))} v ${esc(playerName(b[1]))}</b></div>`).join('');
    return { title: 'Tuesday is set', sub: 'Front 9 matchups · 1 pt each', color: teamColor(st.leader),
      body: `<div class="rv-set">${list}<p>Back 9 (${ESCALATING_BACK_POINTS} pt${ESCALATING_BACK_POINTS === 1 ? '' : 's'}): you play the other guy in your group.</p></div>` };
  }
  if (sc.kind === 'last1' || sc.kind === 'last2') {
    // Match 4 is whoever's left, but it still gets the full treatment.
    const [p1, p2] = [st.front[3][st.leader], st.front[3][st.trail]];
    const pill = `Match 4 · ${teeFor(3)}`;
    if (sc.kind === 'last1') {
      return { pid: p1, color: teamColor(st.leader), kicker: 'Tuesday matchups · Match 4',
        line1: 'Match 4<br>Last two standing', line2: `<b>${tn(st.leader)}</b> sends out`,
        pill, selects: `${tn(st.leader)} · last man up`, sub: 'Match 4 · Front 9 · 1 pt', card: recordCard(p1) };
    }
    return { pid: p2, color: teamColor(st.trail), kicker: 'Tuesday matchups · Match 4',
      line1: `Who's got<br>${esc(playerName(p1))}?`, line2: `<b>${tn(st.trail)}</b> answers with`,
      pill, selects: `vs ${esc(playerName(p1))}`, sub: `${tn(st.trail)} · Match 4`, card: '', vs: vsScreen(3, st) };
  }
  const m = Math.floor((sc.n - 1) / 2);
  const pid = st.moves[sc.n - 1];
  if (sc.kind === 'out') {
    const t = st.order[m][0];
    return { pid, color: teamColor(t), kicker: `Tuesday matchups · Match ${m + 1}`,
      line1: `Match ${m + 1}<br>Front 9 · 1 pt`, line2: `<b>${tn(t)}</b> puts out`,
      pill: `Match ${m + 1} · ${teeFor(m)}`, selects: `${tn(t)} puts out`, sub: `Match ${m + 1} · Front 9 · 1 pt`,
      card: recordCard(pid) };
  }
  const t = st.order[m][1];
  const out = st.moves[sc.n - 2];
  return { pid, color: teamColor(t), kicker: `Tuesday matchups · Match ${m + 1}`,
    line1: `Who's got<br>${esc(playerName(out))}?`, line2: `<b>${tn(t)}</b> answers with`,
    pill: `Match ${m + 1} · ${teeFor(m)}`, selects: `vs ${esc(playerName(out))}`, sub: `${tn(t)} · Match ${m + 1}`,
    card: '', vs: vsScreen(m, st) };
}

// A captain's move in the matchup draft, checked against the latest saved
// state so two phones can't both move.
function makeTueMove(pid) {
  const tue = tueRound();
  if (tue?.leader == null) return;
  const st = tueDraftState(store.config, tue.leader);
  const turn = st.turn;
  if (!turn || !st.pool[turn.team].includes(pid)) return;
  if (!isAdmin() && ui.me !== captainOf(view, turn.team)) return;
  const msg = turn.role === 'out' ? `Put out ${playerName(pid)} for match ${turn.match + 1}?` : `${playerName(pid)} plays ${playerName(turn.out)}?`;
  if (!confirm(msg)) return;
  pickSheetOpen = false;
  store.updateConfig((c) => {
    const now = tueDraftState(c, tue.leader);
    if (!c.tueDraft.started || now.moves.length !== st.moves.length || !now.pool[turn.team].includes(pid)) throw new Error('taken');
    c.tueDraft.moves = [...now.moves, pid];
    c.tueDraft.times = [...(c.tueDraft.times || []).slice(0, now.moves.length), Date.now()];
    const after = tueDraftState(c, tue.leader);
    if (after.done) c.tuePicks = { pairs: after.pairs };
  }).catch((err) => {
    if (err.message === 'taken') alert('That just changed on another phone. Take another look.');
    else showError(err);
  });
}

// Keeps the room in step with the draft (or Monday's matchups): called on
// every render and once a second while a timed sequence is running.
function syncStage() {
  const sc = tueScene() || draftScene();
  const done = sc?.mode === 'tue' ? sc.kind === 'done' : draft.stage === 'done';
  const stale = sc && done && Date.now() - sc.startAt > 30 * 60 * 1000;
  if (!sc || stale || ui.draftHidden === sc.key) {
    closeStage();
    clearInterval(stageTick);
    stageTick = null;
    return;
  }
  const ticking = sc.tick || (sc.kind === 'captains' && sc.step < 2);
  if (ticking && !stageTick) stageTick = setInterval(syncStage, 1000);
  if (!ticking && stageTick) { clearInterval(stageTick); stageTick = null; }

  if (!stageEl) {
    stageEl = document.createElement('div');
    stageEl.className = 'rv rv-stage';
    stageEl.innerHTML = '<div class="rv-scene"></div><div class="rv-bar"></div><div class="rv-sheet" hidden></div>';
    stageEl.addEventListener('click', onStageClick);
    document.body.appendChild(stageEl);
  }
  if (sc.key !== stageKey) {
    stageKey = sc.key;
    stageTimers.forEach(clearTimeout);
    // Only phones that are there as it happens get the drumroll and music;
    // anyone joining late lands on the finished reveal.
    const fresh = Date.now() - sc.startAt < 6000;
    let item;
    if (sc.mode === 'tue') item = tueItem(sc);
    else if (sc.kind === 'captains') item = captainReveals()[sc.step];
    else item = pickReveal(sc.n);
    if (!item.title) item = { ...item, skipIntro: !fresh };
    // A looping song ends at the next reveal; a title card lets it play out.
    if (item.title) { if (audioEl) audioEl.loop = false; } else if (!item.vs) stopThemeLoop();
    stageTimers = mountReveal(stageEl.querySelector('.rv-scene'), item);
    stageEl.style.setProperty('--c', item.color || '#16402b');
    const opener = sc.mode === 'tue' ? sc.kind !== 'done' : sc.kind === 'pick' || sc.step === 0;
    if (fresh && opener) playTheme();
    pickSheetOpen = false;
  }
  renderStageBar(sc);
}

// The bar along the bottom of the room: whose turn it is, and a button for
// the captain who's up (Tate can act for either).
function renderStageBar(sc) {
  const bar = stageEl.querySelector('.rv-bar');
  const sheet = stageEl.querySelector('.rv-sheet');
  const hide = '<button class="rv-link" data-stage="hide">Board</button>';
  const act = (team, mine, label) => (ui.me === captainOf(store.config, team)
    ? `<button class="rv-btn" data-stage="pick">${mine}</button>`
    : isAdmin() ? `<button class="rv-link" data-stage="pick">${label}</button>` : hide);
  let html;
  let sheetTitle = '';
  let pool = [];
  if (sc.mode === 'tue') {
    const turn = sc.st.turn;
    const nextDone = (store.config.tueDraft?.next || []).length;
    if (sc.waitNext) {
      const label = nextDone ? 'Wrap it up →' : 'Next: match 4 →';
      html = `<span>${nextDone ? 'Tuesday is set' : 'Up next: match 4'}</span>
        ${isAdmin() ? `<button class="rv-btn" data-stage="next">${label}</button>` : `<span class="muted">Waiting on Tate</span>${hide}`}`;
    } else if (sc.kind === 'last1') {
      html = `<span>Match 4 · <b>last two standing</b></span>${hide}`;
    } else if (!turn) {
      html = `<span>✅ Tuesday is set</span><button class="rv-btn" data-stage="hide">See the board</button>`;
    } else {
      const cap = captainOf(store.config, turn.team);
      const who = ui.me === cap ? 'You' : esc(playerName(cap));
      const doing = turn.role === 'out' ? 'put out a player' : `pick who plays ${esc(playerName(turn.out))}`;
      html = `<span>Match ${turn.match + 1} · <b>${who}</b> ${ui.me === cap ? '' : 'to '}${doing}</span>
        ${act(turn.team, turn.role === 'out' ? 'Put out a player →' : 'Pick his opponent →', `Pick for ${esc(playerName(cap))}`)}`;
      sheetTitle = turn.role === 'out' ? `Match ${turn.match + 1}: who does ${esc(teamName(store.config, turn.team))} put out?`
        : `Who plays ${esc(playerName(turn.out))}?`;
      pool = sc.st.pool[turn.team];
    }
  } else if (draft.stage === 'done') {
    html = `<span>🎉 Draft complete</span><button class="rv-btn" data-stage="hide">See the teams</button>`;
  } else if (sc.kind === 'captains' && sc.step < 2) {
    html = `<span>🎬 Captains Reveal</span>${hide}`;
  } else {
    const on = draft.captains[draft.turn];
    const n = draft.picks.length + 1;
    html = `<span>Pick ${n} of ${PLAYER_IDS.length - 2} · <b>${esc(ui.me === on ? 'You\'re' : `${playerName(on)} is`)}</b> on the clock</span>
      ${ui.me === on ? '<button class="rv-btn" data-stage="pick">Make your pick →</button>'
        : isAdmin() ? `<button class="rv-link" data-stage="pick">Pick for ${esc(playerName(on))}</button>` : hide}`;
    sheetTitle = `Pick ${n} for ${esc(draftTeamName(draft.turn))}`;
    pool = draft.pool || [];
  }
  bar.innerHTML = html;
  if (pickSheetOpen && pool.length) {
    sheet.hidden = false;
    sheet.innerHTML = `<div class="rv-sheet-card">
      <div class="rv-sheet-title">${sheetTitle}</div>
      <div class="rv-pool">${pool.map((p) => `<button data-stage="choose" data-player="${p}">${esc(playerName(p))}</button>`).join('')}</div>
      <button class="rv-link" data-stage="cancel">Cancel</button>
    </div>`;
  } else {
    sheet.hidden = true;
  }
}

function onStageClick(e) {
  const t = e.target.closest('[data-stage]');
  if (!t) return;
  const what = t.dataset.stage;
  const sc = tueScene() || draftScene();
  if (what === 'hide') {
    ui.draftHidden = stageKey;
    saveUI();
    closeStage();
    render();
  } else if (what === 'pick') {
    pickSheetOpen = true;
    renderStageBar(sc);
  } else if (what === 'cancel') {
    pickSheetOpen = false;
    renderStageBar(sc);
  } else if (what === 'next') {
    tueNext();
  } else if (what === 'choose') {
    if (sc?.mode === 'tue') makeTueMove(t.dataset.player);
    else makePick(t.dataset.player);
  }
}

// A captain's pick, checked against the latest saved draft so two phones
// can't pick at once.
function makePick(pid) {
  const d = draft;
  if (d.stage !== 'drafting' || !d.pool.includes(pid) || !store.config.draft?.started) return;
  if (!isAdmin() && ui.me !== d.captains[d.turn]) return;
  if (!confirm(`Draft ${playerName(pid)} to ${draftTeamName(d.turn)}?`)) return;
  const turn = d.turn;
  pickSheetOpen = false;
  store.updateConfig((c) => {
    const now = draftState(c, store.scores, PLAYER_IDS);
    if (now.stage !== 'drafting' || now.turn !== turn || !now.pool.includes(pid) || !c.draft.started) throw new Error('taken');
    c.draft.picks = [...now.picks, pid];
    c.draft.times = [...(c.draft.times || []).slice(0, now.picks.length), Date.now()];
    c.draft.at = Date.now();
    const after = draftState(c, store.scores, PLAYER_IDS);
    // Last pick: the teams are set, named after the captains until they rename them.
    if (after.stage === 'done') {
      c.teams = after.rosters.map((players, i) => ({ name: `Team ${playerName(players[0])}`, color: TEAM_COLORS[i], players }));
    }
  }).catch((err) => {
    if (err.message === 'taken') alert('That pick just changed on another phone. Take another look.');
    else showError(err);
  });
}

// The team a pick went to, as named on draft night.
function draftTeamName(team) {
  const cap = draft.captains?.[team];
  const t = store.config.teams?.[team];
  return t?.name && t.players?.[0] === cap ? t.name : `Team ${playerName(cap)}`;
}
const draftColor = (team) => store.config.teams?.[team]?.color || TEAM_COLORS[team];

function captainReveals() {
  const [c1, c2] = draft.captains;
  const sub = (pid) => {
    const f = fridayStats(pid);
    return f?.done ? `Shot ${f.gross} (${fmtToPar(f.toPar)}) on Friday` : 'Captain';
  };
  return [
    { pid: c2, color: draftColor(1), kicker: 'The Buckle Up Draft', line1: 'Your Buckle Up<br>captains are…', line2: 'Captain No. 2',
      pill: 'Captain', selects: 'Captain', sub: sub(c2), music: true, seq: true, slowIntro: true, loopSong: true },
    { pid: c1, color: draftColor(0), kicker: 'The Buckle Up Draft', line1: 'And the medalist…', line2: 'Captain No. 1',
      pill: draft.manual ? 'Captain' : 'Medalist 🏅', selects: draft.manual ? 'Captain' : 'Medalist 🏅', sub: sub(c1), seq: true, slowIntro: true, loopSong: true },
    { title: `${esc(playerName(c1))} picks first`, sub: 'The draft is open.', color: draftColor(0), seq: true },
  ];
}

function pickReveal(n, { replay = false } = {}) {
  const pid = draft.picks[n];
  const team = n % 2;
  const total = PLAYER_IDS.length - 2;
  const roster = [draft.captains[team], ...draft.picks.slice(0, n + 1).filter((_, i) => i % 2 === team)];
  return {
    pid, color: draftColor(team), music: !replay, skipIntro: replay, slowIntro: true,
    kicker: `The Buckle Up Draft · Round ${Math.floor(n / 2) + 1}`,
    line1: `With the ${ordinal(n + 1)} pick<br>in the Buckle Up Draft…`,
    line2: `<b>${esc(draftTeamName(team))}</b> selects`,
    pill: replay ? `Pick ${n + 1} · Replay` : `Pick ${n + 1} of ${total}`,
    selects: `${esc(draftTeamName(team))} selects`,
    sub: `${esc(draftTeamName(team))} · pick ${n + 1} of ${total}`,
    roster: `${esc(draftTeamName(team))}: ${roster.map((p, i) => `<em class="${p === pid ? 'new' : ''}">${esc(playerName(p))}${i === 0 ? ' (C)' : ''}</em>`).join('')}`,
  };
}

// ---------- Match-winning banner ----------

// Banners only show for things that just happened: never seen on this phone
// (remembered across app restarts) and from the last 15 minutes. The first
// time a phone opens the app, everything so far is marked seen silently.
const SEEN_KEY = 'golftrip:seen';
const RECENT_MS = 15 * 60 * 1000;
let seen = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY));
    return Array.isArray(v) ? new Set(v) : null;
  } catch {
    return null;
  }
})();
const celebrations = [];

// When the last of these holes was scored.
function scoredAt(roundId, players, holes) {
  const t = store.scoreTimes?.[roundId] || {};
  return Math.max(0, ...players.flatMap((p) => holes.map((h) => t[p]?.[h] || 0)));
}

function checkForFinishes() {
  const events = []; // { key, at, banner, first }
  let lastFinal = 0;
  for (const m of buildMatches(view)) {
    const res = computeMatch(m, store.scores[m.roundId]);
    if (!res.done) continue;
    const last = [...res.holes].reverse().find((h) => h.winner !== null)?.hole || m.holes[m.holes.length - 1];
    const at = scoredAt(m.roundId, m.sides.flatMap((sd) => sd.players), [last]);
    lastFinal = Math.max(lastFinal, at);
    events.push({ key: `final:${m.id}:${res.status}:${m.sides.map((sd) => sd.players.join('+')).join('v')}`, at, banner: () => matchBanner(m, res) });
  }
  if (tripFinal(view, store.scores)) {
    const scoringIds = enabledRounds(view).filter((r) => r.format !== 'stroke').map((r) => r.id);
    const champ = rankTeams(view, store.scores, scoringIds, 'final').ranked[0];
    if (champ && !champ.unresolved) events.push({ key: `champ:${champ.idx}`, at: lastFinal, banner: () => championBanner(champ) });
  }
  // Aces get their own banner, the biggest one in the app.
  for (const r of enabledRounds(view)) {
    for (const [pid, holes] of Object.entries(store.scores[r.id] || {})) {
      for (const [hole, v] of Object.entries(holes)) {
        if (v !== 1) continue;
        events.push({
          key: `ace:${r.id}-${pid}-${hole}`, at: scoredAt(r.id, [pid], [hole]), first: true,
          banner: () => ({
            color: '#b8860b', kicker: `${roundDay(r)} · ${esc(r.course)} · Hole ${hole}`,
            title: 'Hole in one!', score: '⛳ 1', sub: `${esc(playerName(pid))} aced the par ${parFor(view, r.id, hole)}`, big: true,
          }),
        });
      }
    }
  }
  const now = Date.now();
  let changed = !seen;
  for (const e of events) {
    if (seen?.has(e.key)) continue;
    changed = true;
    if (!seen || !(e.always || (e.at && now - e.at < RECENT_MS))) continue;
    if (e.reveal) e.reveal().forEach(queueReveal);
    else if (e.first) celebrations.unshift(e.banner());
    else celebrations.push(e.banner());
  }
  if (changed) {
    seen = new Set([...(seen || []), ...events.map((e) => e.key)]);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500))); } catch {}
  }
  if (celebrations.length && !document.querySelector('.win-banner, .rv')) showNextCelebration();
}

function matchBanner(m, res) {
  const round = view.rounds.find((r) => r.id === m.roundId);
  const kind = `${round ? roundDay(round) : ''} · ${isTeamMatch(m) ? esc(round?.course || '') : esc(matchKind(m).split(' · ')[0])}`;
  const names = (si) => esc(sideLabel(m.sides[si]));
  if (m.type === 'teambirdies') {
    if (res.leader === null) return { color: '#6b7568', kicker: `${kind} · Birdie point`, title: 'Split', score: '½ – ½', sub: `${res.sides[0].birdies} birdies each` };
    return {
      color: teamColor(m.sides[res.leader].team), kicker: `${kind} · Birdie point`, title: `${names(res.leader)} win`,
      score: `🐦 ${esc(res.status)}`, sub: `Most birdies · ${BIRDIE_POINTS} point`,
    };
  }
  if (m.type === 'teamstroke') {
    if (res.leader === null) return { color: '#6b7568', kicker: kind, title: 'Tied', score: '1 – 1', sub: `${names(0)} and ${names(1)}` };
    return {
      color: teamColor(m.sides[res.leader].team), kicker: kind, title: `${names(res.leader)} win`,
      score: `By ${res.up}`, sub: `Net team total · ${TEAMSTROKE_POINTS} points`,
    };
  }
  if (res.leader === null) {
    return { color: '#6b7568', kicker: kind, title: 'Halved', score: '½ – ½', sub: `${names(0)} and ${names(1)}` };
  }
  const w = res.leader;
  return {
    color: teamColor(m.sides[w].team), kicker: kind, title: `${names(w)} win${m.sides[w].players.length > 1 ? '' : 's'}`,
    score: esc(res.status.replace('Won ', '')), sub: `over ${names(1 - w)}`,
  };
}

function championBanner(team) {
  return {
    color: teamColor(team.idx), kicker: 'Buckle Up · Final', title: `${esc(team.name)} win the Cup`,
    score: '🏆', sub: esc(team.players.map(playerName).join(', ')), big: true,
  };
}

function showNextCelebration() {
  if (document.querySelector('.rv, .win-banner')) return;
  const c = celebrations.shift();
  if (!c) return;
  const el = document.createElement('div');
  el.className = `win-banner ${c.big ? 'big' : ''}`;
  el.style.setProperty('--c', c.color);
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const confetti = calm ? '' : Array.from({ length: 36 }, (_, i) => {
    const colors = [c.color, '#d9ad4a', '#f4efe3'];
    return `<i style="left:${Math.random() * 100}%;background:${colors[i % 3]};animation-delay:${(Math.random() * 0.6).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1.2).toFixed(2)}s"></i>`;
  }).join('');
  el.innerHTML = `<div class="confetti">${confetti}</div>
    <div class="wb-card">
      <div class="wb-kicker">${c.kicker}</div>
      <div class="wb-title">${c.title}</div>
      <div class="wb-score">${c.score}</div>
      <div class="wb-sub">${c.sub}</div>
    </div>`;
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => { el.remove(); showNextCelebration(); }, 250);
  };
  el.addEventListener('click', close);
  setTimeout(close, c.big ? 7000 : 4500);
  document.body.appendChild(el);
}

// ---------- shell ----------

const TABS = [
  ['board', '🏆', 'Leaderboard', renderBoard],
  ['scores', '✏️', 'Scores', renderScores],
  ['feed', '💬', 'Feed', renderFeed],
  ['trip', '🗺️', 'Trip', renderTrip],
  ['setup', '⚙️', 'Setup', renderSetup],
];
// Reached from the champion banner, the Trip tab or a #recap link.
const HIDDEN_TABS = [['recap', '', 'Recap', renderRecap]];

function render() {
  // Don't yank a video someone is watching; re-render when it stops.
  if ([...app.querySelectorAll('video')].some((v) => !v.paused && !v.ended)) {
    renderQueued = true;
    return;
  }
  renderQueued = false;
  view = resolveConfig(store.config, store.scores);
  draft = draftState(store.config, store.scores, PLAYER_IDS);
  checkForFinishes();
  if (ui.tab === 'cards') { // Cards moved into Scores
    ui.tab = 'scores';
    ui.scoresView = 'card';
  }
  const tabs = TABS.filter(([id]) => id !== 'setup' || isAdmin());
  const tab = [...tabs, ...HIDDEN_TABS].find((t) => t[0] === ui.tab) || tabs[0];
  // Keep the cursor in whatever box the person is typing in.
  const active = document.activeElement;
  const focusId = app.contains(active) ? active.id : '';
  const sel = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  // Sync state as a dot on the name chip; words only when something's off.
  const sync = store.mode === 'firebase'
    ? (store.online ? '<span class="sync on" title="Live: syncing with everyone"></span>'
      : '<span class="sync off" title="Offline: scores save and sync later"></span><span class="sync-label">Offline</span>')
    : '<span class="sync local" title="Scores only on this device"></span><span class="sync-label">Local</span>';
  const who = ui.me ? `${esc(playerName(ui.me))}${isPlayer() ? '' : ' 👀'}` : 'Pick name';
  const scrollY = window.scrollY;
  const keepScroll = app.dataset.tab === tab[0];
  app.dataset.tab = tab[0];
  app.innerHTML = `
    <header class="top">
      <div class="brand"><div class="wordmark">Buckle Up</div><div class="tagline">${esc(TRIP.short)} · ${esc(TRIP.shortDates)}</div></div>
      <button class="me-chip" data-action="change-me" aria-label="Change name">${sync}<span>${who}</span><span class="caret">▾</span></button>
    </header>
    <main>${tab[3]()}</main>
    <nav class="tabs" style="--n:${tabs.length}">${tabs.map(([id, icon, label]) => `
      <button class="${id === tab[0] ? 'on' : ''}" data-action="tab" data-tab="${id}">
        <span>${icon}</span>${label}</button>`).join('')}</nav>
    ${ui.pickingMe || (!ui.me && !ui.watching) ? namePicker() : ''}`;
  if (keepScroll) window.scrollTo(0, scrollY);
  syncStage();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch {}
    }
  }
  saveUI();
}

app.addEventListener('pause', () => { if (renderQueued) render(); }, true);
app.addEventListener('ended', () => { if (renderQueued) render(); }, true);

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action } = el.dataset;
  const round = currentRound();

  switch (action) {
    case 'tab':
      ui.tab = el.dataset.tab;
      pickedSlot = null;
      window.scrollTo(0, 0);
      app.dataset.tab = '';
      break;
    case 'round':
      ui.roundId = el.dataset.id;
      ui.group = null;
      break;
    case 'group':
      ui.group = Number(el.dataset.group);
      break;
    case 'hole':
      clearTimeout(advanceTimer);
      advancePending = null;
      ui.hole = Number(el.dataset.hole);
      break;
    case 'set-score': {
      if (!isPlayer()) return;
      const pid = el.dataset.player;
      const value = Number(el.dataset.value);
      const cur = store.scores[round.id]?.[pid]?.[ui.hole];
      const before = groupHoleComplete(round, ui.hole);
      if (cur === value) {
        clearTimeout(advanceTimer);
        advancePending = null;
        store.setScore(round.id, pid, ui.hole, null).catch(showError);
        return;
      }
      store.setScore(round.id, pid, ui.hole, value).catch(showError);
      scheduleAdvance(round, before);
      return;
    }
    case 'set-me':
      ui.me = el.dataset.id;
      ui.pickingMe = false;
      ui.group = null;
      break;
    case 'set-guest': {
      const name = (drafts.guest || '').trim().slice(0, 24);
      if (!name) { document.getElementById('guest-name')?.focus(); return; }
      if (PLAYERS.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        alert(`${name} is a player. Tap the name above instead.`);
        return;
      }
      ui.me = GUEST + name;
      ui.pickingMe = false;
      drafts.guest = undefined;
      if (ui.tab === 'setup') ui.tab = 'board';
      break;
    }
    case 'change-me':
      ui.pickingMe = true;
      break;
    case 'close-picker':
      ui.pickingMe = false;
      if (!ui.me) ui.watching = true;
      break;
    case 'go-scores': {
      // Jump to the first hole this player hasn't scored yet in that round.
      const sc = store.scores[el.dataset.round]?.[ui.me] || {};
      const goRound = view.rounds.find((r) => r.id === el.dataset.round);
      ui.tab = 'scores';
      ui.scoresView = 'enter';
      ui.roundId = el.dataset.round;
      ui.group = Number(el.dataset.group);
      ui.hole = holesOf(goRound).find((h) => !sc[h]) || holesOf(goRound).length;
      window.scrollTo(0, 0);
      break;
    }
    case 'scores-view':
      ui.scoresView = el.dataset.id;
      break;
    case 'info':
      ui.info = ui.info === el.dataset.id ? null : el.dataset.id;
      break;
    case 'feed-filter':
      ui.feedFilter = el.dataset.id;
      ui.feedLimit = 40;
      break;
    case 'feed-more':
      ui.feedLimit = (ui.feedLimit || 40) + 40;
      break;
    case 'react':
      if (!ui.me) { ui.pickingMe = true; break; }
      store.toggleReaction(el.dataset.item, el.dataset.emoji, ui.me).catch(showError);
      return;
    case 'toggle-comments':
      ui.openComments = ui.openComments === el.dataset.item ? null : el.dataset.item;
      break;
    case 'comment': {
      if (!ui.me) { ui.pickingMe = true; break; }
      const key = `c:${el.dataset.item}`;
      const text = (drafts[key] || '').trim();
      if (!text) return;
      drafts[key] = '';
      store.addComment(el.dataset.item, { by: ui.me, text }).catch(showError);
      break;
    }
    case 'post':
      submitPost();
      return;
    case 'unpick': {
      const [m] = pendingMedia.splice(Number(el.dataset.i), 1);
      if (m) URL.revokeObjectURL(m.url);
      break;
    }
    case 'del-post':
      if (!confirm('Delete this post?')) return;
      store.deletePost(el.dataset.id).catch(showError);
      return;
    case 'zoom':
      openLightbox(el.dataset.src);
      return;
    case 'share-recap': {
      const url = `${location.origin}${location.pathname}#recap`;
      if (navigator.share) navigator.share({ title: 'Buckle Up · Trip Recap', url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('Link copied ✓'));
      return;
    }
    case 'pick-player': {
      // Setup swaps: players between teams (or reordered within one), and Friday groups.
      const slot = { kind: el.dataset.kind, a: Number(el.dataset.a), b: Number(el.dataset.b) };
      const same = pickedSlot && pickedSlot.kind === slot.kind && pickedSlot.a === slot.a && pickedSlot.b === slot.b;
      if (!pickedSlot || same || pickedSlot.kind !== slot.kind) {
        pickedSlot = same ? null : slot;
        break;
      }
      const first = pickedSlot;
      pickedSlot = null;
      saveSetup((c) => {
        const list = (x) => (x.kind === 'team' ? c.teams[x.a].players : c.rounds.find((r) => r.format === 'stroke').groups[x.a].players);
        const p1 = list(first)[first.b];
        list(first)[first.b] = list(slot)[slot.b];
        list(slot)[slot.b] = p1;
      });
      return;
    }
    case 'captain-set': {
      const pid = el.dataset.player;
      if ((draft.picks?.length || store.config.teams.length) && !confirm('Changing the captains resets the draft. Keep going?')) return;
      saveSetup((c) => {
        const caps = c.draft.captains.includes(pid) ? c.draft.captains.filter((p) => p !== pid)
          : c.draft.captains.length >= 2 ? [pid] : [...c.draft.captains, pid];
        c.draft.captains = caps;
        c.draft.picks = [];
        c.draft.times = [];
        c.draft.started = false;
        c.draft.at = Date.now();
        c.teams = [];
        c.tuePicks = { pairs: [] };
      });
      return;
    }
    case 'captain-auto':
      saveSetup((c) => { c.draft.captains = []; });
      return;
    case 'enter-room':
      unlockAudio().then(() => { toast("🎧 You're in the draft room"); render(); });
      return;
    case 'draft-start':
      if (!isAdmin() || draft.stage !== 'drafting') return;
      if (!confirm("Start the draft? Every phone plays the Captains Reveal and the first pick goes on the clock.")) return;
      if (!audioUnlocked) unlockAudio();
      store.updateConfig((c) => {
        c.draft.started = true;
        c.draft.startedAt = Date.now();
      }).catch(showError);
      return;
    case 'draft-stop':
      if (!isAdmin() || !confirm('Put the draft back to "starts later"? Picks made so far stay.')) return;
      saveSetup((c) => { c.draft.started = false; });
      return;
    case 'recap-open':
      openRecap();
      return;
    case 'tue-replay':
      tueReplay(Number(el.dataset.m));
      return;
    case 'replay-reveal': {
      const pid = el.dataset.player;
      const n = draft.picks.indexOf(pid);
      if (n >= 0) queueReveal(pickReveal(n, { replay: true }));
      else if (draft.captains?.includes(pid)) {
        const i = draft.captains.indexOf(pid);
        queueReveal({ ...captainReveals()[1 - i], music: false, skipIntro: true });
      }
      return;
    }
    case 'draft-pick':
      makePick(el.dataset.player);
      return;
    case 'draft-room-open':
      ui.draftHidden = null;
      break;
    case 'draft-undo':
      if (!isAdmin() || !confirm('Undo the last draft pick?')) return;
      saveSetup((c) => {
        c.draft.picks = draft.picks.slice(0, -1);
        c.draft.times = (c.draft.times || []).slice(0, draft.picks.length - 1);
        c.teams = [];
        c.tuePicks = { pairs: [] };
      });
      return;
    case 'draft-reset':
      if (!confirm('Reset the draft? This clears every pick and the teams, and it goes back to "starts later".')) return;
      saveSetup((c) => {
        c.draft.picks = [];
        c.draft.times = [];
        c.draft.started = false;
        c.teams = [];
        c.tuePicks = { pairs: [] };
      });
      return;
    case 'hcp-toggle': {
      if (!isAdmin()) return;
      const pid = el.dataset.player;
      saveSetup((c) => {
        const cur = c.hcp?.[pid] ?? HCP_BUCKETS[0];
        c.hcp = { ...c.hcp, [pid]: cur === HCP_BUCKETS[0] ? HCP_BUCKETS[1] : HCP_BUCKETS[0] };
      });
      return;
    }
    case 'team-color': {
      const t = Number(el.dataset.team);
      if (!isAdmin() && ui.me !== captainOf(store.config, t)) return;
      saveSetup((c) => { if (c.teams[t]) c.teams[t].color = el.dataset.color; });
      return;
    }
    case 'cap-puttoff': {
      if (!isPlayer()) return;
      const { key, player } = el.dataset;
      saveSetup((c) => {
        const list = ((c.puttoffs ||= {}).captain ||= {})[key] ||= [];
        if (!list.includes(player)) list.push(player);
      });
      return;
    }
    case 'cap-puttoff-reset':
      saveSetup((c) => { ((c.puttoffs ||= {}).captain ||= {})[el.dataset.key] = []; });
      return;
    case 'tue-start': {
      const r = enabledRounds(view).find((x) => x.needsPicks);
      if (!isAdmin() || !r) return;
      if (!confirm("Start Tuesday's matchups? Every phone opens the draft room.")) return;
      if (!audioUnlocked) unlockAudio();
      store.updateConfig((c) => {
        c.tueDraft = { started: true, startedAt: Date.now(), moves: [], times: [], next: [] };
        c.tuePicks = { pairs: [] };
      }).catch(showError);
      return;
    }
    case 'tue-reset':
      if (!confirm("Clear Tuesday's matchups so the captains can set them again?")) return;
      saveSetup((c) => {
        c.tuePicks = { pairs: [] };
        c.tueDraft = { started: false, startedAt: 0, moves: [], times: [], next: [] };
      });
      return;
    case 'puttoff': {
      if (!isPlayer()) return;
      const { stage, key } = el.dataset;
      const team = Number(el.dataset.team);
      saveSetup((c) => {
        const list = ((c.puttoffs ||= {})[stage] ||= {})[key] ||= [];
        if (!list.includes(team)) list.push(team);
      });
      return;
    }
    case 'puttoff-reset': {
      const { stage, key } = el.dataset;
      saveSetup((c) => { ((c.puttoffs ||= {})[stage] ||= {})[key] = []; });
      return;
    }
    case 'cross': {
      const { round: ri, group: gi } = el.dataset;
      saveSetup((c) => { c.rounds[ri].groups[gi].cross = !c.rounds[ri].groups[gi].cross; });
      return;
    }
  }
  render();
});

// Remember what's typed so live updates (which redraw the page) don't wipe it.
app.addEventListener('input', (e) => {
  const key = e.target.dataset.draft;
  if (!key) return;
  const hadText = !!drafts[key]?.trim();
  drafts[key] = e.target.value;
  // The Post button enables once there's something to post.
  if (key === 'post' && hadText !== !!drafts[key].trim()) render();
});

app.addEventListener('keydown', (e) => {
  const key = e.target.dataset.draft;
  if (e.key === 'Enter' && key?.startsWith('c:')) {
    e.preventDefault();
    app.querySelector(`[data-action="comment"][data-item="${key.slice(2)}"]`)?.click();
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'media-input') {
    for (const file of el.files) {
      if (!/^(image|video)\//.test(file.type)) continue;
      if (file.type.startsWith('video/') && file.size > MAX_VIDEO_MB * 1024 * 1024) {
        alert(`${file.name} is over ${MAX_VIDEO_MB} MB. Try a shorter clip.`);
        continue;
      }
      pendingMedia.push({ file, url: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image' });
    }
    render();
    return;
  }
  if (el.dataset.draft) {
    drafts[el.dataset.draft] = el.value;
    return;
  }
  const { edit, team, round } = el.dataset;
  if (!edit) return;
  if (edit === 'team-name' && !isAdmin() && ui.me !== captainOf(store.config, Number(team))) return;
  saveSetup((c) => {
    if (edit === 'team-name' && c.teams[team]) c.teams[team].name = el.value.trim() || `Team ${playerName(c.teams[team].players[0])}`;
    if (edit === 'round-enabled') c.rounds[round].enabled = el.checked;
    if (edit === 'round-course') c.rounds[round].course = el.value.trim() || c.rounds[round].course;
  });
});

function showError(err) {
  console.error(err);
  alert(`Couldn't save: ${err.message || err}`);
}

// #recap opens the recap.
function readHash() {
  if (location.hash === '#recap') ui.tab = 'recap';
}

(async () => {
  readHash();
  window.addEventListener('hashchange', () => { readHash(); render(); });
  store = await createStore(() => render());
  render();
})();
