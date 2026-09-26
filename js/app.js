import { createStore, MAX_VIDEO_MB } from './store.js';
import { PLAYERS, TEAM_COLORS, TRIP, ITINERARY, FLIGHTS, ESTIMATE, MATCHUPS } from './data.js';
import {
  buildMatches, computeMatch, computeStandings, birdieCounts, parFor, scoreMark, rankTeams, resolveConfig,
  TIEBREAKERS, FRONT_NINE, BACK_NINE, puttoffKey,
  matchStreak, birdieStreak, highlights, longestBirdieRun, longestMatchRun, roundTotals,
} from './scoring.js';

const UI_KEY = 'golftrip:ui';
const ADMIN_KEY = 'golftrip:admin';
// Opening the app with #admin=<code> shows the Setup tab on that phone.
const ADMIN_CODE = 'fore-8317';
const app = document.getElementById('app');

let store;
let view; // store.config with seeded matchups filled in (or marked TBD)
let pickedSlot = null; // Setup: first player tapped in a swap
const drafts = {}; // unsent text in the composer and comment boxes, by field
let pendingMedia = []; // photos/videos picked for the next post: { file, url, type }
let posting = null; // { done, total, frac } while a post uploads
let renderQueued = false;
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

const playerName = (id) => PLAYERS.find((p) => p.id === id)?.name ?? id;
const teamOf = (config, pid) => config.teams.findIndex((t) => t.players.includes(pid));
const teamColor = (idx) => TEAM_COLORS[idx % TEAM_COLORS.length];
const fmtPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
const sideLabel = (side) => side.players.map(playerName).join(' & ');

// A score with its scorecard mark: circle, double circle, square, double square.
function marked(score, par) {
  if (!score) return '';
  return `<span class="mk ${scoreMark(score, par)}">${score}</span>`;
}

const LEGEND = `<div class="legend">
  <span><span class="mk eagle">3</span> Eagle+</span>
  <span><span class="mk birdie">3</span> Birdie</span>
  <span><span class="mk bogey">5</span> Bogey</span>
  <span><span class="mk double">6</span> Double+</span>
</div>`;

function enabledRounds(config) {
  return config.rounds.filter((r) => r.enabled);
}

// Today's round during the trip, otherwise the first round still in play.
function defaultRoundId(config) {
  const rounds = enabledRounds(config);
  if (!rounds.length) return null;
  const today = new Date().toLocaleDateString('en-CA');
  const todays = rounds.find((r) => r.date === today);
  if (todays) return todays.id;
  const matches = buildMatches(config);
  const open = rounds.find((r) => matches
    .filter((m) => m.roundId === r.id)
    .some((m) => !computeMatch(m, store.scores[r.id]).done));
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
  return group.teams.map((t) => esc(config.teams[t]?.name)).join(' vs ');
}

function groupTitle(round, gi) {
  if (round.seeded) return gi === 0 ? '1st v 2nd' : '3rd v 4th';
  return `Group ${gi + 1}`;
}

// Shown in place of a seeded round's matches until Sat-Mon are all final.
function pendingNote(config, round) {
  const ifNow = round.seeding.map(([a, b]) => `${esc(config.teams[a].name)} v ${esc(config.teams[b].name)}`).join(' · ');
  if (round.needsPuttoff) {
    return `<div class="card tbd">
      <div class="tbd-title">Putt-off needed</div>
      <p>Teams are dead even for 2nd and 3rd after every tiebreaker. Play the putt-off and record the winner
        on the Leaderboard; the matchups are set right after.</p>
    </div>`;
  }
  return `<div class="card tbd">
    <div class="tbd-title">Matchups TBD</div>
    <p>Set when every earlier match is final: <b>1st v 2nd</b> and <b>3rd v 4th</b> in the standings.</p>
    <p class="muted">If it ended now: ${ifNow}</p>
  </div>`;
}

// ---------- shared components ----------

function roundChips(activeId) {
  return `<div class="chips" role="tablist">${enabledRounds(view).map((r) => `
    <button class="chip ${r.id === activeId ? 'on' : ''}" data-action="round" data-id="${r.id}">
      <span>${esc(r.day.split(' ')[0])}</span><small>${esc(r.course)}</small>
    </button>`).join('')}</div>`;
}

function teamDot(idx) {
  return `<span class="dot" style="background:${teamColor(idx)}"></span>`;
}

