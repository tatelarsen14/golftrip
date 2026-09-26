// Storage for tournament config and hole scores.
// Uses Firestore (live sync across phones) when configured, otherwise
// falls back to localStorage on this device.
//
// Scores shape: scores[roundId][playerId][hole] = strokes

import { FIREBASE_CONFIG, TRIP_ID } from './firebase-config.js';
import { DEFAULT_CONFIG } from './data.js';

const FIREBASE_VERSION = '10.12.2';
const LOCAL_KEY = `golftrip:${TRIP_ID}`;

// Saved setup layered over the defaults. Each saved round is merged over its
// default so newer fields (like Tuesday's seeding) reach configs saved
// before they existed. Pars always come from the scorecards in data.js.
function withDefaults(saved) {
  const config = structuredClone(DEFAULT_CONFIG);
  if (saved?.teams) config.teams = saved.teams;
  config.puttoffs = saved?.puttoffs || {};
  if (saved?.rounds) {
    config.rounds = saved.rounds
      .filter((r) => r.id !== 'fri') // Friday was dropped after launch
      .map((r) => ({ ...DEFAULT_CONFIG.rounds.find((d) => d.id === r.id), ...r }));
  }
  return config;
}

// Only teams, pairings and putt-off results are saved; pars are fixed.
const setupFields = ({ teams, rounds, puttoffs = {} }) => JSON.parse(JSON.stringify({ teams, rounds, puttoffs }));

export async function createStore(onChange) {
  if (FIREBASE_CONFIG) {
    try {
      return await createFirebaseStore(onChange);
    } catch (err) {
      console.error('Firebase unavailable, using local storage', err);
    }
  }
  return createLocalStore(onChange);
}

function createLocalStore(onChange) {
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
    } catch {
      return {};
    }
  };
  let data = load();
  const store = {
    mode: 'local',
    config: withDefaults(data.config),
    scores: data.scores || {},
    async setScore(roundId, playerId, hole, value) {
      const player = ((store.scores[roundId] ||= {})[playerId] ||= {});
      if (value == null) delete player[hole];
      else player[hole] = value;
      persist();
    },
    async saveConfig(config) {
      store.config = { ...store.config, ...setupFields(config) };
      persist();
    },
  };
  function persist() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ config: store.config, scores: store.scores }));
    } catch {}
    onChange();
  }
  // Keep multiple tabs on the same device in step.
  window.addEventListener('storage', (e) => {
    if (e.key !== LOCAL_KEY) return;
    data = load();
    store.config = withDefaults(data.config);
    store.scores = data.scores || {};
    onChange();
  });
  return store;
}

async function createFirebaseStore(onChange) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(FIREBASE_CONFIG);
  // Offline cache so scores can be entered with spotty cell service on the
  // course; they upload when the phone reconnects.
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });

  const configRef = fs.doc(db, 'trips', TRIP_ID, 'meta', 'config');
  const scoresCol = fs.collection(db, 'trips', TRIP_ID, 'scores');

  const store = {
    mode: 'firebase',
    online: navigator.onLine,
    config: structuredClone(DEFAULT_CONFIG),
    scores: {},
    async setScore(roundId, playerId, hole, value) {
      // Optimistic local update so the UI responds instantly.
      const player = ((store.scores[roundId] ||= {})[playerId] ||= {});
      if (value == null) delete player[hole];
      else player[hole] = value;
      onChange();
      // One doc per player per round; merge writes only touch this hole, so
      // two phones entering scores at once never clobber each other.
      const ref = fs.doc(scoresCol, `${roundId}_${playerId}`);
      await fs.setDoc(ref, {
        round: roundId,
        player: playerId,
        h: { [hole]: value == null ? fs.deleteField() : value },
      }, { merge: true });
    },
    async saveConfig(config) {
      store.config = { ...store.config, ...setupFields(config) };
      onChange();
      await fs.setDoc(configRef, setupFields(config), { merge: true });
    },
  };

  await new Promise((resolve) => {
    let pending = 2;
    // Each listener reports ready once; later snapshots re-render.
    const once = () => {
      let done = false;
      return () => {
        if (done) return onChange();
        done = true;
        if (--pending === 0) resolve();
      };
    };
    const configReady = once();
    const scoresReady = once();

    fs.onSnapshot(configRef, (snap) => {
      store.config = withDefaults(snap.exists() ? snap.data() : null);
      configReady();
    }, (err) => { console.error(err); configReady(); });

    fs.onSnapshot(scoresCol, (snap) => {
      const scores = {};
      snap.forEach((d) => {
        const { round, player, h } = d.data();
        if (!round || !player) return;
        const holes = {};
        for (const [k, v] of Object.entries(h || {})) holes[Number(k)] = v;
        (scores[round] ||= {})[player] = holes;
      });
      store.scores = scores;
      scoresReady();
    }, (err) => { console.error(err); scoresReady(); });
  });

  const setOnline = () => { store.online = navigator.onLine; onChange(); };
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);

  return store;
}
