import { createStore } from './store.js';
import { PLAYERS, TEAM_COLORS, TRIP, ITINERARY, FLIGHTS, ESTIMATE, MATCHUPS } from './data.js';
import {
  buildMatches, computeMatch, computeStandings, birdieCounts, parFor, scoreMark, rankTeams, resolveConfig,
  TIEBREAKERS, FRONT_NINE, BACK_NINE,
} from './scoring.js';

const UI_KEY = 'golftrip:ui';
const app = document.getElementById('app');

let store;
let view; // store.config with seeded matchups filled in (or marked TBD)
let pickedSlot = null; // Setup: first player tapped in a swap
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
  const row = (side, si) => {
    const lead = res.leader === si;
    const pts = res.points ? `<span class="pts">${fmtPts(res.points[si])} pt</span>` : '';
    let tag = '';
    if (lead) tag = `<span class="tag ${res.done ? 'win' : 'up'}">${esc(res.status)}</span>`;
    return `<div class="side ${lead ? 'lead' : ''} ${res.done && res.leader !== null && !lead ? 'lost' : ''}">
      ${teamDot(side.team)}
      <span class="who">${esc(sideLabel(side))}</span>
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

// ---------- Leaderboard ----------

function renderBoard() {
  const config = view;
  const { scores } = store;
  const standings = computeStandings(config, scores);
  const round = currentRound();
  const rounds = enabledRounds(config);
  const ranked = rankTeams(config, scores, rounds.map((r) => r.id));
  const allFinal = standings.matches.length > 0 && !rounds.some((r) => r.pending)
    && standings.matches.every((m) => m.result.done);

  const teamRows = ranked.map((r, i) => {
    const t = standings.teams[r.idx];
    const rank = i > 0 && ranked[i - 1].rank === r.rank ? '' : r.rank;
    const live = t.projected !== t.points
      ? `<div class="live-pts">${fmtPts(t.projected)} if all live matches ended now</div>` : '';
    const tb = r.unresolved ? '<div class="tiebreak">Still tied after every tiebreaker: flip a coin</div>'
      : r.tiebreak ? `<div class="tiebreak">Tiebreaker: ${esc(r.tiebreak)}</div>` : '';
    return `<div class="team-row" style="--team:${teamColor(t.idx)}">
      <div class="rank">${rank}</div>
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
  const champBanner = champ && !champ.unresolved ? `<div class="champ" style="--team:${teamColor(champ.idx)}">
      <div class="champ-cup">🏆</div>
      <div><div class="champ-name">${esc(champ.name)} are the champions</div>
      <div class="champ-sub">${champ.players.map(playerName).join(' & ')} · ${fmtPts(champ.points)} pts${champ.tiebreak ? ` · won on ${esc(champ.tiebreak.toLowerCase())}` : ''}</div></div>
    </div>` : '';

  return `
    ${champBanner}
    <section>
      <h2>Team Standings</h2>
      <div class="card teams">${teamRows}</div>
      <p class="note">Win = 1 · Tie = ½ · Loss = 0 &nbsp;·&nbsp; 3 pts per team up for grabs each day</p>
      <details class="note tb-rules"><summary>Tiebreakers</summary>
        <p>If teams are level on points (for Tuesday's seeding after Monday, and for the final standings):</p>
        <ol>${TIEBREAKERS.map((tb) => `<li>${tb.label}</li>`).join('')}<li>Still tied: flip a coin</li></ol>
        <p><b>Head-to-head</b> counts points only from matches between the tied teams. <b>Holes-up margin</b> adds up how much each match was won or lost by (Won 3&2 = +3, lost 1 UP = −1). <b>Total strokes</b> is both players' scores added up over the rounds that count.</p>
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

  const rows = players.map((p) => {
    const v = roundScores[p.id]?.[hole];
    const total = Object.values(roundScores[p.id] || {}).reduce((a, b) => a + b, 0);
    return `<div class="entry-row">
      ${teamDot(p.team)}
      <div class="entry-name">${esc(playerName(p.id))}<small>${total ? `${total} total` : ''}</small></div>
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
  return `
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
  const me = ui.me ? playerName(ui.me) : null;

  const matchupLabel = ([a, b]) => `${esc(config.teams[a].name)} v ${esc(config.teams[b].name)}`;
  const currentMatchup = (r) => MATCHUPS.findIndex(([g1]) => r.groups.some((g) => (
    g.teams.includes(g1[0]) && g.teams.includes(g1[1]))));

  return `
    <h2>Who are you?</h2>
    <div class="card">
      <div class="name-grid">${PLAYERS.map((p) => `
        <button class="${ui.me === p.id ? 'on' : ''}" data-action="me" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <p class="note">${me ? `You're <b>${esc(me)}</b>. The Scores tab opens to your group.` : 'Tap your name so the Scores tab opens to your group.'} Saved on this phone.</p>
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

// ---------- shell ----------

const TABS = [
  ['board', '🏆', 'Leaderboard', renderBoard],
  ['scores', '✏️', 'Scores', renderScores],
  ['cards', '📋', 'Cards', renderCards],
  ['trip', '🗺️', 'Trip', renderTrip],
  ['setup', '⚙️', 'Setup', renderSetup],
];

function render() {
  view = resolveConfig(store.config, store.scores);
  const tab = TABS.find((t) => t[0] === ui.tab) || TABS[0];
  const sync = store.mode === 'firebase'
    ? (store.online ? '<span class="sync on">● Live</span>' : '<span class="sync off">● Offline — will sync</span>')
    : '<span class="sync local">● This device only</span>';
  const scrollY = window.scrollY;
  const keepScroll = app.dataset.tab === tab[0];
  app.dataset.tab = tab[0];
  app.innerHTML = `
    <header class="top">
      <div><h1>${esc(TRIP.title)}</h1><div class="sub">Buckle Up${ui.me ? ` · ${esc(playerName(ui.me))}` : ' · Match Play'}</div></div>
      ${sync}
    </header>
    <main>${tab[3]()}</main>
    <nav class="tabs">${TABS.map(([id, icon, label]) => `
      <button class="${id === tab[0] ? 'on' : ''}" data-action="tab" data-tab="${id}">
        <span>${icon}</span>${label}</button>`).join('')}</nav>`;
  if (keepScroll) window.scrollTo(0, scrollY);
  saveUI();
}

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
    case 'me':
      ui.me = ui.me === el.dataset.id ? null : el.dataset.id;
      ui.group = null;
      break;
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
    case 'cross': {
      const { round: ri, group: gi } = el.dataset;
      saveSetup((c) => { c.rounds[ri].groups[gi].cross = !c.rounds[ri].groups[gi].cross; });
      return;
    }
  }
  render();
});

app.addEventListener('change', (e) => {
  const el = e.target;
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

(async () => {
  store = await createStore(() => render());
  render();
})();
