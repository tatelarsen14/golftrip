import { createStore } from './store.js';
import { PLAYERS, TEAM_COLORS, TRIP, ITINERARY, FLIGHTS, ESTIMATE } from './data.js';
import { buildMatches, computeMatch, computeStandings, FRONT_NINE, BACK_NINE } from './scoring.js';

const UI_KEY = 'golftrip:ui';
const app = document.getElementById('app');

let store;
let draftConfig = null; // unsaved Setup edits
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
  const rounds = enabledRounds(store.config);
  let round = rounds.find((r) => r.id === ui.roundId);
  if (!round) {
    ui.roundId = defaultRoundId(store.config);
    round = rounds.find((r) => r.id === ui.roundId);
  }
  return round;
}

function groupLabel(config, group) {
  return group.teams.map((t) => esc(config.teams[t]?.name)).join(' vs ');
}

// ---------- shared components ----------

function roundChips(activeId) {
  return `<div class="chips" role="tablist">${enabledRounds(store.config).map((r) => `
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
  const { config, scores } = store;
  const standings = computeStandings(config, scores);
  const round = currentRound();
  const teams = [...standings.teams].sort((a, b) => b.points - a.points || b.projected - a.projected);

  const teamRows = teams.map((t, i) => {
    const rank = i > 0 && teams[i - 1].points === t.points ? '' : i + 1;
    const live = t.projected !== t.points
      ? `<div class="live-pts">${fmtPts(t.projected)} if all live matches ended now</div>` : '';
    return `<div class="team-row" style="--team:${teamColor(t.idx)}">
      <div class="rank">${rank}</div>
      <div class="team-info">
        <div class="team-name">${esc(t.name)}</div>
        <div class="team-players">${t.players.map(playerName).join(' & ')} · ${t.w}-${t.l}-${t.h}</div>
        ${live}
      </div>
      <div class="big-pts">${fmtPts(t.points)}</div>
    </div>`;
  }).join('');

  const roundMatches = standings.matches.filter((m) => m.match.roundId === round?.id);
  const players = Object.values(standings.players)
    .sort((a, b) => b.points - a.points || b.w - a.w || playerName(a.id).localeCompare(playerName(b.id)));

  return `
    <section>
      <h2>Team Standings</h2>
      <div class="card teams">${teamRows}</div>
      <p class="note">Win = 1 · Tie = ½ · Loss = 0 &nbsp;·&nbsp; 3 pts per team up for grabs each day</p>
    </section>
    <section>
      <h2>Matches</h2>
      ${roundChips(round?.id)}
      ${round ? round.groups.map((g, gi) => `
        <h3>Group ${gi + 1} · ${groupLabel(config, g)}</h3>
        ${roundMatches.filter((m) => m.match.group === gi).map((m) => matchCard(m.match, m.result)).join('')}
      `).join('') : '<p class="empty">No rounds enabled.</p>'}
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
  const { config, scores } = store;
  const round = currentRound();
  if (!round) return '<p class="empty">No rounds enabled. Turn one on in Setup.</p>';

  if (ui.group == null || !round.groups[ui.group]) {
    const mine = ui.me ? round.groups.findIndex((g) => g.teams.includes(teamOf(config, ui.me))) : -1;
    ui.group = Math.max(0, mine);
  }
  const group = round.groups[ui.group];
  const hole = ui.hole;
  const roundScores = scores[round.id] || {};
  const players = group.teams.flatMap((t) => config.teams[t].players.map((p) => ({ id: p, team: t })));
  const isFront = hole <= 9;

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
        <output class="${v ? '' : 'blank'}">${v || '–'}</output>
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
        Group ${gi + 1}<small>${groupLabel(config, g)}</small>
      </button>`).join('')}</div>
    <div class="holes">${holeBtns}</div>
    <div class="card entry">
      <div class="entry-head">
        <div><div class="hole-num">Hole ${hole}</div>
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