function matchCard(match, res, { compact = false } = {}) {
  const label = match.type === 'bestball' ? 'Best Ball · Front 9' : 'Singles · Back 9';
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

const ORDINALS = ['1st', '2nd', '3rd', '4th'];

function fmtTieValue(key, v) {
  if (key === 'h2h') return `${fmtPts(v)} pts`;
  if (key === 'wins') return `${v} won`;
  if (key === 'margin') return v > 0 ? `+${v}` : String(v);
  if (key === 'strokes') return `${v} strokes`;
  if (key === 'puttoff') return v ? ORDINALS[v - 1] : '–';
  return String(v);
}

// Step-by-step breakdown of each tie, down the tiebreaker list until it's
// settled, with putt-off buttons if it comes to that.
// A putt-off only matters if the still-tied teams straddle a spot that
// counts: 2nd/3rd for the seeding, 1st for the title.
function puttoffMatters(ranked, teams, stage) {
  const top = Math.min(...ranked.filter((t) => teams.includes(t.idx)).map((t) => ranked.indexOf(t) + 1));
  const bottom = top + teams.length - 1;
  return stage === 'seed' ? top <= 2 && bottom >= 3 : top === 1;
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
    if (!puttoffMatters(ranked, left, stage)) {
      return `<div class="tie-step">
        <div class="step-label">${TIEBREAKERS.length}. Putt-off</div>
        ${sofar}
        <p class="muted">${names(left)} stay tied. No putt-off needed: it wouldn't change ${stage === 'seed' ? 'the matchups' : 'the winner'}.</p>
        ${p.done.length ? puttoffUndo(p.key) : ''}
      </div>`;
    }
    return `<div class="tie-step puttoff">
      <div class="step-label">${TIEBREAKERS.length}. Putt-off ⛳</div>
      ${sofar}
      <p>${names(left)} are still dead even. Head to the putting green!</p>
      <p class="muted">Tap the winner${left.length > 2 ? ', then the next finisher, and so on' : ''}:</p>
      <div class="puttoff-btns">${left.map((t) => `
        <button data-action="puttoff" data-stage="${stage}" data-key="${p.key}" data-team="${t}">${teamDot(t)}${name(t)}</button>`).join('')}</div>
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

// ---------- Leaderboard ----------

function renderBoard() {
  const config = view;
  const { scores } = store;
  const standings = computeStandings(config, scores);
  const round = currentRound();
  const rounds = enabledRounds(config);
  const allIds = rounds.map((r) => r.id);
  const allFinal = standings.matches.length > 0 && !rounds.some((r) => r.pending)
    && standings.matches.every((m) => m.result.done);

  // Tiebreakers only show at the two checkpoints: when the rounds before the
  // seeded day are all final (until that day starts), and at the very end.
  const seeded = rounds.find((r) => r.seeded);
  const seededStarted = seeded && standings.matches.some((m) => m.match.roundId === seeded.id && m.result.played > 0);
  const seedStage = !allFinal && seeded?.priorFinal && !seededStarted;
  const stage = seedStage ? 'seed' : 'final';
  const { ranked } = rankTeams(config, scores, seedStage ? seeded.priorIds : allIds, stage);
  let panel = '';
  if (allFinal) {
    const { ties } = rankTeams(config, scores, allIds, 'final');
    if (ties.length) panel = tiePanel(config, 'Final standings', 'Teams finished level on points, so the tiebreakers decide the order.', ties, 'final', ranked);
  } else if (seedStage) {
    const { ties } = rankTeams(config, scores, seeded.priorIds, 'seed');
    if (ties.length) panel = tiePanel(config, `${esc(seeded.day.split(' ')[0])} seeding`, `Teams are level on points after the earlier rounds, so the tiebreakers set ${esc(seeded.day.split(' ')[0])}'s matchups.`, ties, 'seed', ranked);
  }
  const showTiebreaks = !!panel;

  const teamRows = ranked.map((r, i) => {
    const t = standings.teams[r.idx];
    const rank = i > 0 && ranked[i - 1].rank === r.rank ? '' : r.rank;
    const live = t.projected !== t.points
      ? `<div class="live-pts">${fmtPts(t.projected)} if all live matches ended now</div>` : '';
    const tb = !showTiebreaks ? '' : r.unresolved ? '<div class="tiebreak">Tied on every tiebreaker</div>'
      : r.tiebreak ? `<div class="tiebreak">Placed on tiebreaker: ${esc(r.tiebreak)}</div>` : '';
    const winner = allFinal && i === 0 && !r.unresolved;
    return `<div class="team-row ${winner ? 'winner' : ''}" style="--team:${teamColor(t.idx)}">
      <div class="rank">${winner ? '🏆' : rank}</div>
      <div class="team-info">
        <div class="team-name">${esc(t.name)}</div>
        <div class="team-players">${t.players.map(playerName).join(' & ')} · ${t.w}-${t.l}-${t.h}</div>
        ${live}${tb}
      </div>
      <div class="big-pts">${fmtPts(t.points)}</div>
    </div>`;
  }).join('');

  const roundMatches = standings.matches.filter((m) => m.match.roundId === round?.id);
  const players = Object.values(standings.players)
    .sort((a, b) => b.points - a.points || b.w - a.w || playerName(a.id).localeCompare(playerName(b.id)));
  const birdies = Object.values(birdieCounts(config, scores)).sort((a, b) => (
    b.birdies - a.birdies || playerName(a.id).localeCompare(playerName(b.id))));

  const champ = allFinal ? ranked[0] : null;
  let champBanner = '';
  if (champ && !champ.unresolved) {
    champBanner = `<div class="champ" style="--team:${teamColor(champ.idx)}">
      <div class="champ-cup">🏆</div>
      <div><div class="champ-name">${esc(champ.name)} are the champions</div>
      <div class="champ-sub">${champ.players.map(playerName).join(' & ')} · ${fmtPts(champ.points)} pts${champ.tiebreak ? ` · won on ${esc(champ.tiebreak.toLowerCase())}` : ''}</div>
      <button class="champ-link" data-action="tab" data-tab="recap">See the trip recap →</button></div>
    </div>`;
  } else if (champ) {
    champBanner = `<div class="champ">
      <div class="champ-cup">⛳</div>
      <div><div class="champ-name">Tied for the title</div>
      <div class="champ-sub">Every tiebreaker is even. The putt-off decides it (see below).</div></div>
    </div>`;
  }

  return `
    ${champBanner}
    <section>
      <h2>Team Standings</h2>
      <div class="card teams">${teamRows}</div>
      <p class="note">Win = 1 · Tie = ½ · Loss = 0 &nbsp;·&nbsp; 3 pts per team up for grabs each day</p>
      ${panel}
      <details class="note tb-rules"><summary>Tiebreakers</summary>
        <p>If teams are level on points (for Tuesday's seeding after Monday, and for the final standings):</p>
        <ol>${TIEBREAKERS.map((tb) => `<li>${tb.label}</li>`).join('')}</ol>
        <p><b>Head-to-head</b> counts points only from matches between the tied teams. <b>Holes-up margin</b> adds up how much each match was won or lost by (Won 3&2 = +3, lost 1 UP = −1). <b>Total strokes</b> is both players' scores added up over the rounds that count. <b>Putt-off</b>: if it's still dead even, the tied teams settle it on the putting green and someone records the winner here.</p>
      </details>
    </section>
    <section>
      <h2>Matches</h2>
      ${roundChips(round?.id)}
      ${round?.pending ? pendingNote(config, round) : round ? round.groups.map((g, gi) => `
        <h3>${groupTitle(round, gi)} · ${groupLabel(config, g)}</h3>
        ${roundMatches.filter((m) => m.match.group === gi).map((m) => matchCard(m.match, m.result)).join('')}
      `).join('') : '<p class="empty">No rounds enabled.</p>'}
    </section>
    <section>
      <h2>Birdie Board 🐦</h2>
      <div class="card">
        <table class="table">
          <thead><tr><th></th><th>Player</th><th class="num">Birdies</th></tr></thead>
          <tbody>${birdies.map((b, i) => `
            <tr><td class="muted">${i + 1}</td><td>${teamDot(teamOf(config, b.id))} ${esc(playerName(b.id))}</td>
            <td class="num"><b>${b.birdies}</b></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="note">Every hole of every tournament round counts, both nines. An eagle counts as a birdie.</p>
    </section>
    <section>
      <h2>Individual</h2>
      <div class="card">
        <table class="table">
          <thead><tr><th></th><th>Player</th><th>W-L-T</th><th class="num">Pts</th></tr></thead>
          <tbody>${players.map((p, i) => `
            <tr><td class="muted">${i + 1}</td><td>${teamDot(p.team)} ${esc(playerName(p.id))}</td>
            <td>${p.w}-${p.l}-${p.h}</td><td class="num"><b>${fmtPts(p.points)}</b></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="note">Best ball results count for both teammates.</p>
    </section>`;
}

// ---------- Score entry ----------

function renderScores() {
  const config = view;
  const { scores } = store;
  const round = currentRound();
  if (!round) return '<p class="empty">No rounds enabled. Turn one on in Setup.</p>';
  if (round.pending) return `${roundChips(round.id)}${pendingNote(config, round)}`;

  if (ui.group == null || !round.groups[ui.group]) {
    const mine = ui.me ? round.groups.findIndex((g) => g.teams.includes(teamOf(config, ui.me))) : -1;
    ui.group = Math.max(0, mine);
  }
  const group = round.groups[ui.group];
  const hole = ui.hole;
  const roundScores = scores[round.id] || {};
  const players = group.teams.flatMap((t) => config.teams[t].players.map((p) => ({ id: p, team: t })));
  const isFront = hole <= 9;
  const par = parFor(config, round.id, hole);

  const holeBtns = [...FRONT_NINE, ...BACK_NINE].map((h) => {
    const complete = players.every((p) => roundScores[p.id]?.[h]);
    const some = players.some((p) => roundScores[p.id]?.[h]);
    return `<button class="hole ${h === hole ? 'on' : ''} ${complete ? 'full' : some ? 'part' : ''}"
      data-action="hole" data-hole="${h}">${h}</button>${h === 9 ? '<span class="turn"></span>' : ''}`;
  }).join('');

  const bStreak = (pid) => {
    const n = birdieStreak(config, round.id, roundScores[pid]);
    return n >= 2 ? `<span class="streak hot" title="${n} birdies in a row">🐦🔥${n}</span>` : '';
  };
  const rows = players.map((p) => {
    const v = roundScores[p.id]?.[hole];
    const total = Object.values(roundScores[p.id] || {}).reduce((a, b) => a + b, 0);
    return `<div class="entry-row">
      ${teamDot(p.team)}
      <div class="entry-name">${esc(playerName(p.id))}${bStreak(p.id)}<small>${total ? `${total} total` : ''}</small></div>
      <div class="stepper">
        <button data-action="step" data-player="${p.id}" data-delta="-1" aria-label="Minus">−</button>
        <output class="${v ? '' : 'blank'}">${v ? marked(v, par) : '–'}</output>
        <button data-action="step" data-player="${p.id}" data-delta="1" aria-label="Plus">+</button>
      </div>
      <button class="clear" data-action="clear" data-player="${p.id}" aria-label="Clear" ${v ? '' : 'disabled'}>✕</button>
    </div>`;
  }).join('');

  const segmentMatches = buildMatches(config)
    .filter((m) => m.roundId === round.id && m.group === ui.group && m.holes.includes(hole));

  return `
    ${roundChips(round.id)}
    <div class="seg">${round.groups.map((g, gi) => `
      <button class="${gi === ui.group ? 'on' : ''}" data-action="group" data-group="${gi}">
        ${groupTitle(round, gi)}<small>${groupLabel(config, g)}</small>
      </button>`).join('')}</div>
    <div class="holes">${holeBtns}</div>
    <div class="card entry">
      <div class="entry-head">
        <div><div class="hole-num">Hole ${hole}</div>
        <div class="hole-par">Par ${par ?? '–'}</div>
        <div class="muted">${isFront ? 'Best Ball — low score on each team counts' : 'Singles match play'}</div></div>
        <span class="badge ${isFront ? 'bb' : 'sg'}">${isFront ? 'Best Ball' : 'Singles'}</span>
      </div>
      ${rows}
      <p class="note">Everyone enters their own score. Picked up? Leave it blank${isFront ? ' — your partner\'s score counts' : ''}.</p>
      <div class="nav-row">
        <button class="btn ghost" data-action="hole" data-hole="${Math.max(1, hole - 1)}" ${hole === 1 ? 'disabled' : ''}>← Hole ${hole - 1 || ''}</button>
        <button class="btn" data-action="hole" data-hole="${Math.min(18, hole + 1)}" ${hole === 18 ? 'disabled' : ''}>Hole ${hole < 18 ? hole + 1 : ''} →</button>
      </div>
    </div>
    <h3>${isFront ? 'Best ball match' : 'Singles matches'}</h3>
    ${segmentMatches.map((m) => matchCard(m, computeMatch(m, roundScores), { compact: true })).join('')}`;
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
        const counted = match.type === 'bestball' && v && v === (side === match.sides[0] ? h.a : h.b);
        return `<td class="${counted ? 'counted' : ''}">${marked(v, pars?.[match.holes[i]])}</td>`;
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
  const sum = (holes, fn) => holes.reduce((a, h) => a + (fn(h) || 0), 0);
  const nine = (holes, fn, cls = '') => holes.map((h) => `<td class="${cls}">${fn(h)}</td>`).join('');
  const parOut = sum(FRONT_NINE, (h) => pars[h]);
  const parIn = sum(BACK_NINE, (h) => pars[h]);

  const rows = round.groups.map((g, gi) => g.teams.flatMap((t) => config.teams[t].players.map((p) => {
    const sc = roundScores[p] || {};
    const played = [...FRONT_NINE, ...BACK_NINE].filter((h) => sc[h]);
    const out = sum(FRONT_NINE, (h) => sc[h]);
    const inn = sum(BACK_NINE, (h) => sc[h]);
    const toPar = played.reduce((a, h) => a + sc[h] - (pars[h] || 0), 0);
    const toParTxt = !played.length ? '' : toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : String(toPar);
    return `<tr class="${gi > 0 && t === g.teams[0] && p === config.teams[t].players[0] ? 'group-start' : ''}">
      <th>${teamDot(t)}${esc(playerName(p))}</th>
      ${nine(FRONT_NINE, (h) => marked(sc[h], pars[h]))}<td class="sub">${out || ''}</td>
      ${nine(BACK_NINE, (h) => marked(sc[h], pars[h]))}<td class="sub">${inn || ''}</td>
      <td class="tot">${out + inn || ''}</td><td class="topar ${toPar < 0 ? 'under' : ''}">${toParTxt}</td>
    </tr>`;
  })).join('')).join('');

  return `<div class="card sc-card"><div class="sc-wrap"><table class="sc full">
    <thead><tr><th>Hole</th>${FRONT_NINE.map((h) => `<th>${h}</th>`).join('')}<th>Out</th>
      ${BACK_NINE.map((h) => `<th>${h}</th>`).join('')}<th>In</th><th>Tot</th><th>±</th></tr></thead>
    <tbody>
      <tr class="par-row"><th>Par</th>${nine(FRONT_NINE, (h) => pars[h] ?? '')}<td class="sub">${parOut}</td>
        ${nine(BACK_NINE, (h) => pars[h] ?? '')}<td class="sub">${parIn}</td><td class="tot">${parOut + parIn}</td><td></td></tr>
      ${rows}
    </tbody></table></div></div>`;
}

function renderCards() {
  const config = view;
  const { scores } = store;
  const round = currentRound();
  if (!round) return '<p class="empty">No rounds enabled.</p>';
  if (round.pending) {
    return `${roundChips(round.id)}<h2>${esc(round.course)} · ${esc(round.day)}</h2>
      ${courseCard(config, round, {})}${pendingNote(config, round)}`;
  }
  const roundScores = scores[round.id] || {};
  const pars = config.pars?.[round.id];
  const matches = buildMatches(config).filter((m) => m.roundId === round.id);

  return `
    ${roundChips(round.id)}
    <h2>${esc(round.course)} · ${esc(round.day)}</h2>
    ${courseCard(config, round, roundScores)}
    ${LEGEND}
    <h2>Match cards</h2>
    ${round.groups.map((g, gi) => `
      <h3>${groupTitle(round, gi)} · ${groupLabel(config, g)}</h3>
      ${matches.filter((m) => m.group === gi).map((m) => {
        const res = computeMatch(m, roundScores);
        return `<div class="card sc-card">${matchCard(m, res, { compact: true })}${scorecard(m, res, roundScores, pars)}</div>`;
      }).join('')}`).join('')}
    <p class="note">Green-shaded scores are the ones counting for best ball. The match row shows how many holes up the leading side is (in their team color).</p>`;
}

// ---------- Trip ----------

function mapLink(address) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function renderTrip() {
  const total = ESTIMATE.reduce((a, [, v]) => a + v, 0);
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
          ${d.stay ? `<li><span class="ico">🛏️</span><div>Stay: <b>${esc(d.stay.name)}</b>
            <a href="${mapLink(d.stay.address)}" target="_blank" rel="noopener"><small>${esc(d.stay.address)}</small></a></div></li>` : ''}
        </ul>
      </article>`).join('')}
    <h2>Flights</h2>
    <div class="card">${FLIGHTS.map((f) => `<div class="kv"><b>✈️ ${f.route}</b><span>${f.when}</span></div>`).join('')}
      <div class="kv"><span class="muted">Roundtrip</span><span>$500</span></div></div>
    <h2>Trip Crew</h2>
    <div class="card">${PLAYERS.map((p) => `
      <a class="kv crew" href="tel:${p.phone.replace(/\D/g, '')}"><b>${esc(p.name)}</b><span>${p.phone}</span></a>`).join('')}</div>
    <h2>Trip Estimate</h2>
    <div class="card">${ESTIMATE.map(([k, v]) => `<div class="kv"><span>${k}</span><span>$${v}</span></div>`).join('')}
      <div class="kv total"><b>Total (estimated)</b><b>$${total.toLocaleString()}</b></div></div>`;
}

// ---------- Setup ----------

function renderSetup() {
  const { config } = store;
  const matchupLabel = ([a, b]) => `${esc(config.teams[a].name)} v ${esc(config.teams[b].name)}`;
  const currentMatchup = (r) => MATCHUPS.findIndex(([g1]) => r.groups.some((g) => (
    g.teams.includes(g1[0]) && g.teams.includes(g1[1]))));

  return `
    <div class="card admin-note">
      <p>🔒 <b>Only you see this tab.</b> Setup is unlocked on this phone only; everyone else just sees the other tabs.</p>
      <div class="nav-row">
        <button class="btn ghost" data-action="tab" data-tab="recap">Preview trip recap</button>
        <button class="btn ghost" data-action="lock-admin">Hide Setup here</button>
      </div>
    </div>

    <h2>Teams</h2>
    <p class="note">Tap a player, then tap another player to swap them. Changes save for everyone right away.</p>
    ${config.teams.map((t, ti) => `
      <div class="card setup-team" style="--team:${teamColor(ti)}">
        <input type="text" value="${esc(t.name)}" data-edit="team-name" data-team="${ti}" aria-label="Team name" enterkeyhint="done">
        <div class="two">${t.players.map((pid, si) => `
          <button class="player-chip ${pickedSlot?.team === ti && pickedSlot?.slot === si ? 'picked' : ''}"
            data-action="pick-player" data-team="${ti}" data-slot="${si}">${esc(playerName(pid))}</button>`).join('')}</div>
      </div>`).join('')}

    <h2>Daily matchups</h2>
    <p class="note">Each group plays best ball on the front 9, then two singles matches on the back 9.</p>
    ${config.rounds.map((r, ri) => {
      const cur = currentMatchup(r);
      const resolved = view.rounds[ri];
      return `
      <div class="card setup-round ${r.enabled ? '' : 'off'}">
        <label class="toggle"><input type="checkbox" data-edit="round-enabled" data-round="${ri}" ${r.enabled ? 'checked' : ''}>
          <b>${esc(r.day)}</b><span class="muted">counts toward the tournament</span></label>
        <input type="text" value="${esc(r.course)}" data-edit="round-course" data-round="${ri}" aria-label="Course" enterkeyhint="done">
        ${r.seeded ? `<div class="seeded">
            <b>Seeded from the standings</b> after the earlier rounds: 1st v 2nd, 3rd v 4th.
            <button class="link" data-action="seeded" data-round="${ri}" data-on="0">Pick matchups instead</button></div>`
          : `<div class="matchups">${MATCHUPS.map((m, mi) => `
          <button class="${mi === cur ? 'on' : ''}" data-action="matchup" data-round="${ri}" data-m="${mi}">
            <span>${matchupLabel(m[0])}</span><span>${matchupLabel(m[1])}</span></button>`).join('')}</div>
          ${ri === config.rounds.length - 1 ? `<button class="link seed-link" data-action="seeded" data-round="${ri}" data-on="1">Seed from standings instead</button>` : ''}`}
        ${resolved.pending ? '<div class="singles-line">Singles: TBD until the matchups are set.</div>'
          : resolved.groups.map((g, gi) => {
          const [a, b] = g.teams.map((t) => config.teams[t]);
          const pairs = g.cross ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
          return `<div class="singles-line">${r.seeded ? groupTitle(r, gi) : `Group ${gi + 1}`} singles:
            <b>${pairs.map(([pa, pb]) => `${esc(playerName(a.players[pa]))} v ${esc(playerName(b.players[pb]))}`).join(' · ')}</b>
            <button class="link" data-action="cross" data-round="${ri}" data-group="${gi}">Swap</button></div>`;
        }).join('')}
      </div>`;
    }).join('')}

    <h2>Sync</h2>
    <div class="card">
      ${store.mode === 'firebase'
        ? `<p>✅ <b>Live sync is on.</b> Scores appear on everyone's phone instantly and are saved offline if you lose signal.</p>`
        : `<p>⚠️ <b>Local mode.</b> Scores are only saved on this device.</p>`}
    </div>`;
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
    case 'eagle': return [`🦅 EAGLE! ${who} made ${h.score} on the par ${h.par}`, where];
    case 'birdie': return [`🐦 ${who} birdied`, `${where} · ${h.score} on a par ${h.par}`];
    case 'birdieRun': return [`🔥 ${who}: ${h.n} birdies in a row!`, `#${h.hole - h.n + 1}–${h.hole} · ${esc(roundName(config, h.roundId))}`];
    case 'holeRun': return [`🔥 ${side(h.match, h.side)} won ${h.n} straight holes`, `vs ${side(h.match, 1 - h.side)} · thru #${h.hole}`];
    case 'matchFinal': {
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
  const hl = highlights(config, store.scores, store.scoreTimes);
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
          ${round ? [...FRONT_NINE, ...BACK_NINE].map((h) => `<option value="${h}" ${String(drafts.hole) === String(h) ? 'selected' : ''}>Hole ${h}</option>`).join('') : ''}
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
  const allIds = rounds.map((r) => r.id);
  const { ranked } = rankTeams(config, scores, allIds, 'final');
  const standings = computeStandings(config, scores);
  const birdies = birdieCounts(config, scores);
  const pids = config.teams.flatMap((t) => t.players);
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
  const paparazzi = top(pids, (p) => posts.filter((x) => x.by === p).reduce((a, x) => a + (x.media?.length || 0), 0));
  const names = (list) => list.map((p) => esc(playerName(p))).join(' & ');

  const awards = [
    mvp && ['🎖️', 'MVP', names(mvp.who), `${fmtPts(mvp.best)} match points`],
    birdieKing && ['🐦', 'Birdie King', names(birdieKing.who), `${birdieKing.best} birdies`],
    lowRound && ['⛳', 'Low Round', esc(playerName(lowRound.p)), `${lowRound.gross} (${lowRound.gross - lowRound.par >= 0 ? '+' : ''}${lowRound.gross - lowRound.par}) at ${esc(lowRound.course)}`],
    hottest?.best >= 2 && ['🔥', 'Hottest Hand', names(hottest.who), `${hottest.best} birdies in a row`],
    runBest?.n >= 3 && ['💪', 'Longest Run', esc(sideLabel(runBest.m.sides[runBest.side])), `won ${runBest.n} straight holes`],
    crowd && reactCount(`p-${crowd.id}`) > 0 && ['💬', 'Crowd Favorite', esc(playerName(crowd.by)), `${reactCount(`p-${crowd.id}`)} reactions`],
    paparazzi && ['📸', 'Paparazzi', names(paparazzi.who), `${paparazzi.best} photos & videos`],
  ].filter(Boolean);

  const photos = posts.flatMap((p) => (p.media || []).filter((m) => m.type === 'image').map((m) => ({ ...m, score: reactCount(`p-${p.id}`), by: p.by })))
    .sort((a, b) => b.score - a.score).slice(0, 9);
  const champ = ranked[0];

  const playerCards = pids.map((p) => ({ p, s: standings.players[p] }))
    .sort((a, b) => b.s.points - a.s.points)
    .map(({ p, s }) => {
      const totals = roundTotals(config, scores, p).filter((r) => r.holes);
      const best = totals.filter((r) => r.holes === 18).sort((a, b) => a.gross - b.gross)[0];
      return `<div class="card recap-player" style="--team:${teamColor(s.team)}">
        <div class="rp-head">${avatar(p, config)}<b>${esc(playerName(p))}</b><span class="muted">${esc(config.teams[s.team].name)}</span>
          <span class="rp-pts">${fmtPts(s.points)} pts</span></div>
        <div class="rp-stats"><span>${s.w}-${s.l}-${s.h}</span><span>🐦 ${birdies[p]?.birdies || 0}</span>
          ${best ? `<span>Best ${best.gross} (${esc(best.day.split(' ')[0])})</span>` : ''}</div>
        <div class="rp-rounds">${totals.map((r) => `<span>${esc(r.day.split(' ')[0])} <b>${r.gross}</b>${r.holes < 18 ? `<small> thru ${r.holes}</small>` : ''}</span>`).join('')}</div>
      </div>`;
    }).join('');

  const days = rounds.filter((r) => !r.pending).map((r) => {
    const day = rankTeams(config, scores, [r.id]).ranked;
    return `<div class="kv"><span><b>${esc(r.day.split(' ')[0])}</b> ${esc(r.course)}</span>
      <span class="day-pts">${day.map((t) => `${teamDot(t.idx)}${fmtPts(t.points)}`).join(' ')}</span></div>`;
  }).join('');

  return `
    ${final ? '' : '<div class="card tbd"><div class="tbd-title">Preview</div><p>The recap fills in as the trip goes and is final after the last match.</p></div>'}
    <div class="recap-hero">
      <div class="rh-kicker">Buckle Up · ${esc(TRIP.dates)}</div>
      <div class="rh-title">Trip Recap</div>
      ${champ && final && !champ.unresolved ? `<div class="rh-champ">🏆 ${esc(champ.name)} · ${champ.players.map(playerName).join(' & ')}</div>` : ''}
      <button class="btn ghost small" data-action="share-recap">Share</button>
    </div>
    <h2>Final standings</h2>
    <div class="card teams">${ranked.map((t, i) => `
      <div class="team-row ${final && i === 0 && !t.unresolved ? 'winner' : ''}" style="--team:${teamColor(t.idx)}">
        <div class="rank">${final && i === 0 && !t.unresolved ? '🏆' : t.rank}</div>
        <div class="team-info"><div class="team-name">${esc(t.name)}</div>
          <div class="team-players">${t.players.map(playerName).join(' & ')}</div></div>
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
    <button class="link" data-action="close-picker">${ui.me ? 'Cancel' : 'Just watching'}</button>
  </div></div>`;
}

// ---------- shell ----------

const TABS = [
  ['board', '🏆', 'Leaderboard', renderBoard],
  ['scores', '✏️', 'Scores', renderScores],
  ['cards', '📋', 'Cards', renderCards],
  ['feed', '💬', 'Feed', renderFeed],
  ['trip', '🗺️', 'Trip', renderTrip],
  ['setup', '⚙️', 'Setup', renderSetup],
];
// Reached from the champion banner, the Trip tab or a #recap link.
const HIDDEN_TABS = [['recap', '', 'Recap', renderRecap]];

function isAdmin() {
  try { return localStorage.getItem(ADMIN_KEY) === '1'; } catch { return false; }
}

function render() {
  // Don't yank a video someone is watching; re-render when it stops.
  if ([...app.querySelectorAll('video')].some((v) => !v.paused && !v.ended)) {
    renderQueued = true;
    return;
  }
  renderQueued = false;
  view = resolveConfig(store.config, store.scores);
  const tabs = TABS.filter(([id]) => id !== 'setup' || isAdmin());
  const tab = [...tabs, ...HIDDEN_TABS].find((t) => t[0] === ui.tab) || tabs[0];
  // Keep the cursor in whatever box the person is typing in.
  const active = document.activeElement;
  const focusId = app.contains(active) ? active.id : '';
  const sel = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const sync = store.mode === 'firebase'
    ? (store.online ? '<span class="sync on">● Live</span>' : '<span class="sync off">● Offline — will sync</span>')
    : '<span class="sync local">● This device only</span>';
  const scrollY = window.scrollY;
  const keepScroll = app.dataset.tab === tab[0];
  app.dataset.tab = tab[0];
  app.innerHTML = `
    <header class="top">
      <div><h1>${esc(TRIP.title)}</h1><button class="sub" data-action="change-me">Buckle Up · ${ui.me ? `${esc(playerName(ui.me))} ▾` : 'Pick your name ▾'}</button></div>
      ${sync}
    </header>
    <main>${tab[3]()}</main>
    <nav class="tabs" style="--n:${tabs.length}">${tabs.map(([id, icon, label]) => `
      <button class="${id === tab[0] ? 'on' : ''}" data-action="tab" data-tab="${id}">
        <span>${icon}</span>${label}</button>`).join('')}</nav>
    ${ui.pickingMe || (!ui.me && !ui.watching) ? namePicker() : ''}`;
  if (keepScroll) window.scrollTo(0, scrollY);
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
      ui.hole = Number(el.dataset.hole);
      break;
    case 'step': {
      const cur = store.scores[round.id]?.[el.dataset.player]?.[ui.hole];
      const delta = Number(el.dataset.delta);
      // First tap on a blank score starts at par.
      const next = cur ? Math.min(15, Math.max(1, cur + delta)) : (parFor(store.config, round.id, ui.hole) || 4);
      store.setScore(round.id, el.dataset.player, ui.hole, next).catch(showError);
      return;
    }
    case 'clear':
      store.setScore(round.id, el.dataset.player, ui.hole, null).catch(showError);
      return;
    case 'set-me':
      ui.me = el.dataset.id;
      ui.pickingMe = false;
      ui.group = null;
      break;
    case 'change-me':
      ui.pickingMe = true;
      break;
    case 'close-picker':
      ui.pickingMe = false;
      if (!ui.me) ui.watching = true;
      break;
    case 'lock-admin':
      try { localStorage.removeItem(ADMIN_KEY); } catch {}
      ui.tab = 'board';
      toast('Setup hidden on this phone');
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
      const slot = { team: Number(el.dataset.team), slot: Number(el.dataset.slot) };
      if (!pickedSlot || (pickedSlot.team === slot.team && pickedSlot.slot === slot.slot)) {
        pickedSlot = pickedSlot ? null : slot;
        break;
      }
      const a = pickedSlot;
      pickedSlot = null;
      saveSetup((c) => {
        const pa = c.teams[a.team].players[a.slot];
        c.teams[a.team].players[a.slot] = c.teams[slot.team].players[slot.slot];
        c.teams[slot.team].players[slot.slot] = pa;
      });
      return;
    }
    case 'matchup': {
      const { round: ri, m } = el.dataset;
      saveSetup((c) => {
        c.rounds[ri].groups = MATCHUPS[m].map((teams, gi) => ({ teams, cross: !!c.rounds[ri].groups[gi]?.cross }));
      });
      return;
    }
    case 'seeded': {
      const { round: ri, on } = el.dataset;
      saveSetup((c) => { c.rounds[ri].seeded = on === '1'; });
      return;
    }
    case 'puttoff': {
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
  saveSetup((c) => {
    if (edit === 'team-name') c.teams[team].name = el.value.trim() || `Team ${Number(team) + 1}`;
    if (edit === 'round-enabled') c.rounds[round].enabled = el.checked;
    if (edit === 'round-course') c.rounds[round].course = el.value.trim() || c.rounds[round].course;
  });
});

function showError(err) {
  console.error(err);
  alert(`Couldn't save: ${err.message || err}`);
}

// #admin=<code> unlocks Setup on this phone; #recap opens the recap.
function readHash() {
  if (location.hash === `#admin=${ADMIN_CODE}`) {
    try { localStorage.setItem(ADMIN_KEY, '1'); } catch {}
    ui.tab = 'setup';
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast('Setup unlocked on this phone'), 300);
  } else if (location.hash === '#recap') {
    ui.tab = 'recap';
  }
}

(async () => {
  readHash();
  window.addEventListener('hashchange', () => { readHash(); render(); });
  store = await createStore(() => render());
  render();
})();
