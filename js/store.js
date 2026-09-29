// Storage for tournament config, hole scores and the Clubhouse feed.
// Uses Firebase (live sync across phones) when configured, otherwise falls
// back to localStorage on this device.
//
// scores[roundId][playerId][hole] = strokes
// scoreTimes[roundId][playerId][hole] = ms timestamp the score was entered
// posts = [{ id, by, text, media: [{ url, type }], roundId, hole, at }]
// social[itemId] = { r: { emoji: [playerId] }, c: [{ by, text, at }] }
//   (reactions and comments for posts and auto highlights alike)

import { FIREBASE_CONFIG, TRIP_ID } from './firebase-config.js';
import { DEFAULT_CONFIG } from './data.js';

const FIREBASE_VERSION = '10.12.2';
const LOCAL_KEY = `golftrip:${TRIP_ID}`;
export const MAX_VIDEO_MB = 200;

// Saved setup layered over the defaults. Saved rounds only carry what Setup
// can change (on/off, course name, Friday groups, singles swaps) and are
// merged over the defaults by id. Setups saved before the teams-of-4 format
// (no `v: 2`) are ignored. Pars always come from the scorecards in data.js.
const SAVED_ROUND_FIELDS = ['id', 'enabled', 'course', 'groups'];
function withDefaults(saved) {
  const config = structuredClone(DEFAULT_CONFIG);
  if (saved?.v !== DEFAULT_CONFIG.v) return config;
  config.teams = saved.teams || [];
  config.draft = {
    captains: saved.draft?.captains || [], picks: saved.draft?.picks || [], times: saved.draft?.times || [],
    at: saved.draft?.at || 0, started: !!saved.draft?.started, startedAt: saved.draft?.startedAt || 0,
  };
  config.tuePicks = { pairs: (saved.tuePicks?.pairs || []).map((x) => (typeof x === 'string' ? x.split('|') : x)) };
  config.tueDraft = {
    started: !!saved.tueDraft?.started, startedAt: saved.tueDraft?.startedAt || 0,
    moves: saved.tueDraft?.moves || [], times: saved.tueDraft?.times || [],
  };
  config.puttoffs = saved.puttoffs || {};
  for (const r of saved.rounds || []) {
    const round = config.rounds.find((d) => d.id === r.id);
    if (!round) continue;
    for (const f of SAVED_ROUND_FIELDS) if (r[f] != null) round[f] = r[f];
  }
  return config;
}