function scorecard(match, res, roundScores) {
  const holes = match.holes;
  const cell = (v) => (v ? v : '');
  const playerRows = match.sides.flatMap((side) => side.players.map((p) => {
    const vals = holes.map((h) => roundScores?.[p]?.[h]);
    const tot = vals.filter(Boolean).reduce((a, b) => a + b, 0);
    return `<tr><th>${teamDot(side.team)}${esc(playerName(p))}</th>
      ${vals.map((v, i) => {
        const h = res.holes[i];
        const counted = match.type === 'bestball' && v && v === (side === match.sides[0] ? h.a : h.b);
        return `<td class="${counted ? 'counted' : ''}">${cell(v)}</td>`;
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

function renderCards() {
  const { config, scores } = store;
  const round = currentRound();
  if (!round) return '<p class="empty">No rounds enabled.</p>';
  const roundScores = scores[round.id] || {};
  const matches = buildMatches(config).filter((m) => m.roundId === round.id);

  // 18-hole gross totals for bragging rights.
  const gross = config.teams.flatMap((t) => t.players).map((p) => {
    const vals = Object.values(roundScores[p] || {});
    return { p, total: vals.reduce((a, b) => a + b, 0), holes: vals.length };
  }).filter((g) => g.holes > 0).sort((a, b) => a.total - b.total);

  return `
    ${roundChips(round.id)}
    ${round.groups.map((g, gi) => `
      <h3>Group ${gi + 1} · ${groupLabel(config, g)}</h3>
      ${matches.filter((m) => m.group === gi).map((m) => {
        const res = computeMatch(m, roundScores);
        return `<div class="card sc-card">${matchCard(m, res, { compact: true })}${scorecard(m, res, roundScores)}</div>`;
      }).join('')}`).join('')}
    <h3>Gross scores · ${esc(round.course)}</h3>
    <div class="card">
      ${gross.length ? `<table class="table">${gross.map((g) => `
        <tr><td>${teamDot(teamOf(config, g.p))} ${esc(playerName(g.p))}</td>
        <td class="muted">${g.holes === 18 ? '18 holes' : `thru ${g.holes}`}</td>
        <td class="num"><b>${g.total}</b></td></tr>`).join('')}</table>`
        : '<p class="empty">No scores yet.</p>'}
    </div>
    <p class="note">Highlighted scores are the ones counting for best ball. The match row shows how many holes up the leading side is (in their team color).</p>`;
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

function validate(config) {
  const errors = [];
  const all = config.teams.flatMap((t) => t.players);
  for (const p of PLAYERS) {
    const n = all.filter((x) => x === p.id).length;
    if (n !== 1) errors.push(`${p.name} is on ${n} teams`);
  }
  for (const r of config.rounds) {
    if (!r.enabled) continue;
    const used = r.groups.flatMap((g) => g.teams);
    if (new Set(used).size !== used.length) errors.push(`${r.day}: a team is in both groups`);
  }
  return errors;
}

function renderSetup() {
  const config = draftConfig || store.config;
  const dirty = !!draftConfig;
  const errors = validate(config);
  const teamSelect = (value, attrs) => `<select ${attrs}>${config.teams.map((t, i) => `
    <option value="${i}" ${i === value ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;

  return `
    <h2>Who are you?</h2>
    <div class="card">
      <select data-action="me">
        <option value="">Pick your name…</option>
        ${PLAYERS.map((p) => `<option value="${p.id}" ${ui.me === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <p class="note">Used to open your group first on the Scores tab. Saved on this phone only.</p>
    </div>

    <h2>Sync</h2>
    <div class="card">
      ${store.mode === 'firebase'
        ? `<p>✅ <b>Live sync is on.</b> Scores appear on everyone's phone instantly and are saved offline if you lose signal.</p>`
        : `<p>⚠️ <b>Local mode.</b> Scores are only saved on this device. Add a Firebase config in <code>js/firebase-config.js</code> so the whole crew shares one scoreboard (see README).</p>`}
    </div>

    <h2>Teams</h2>
    ${config.teams.map((t, ti) => `
      <div class="card setup-team" style="--team:${teamColor(ti)}">
        <input type="text" value="${esc(t.name)}" data-edit="team-name" data-team="${ti}" aria-label="Team name">
        <div class="two">${t.players.map((pid, si) => `
          <select data-edit="team-player" data-team="${ti}" data-slot="${si}">
            ${PLAYERS.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>`).join('')}</div>
      </div>`).join('')}

    <h2>Daily pairings</h2>
    <p class="note">Each group plays best ball on the front 9, then two singles matches on the back 9. "Swap singles" changes who plays who within the group.</p>
    ${config.rounds.map((r, ri) => `
      <div class="card setup-round ${r.enabled ? '' : 'off'}">
        <label class="toggle"><input type="checkbox" data-edit="round-enabled" data-round="${ri}" ${r.enabled ? 'checked' : ''}>
          <b>${esc(r.day)}</b></label>
        <input type="text" value="${esc(r.course)}" data-edit="round-course" data-round="${ri}" aria-label="Course">
        ${r.groups.map((g, gi) => {
          const [a, b] = g.teams.map((t) => config.teams[t]);
          const pairs = g.cross ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
          return `<div class="setup-group">
            <div class="vs">Group ${gi + 1}:
              ${teamSelect(g.teams[0], `data-edit="group-team" data-round="${ri}" data-group="${gi}" data-side="0"`)}
              vs
              ${teamSelect(g.teams[1], `data-edit="group-team" data-round="${ri}" data-group="${gi}" data-side="1"`)}
            </div>
            <div class="singles-line">Singles: ${pairs.map(([pa, pb]) => `${esc(playerName(a?.players[pa]))} v ${esc(playerName(b?.players[pb]))}`).join(' · ')}
              <button class="link" data-action="cross" data-round="${ri}" data-group="${gi}">Swap singles</button></div>
          </div>`;
        }).join('')}
      </div>`).join('')}

    ${dirty ? '<div class="save-spacer"></div>' : ''}
    <div class="save-bar ${dirty ? 'show' : ''}">
      ${errors.length ? `<div class="errors">${errors.map(esc).join('<br>')}</div>` : ''}
      <div class="nav-row">
        <button class="btn ghost" data-action="discard">Discard</button>
        <button class="btn" data-action="save" ${errors.length ? 'disabled' : ''}>Save for everyone</button>
      </div>
    </div>`;
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
  const tab = TABS.find((t) => t[0] === ui.tab) || TABS[0];
  const sync = store.mode === 'firebase'
    ? (store.online ? '<span class="sync on">● Live</span>' : '<span class="sync off">● Offline — will sync</span>')
    : '<span class="sync local">● This device only</span>';
  const scrollY = window.scrollY;
  const keepScroll = app.dataset.tab === tab[0];
  app.dataset.tab = tab[0];
  app.innerHTML = `
    <header class="top">
      <div><h1>${esc(TRIP.title)}</h1><div class="sub">Buckle Up Cup · Match Play</div></div>
      ${sync}
    </header>
    <main>${tab[3]()}</main>
    <nav class="tabs">${TABS.map(([id, icon, label]) => `
      <button class="${id === tab[0] ? 'on' : ''}" data-action="tab" data-tab="${id}">
        <span>${icon}</span>${label}</button>`).join('')}</nav>`;
  if (keepScroll) window.scrollTo(0, scrollY);
  saveUI();
}

function editDraft(fn) {
  draftConfig ||= structuredClone(store.config);
  fn(draftConfig);
  render();
}

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action } = el.dataset;
  const round = currentRound();

  switch (action) {
    case 'tab':
      ui.tab = el.dataset.tab;
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
      const next = cur ? Math.min(15, Math.max(1, cur + delta)) : 4;
      store.setScore(round.id, el.dataset.player, ui.hole, next).catch(showError);
      return;
    }
    case 'clear':
      store.setScore(round.id, el.dataset.player, ui.hole, null).catch(showError);
      return;
    case 'cross': {
      const { round: ri, group: gi } = el.dataset;
      editDraft((c) => { c.rounds[ri].groups[gi].cross = !c.rounds[ri].groups[gi].cross; });
      return;
    }
    case 'discard':
      draftConfig = null;
      break;
    case 'save':
      try {
        await store.saveConfig(draftConfig);
        draftConfig = null;
      } catch (err) {
        showError(err);
      }
      break;
  }
  render();
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'me') {
    ui.me = el.value || null;
    ui.group = null;
    render();
    return;
  }
  const { edit, team, slot, round, group, side } = el.dataset;
  if (!edit) return;
  editDraft((c) => {
    if (edit === 'team-name') c.teams[team].name = el.value.trim() || `Team ${Number(team) + 1}`;
    if (edit === 'team-player') c.teams[team].players[slot] = el.value;
    if (edit === 'round-enabled') c.rounds[round].enabled = el.checked;
    if (edit === 'round-course') c.rounds[round].course = el.value.trim();
    if (edit === 'group-team') c.rounds[round].groups[group].teams[side] = Number(el.value);
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