// Only the setup is saved; pars and formats are fixed. Arrays and full
// objects every time, so a reset overwrites (Firestore merges nested maps).
const setupFields = ({ teams = [], draft, tuePicks, tueDraft, rounds, puttoffs = {} }) => JSON.parse(JSON.stringify({
  v: DEFAULT_CONFIG.v,
  teams,
  draft: {
    captains: draft?.captains || [], picks: draft?.picks || [], times: draft?.times || [],
    at: draft?.at || 0, started: !!draft?.started, startedAt: draft?.startedAt || 0,
  },
  // Firestore can't hold arrays inside arrays, so each matchup is "a|b".
  tuePicks: { pairs: (tuePicks?.pairs || []).map((x) => (Array.isArray(x) ? x.join('|') : x)) },
  tueDraft: {
    started: !!tueDraft?.started, startedAt: tueDraft?.startedAt || 0,
    moves: tueDraft?.moves || [], times: tueDraft?.times || [],
  },
  rounds: rounds.map((r) => Object.fromEntries(SAVED_ROUND_FIELDS.map((f) => [f, r[f] ?? null]))),
  puttoffs,
}));

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Photos are resized to full-HD (1920px on the long side, 1080p quality)
// before upload, since phone originals are 3-8 MB; videos go up as recorded.
async function shrinkImage(file, maxSide = 1920) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
    return blob || file;
  } catch {
    return file;
  }
}

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
    canUpload: false,
    config: withDefaults(data.config),
    scores: data.scores || {},
    scoreTimes: data.scoreTimes || {},
    posts: data.posts || [],
    social: data.social || {},
    async setScore(roundId, playerId, hole, value) {
      const player = ((store.scores[roundId] ||= {})[playerId] ||= {});
      const times = ((store.scoreTimes[roundId] ||= {})[playerId] ||= {});
      if (value == null) {
        delete player[hole];
        delete times[hole];
      } else {
        player[hole] = value;
        times[hole] ||= Date.now();
      }
      persist();
    },
    async saveConfig(config) {
      store.config = withDefaults(setupFields(config));
      persist();
    },
    // Read-check-write on the latest setup; `fn` throws to cancel.
    async updateConfig(fn) {
      const config = structuredClone(store.config);
      fn(config);
      await store.saveConfig(config);
    },
    async addPost(post) {
      store.posts = [{ ...post, id: newId(), at: Date.now() }, ...store.posts];
      persist();
    },
    async deletePost(id) {
      store.posts = store.posts.filter((p) => p.id !== id);
      persist();
    },
    async toggleReaction(itemId, emoji, playerId) {
      const r = ((store.social[itemId] ||= {}).r ||= {});
      const list = (r[emoji] ||= []);
      r[emoji] = list.includes(playerId) ? list.filter((p) => p !== playerId) : [...list, playerId];
      persist();
    },
    async addComment(itemId, comment) {
      ((store.social[itemId] ||= {}).c ||= []).push({ ...comment, at: Date.now() });
      persist();
    },
    async uploadMedia() {
      throw new Error('Photo and video uploads need live sync');
    },
  };
  function persist() {
    try {
      const { config, scores, scoreTimes, posts, social } = store;
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ config, scores, scoreTimes, posts, social }));
    } catch {}
    onChange();
  }
  // Keep multiple tabs on the same device in step.
  window.addEventListener('storage', (e) => {
    if (e.key !== LOCAL_KEY) return;
    data = load();
    Object.assign(store, {
      config: withDefaults(data.config),
      scores: data.scores || {},
      scoreTimes: data.scoreTimes || {},
      posts: data.posts || [],
      social: data.social || {},
    });
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

  const trip = ['trips', TRIP_ID];
  const configRef = fs.doc(db, ...trip, 'meta', 'config');
  const scoresCol = fs.collection(db, ...trip, 'scores');
  const postsCol = fs.collection(db, ...trip, 'posts');
  const socialCol = fs.collection(db, ...trip, 'social');
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);

  // Storage loads on first upload, so the app still works if it's not set up.
  let storageApi;
  const storage = async () => {
    storageApi ||= import(`${base}/firebase-storage.js`).then((st) => ({ st, bucket: st.getStorage(app) }));
    return storageApi;
  };

  const store = {
    mode: 'firebase',
    canUpload: true,
    online: navigator.onLine,
    config: structuredClone(DEFAULT_CONFIG),
    scores: {},
    scoreTimes: {},
    posts: [],
    social: {},
    async setScore(roundId, playerId, hole, value) {
      // Optimistic local update so the UI responds instantly.
      const player = ((store.scores[roundId] ||= {})[playerId] ||= {});
      const hadScore = player[hole] != null;
      if (value == null) delete player[hole];
      else player[hole] = value;
      if (value != null && !hadScore) ((store.scoreTimes[roundId] ||= {})[playerId] ||= {})[hole] = Date.now();
      onChange();
      // One doc per player per round; merge writes only touch this hole, so
      // two phones entering scores at once never clobber each other. `t`
      // records when the hole was first scored, for the feed's highlights.
      const ref = fs.doc(scoresCol, `${roundId}_${playerId}`);
      const update = {
        round: roundId,
        player: playerId,
        h: { [hole]: value == null ? fs.deleteField() : value },
      };
      if (value == null) update.t = { [hole]: fs.deleteField() };
      else if (!hadScore) update.t = { [hole]: fs.serverTimestamp() };
      await fs.setDoc(ref, update, { merge: true });
    },
    async saveConfig(config) {
      store.config = withDefaults(setupFields(config));
      onChange();
      await fs.setDoc(configRef, setupFields(config), { merge: true });
    },
    // Read-check-write on the latest saved setup in a transaction, so two
    // phones acting at once (like draft picks) can't overwrite each other.
    // `fn` throws to cancel.
    async updateConfig(fn) {
      await fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(configRef);
        const config = withDefaults(snap.exists() ? snap.data() : null);
        fn(config);
        tx.set(configRef, setupFields(config), { merge: true });
      });
    },
    async addPost(post) {
      await fs.addDoc(postsCol, { ...post, at: fs.serverTimestamp() });
    },
    async deletePost(id) {
      await fs.deleteDoc(fs.doc(postsCol, id));
    },
    async toggleReaction(itemId, emoji, playerId) {
      const mine = store.social[itemId]?.r?.[emoji]?.includes(playerId);
      await fs.setDoc(fs.doc(socialCol, itemId), {
        r: { [emoji]: mine ? fs.arrayRemove(playerId) : fs.arrayUnion(playerId) },
      }, { merge: true });
    },
    async addComment(itemId, comment) {
      await fs.setDoc(fs.doc(socialCol, itemId), {
        c: fs.arrayUnion({ ...comment, at: Date.now() }),
      }, { merge: true });
    },
    // Uploads one photo or video; resolves { url, type }.
    async uploadMedia(file, onProgress) {
      const isVideo = file.type.startsWith('video/');
      if (isVideo && file.size > MAX_VIDEO_MB * 1024 * 1024) {
        throw new Error(`Videos can be up to ${MAX_VIDEO_MB} MB. Try a shorter clip.`);
      }
      const body = isVideo ? file : await shrinkImage(file);
      const contentType = isVideo ? (file.type || 'video/mp4') : (body.type || 'image/jpeg');
      const ext = isVideo ? (file.name.split('.').pop() || 'mp4') : 'jpg';
      const { st, bucket } = await storage();
      const ref = st.ref(bucket, `trips/${TRIP_ID}/media/${newId()}.${ext}`);
      const task = st.uploadBytesResumable(ref, body, { contentType });
      await new Promise((resolve, reject) => {
        task.on('state_changed',
          (snap) => onProgress?.(snap.bytesTransferred / snap.totalBytes),
          reject, resolve);
      });
      return { url: await st.getDownloadURL(ref), type: isVideo ? 'video' : 'image' };
    },
  };

  await new Promise((resolve) => {
    let pending = 4;
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
    const postsReady = once();
    const socialReady = once();

    fs.onSnapshot(configRef, (snap) => {
      store.config = withDefaults(snap.exists() ? snap.data() : null);
      configReady();
    }, (err) => { console.error(err); configReady(); });

    fs.onSnapshot(scoresCol, (snap) => {
      const scores = {};
      const times = {};
      snap.forEach((d) => {
        const { round, player, h, t } = d.data({ serverTimestamps: 'estimate' });
        if (!round || !player) return;
        const holes = {};
        for (const [k, v] of Object.entries(h || {})) holes[Number(k)] = v;
        (scores[round] ||= {})[player] = holes;
        const ht = {};
        for (const [k, v] of Object.entries(t || {})) ht[Number(k)] = ms(v);
        (times[round] ||= {})[player] = ht;
      });
      store.scores = scores;
      store.scoreTimes = times;
      scoresReady();
    }, (err) => { console.error(err); scoresReady(); });

    fs.onSnapshot(postsCol, (snap) => {
      store.posts = snap.docs.map((d) => {
        const p = d.data({ serverTimestamps: 'estimate' });
        return { ...p, id: d.id, at: ms(p.at) || Date.now() };
      }).sort((a, b) => b.at - a.at);
      postsReady();
    }, (err) => { console.error(err); postsReady(); });

    fs.onSnapshot(socialCol, (snap) => {
      const social = {};
      snap.forEach((d) => { social[d.id] = d.data(); });
      store.social = social;
      socialReady();
    }, (err) => { console.error(err); socialReady(); });
  });

  const setOnline = () => { store.online = navigator.onLine; onChange(); };
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);

  return store;
}
