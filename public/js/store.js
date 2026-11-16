/* Storage backends.
   Cloud (Firebase): users/{uid}                 main doc (habits, logs, settings, goals, custom foods)
                     users/{uid}/days/{date}     daily health check-in
                     users/{uid}/meals/{id}      meal entries (no photo)
                     users/{uid}/photos/{mealId} compressed meal photo (data URL)
   Local: localStorage + IndexedDB for photos (used for the preview / ?local).            */
import { S, setMain, emit } from './state.js';
import { dayKey, addDays } from './util.js';

const FB_VERSION = '10.12.2';

/* ================= Local ================= */
const LK = { main: 'bloom-v2-main', days: 'bloom-v2-days', meals: 'bloom-v2-meals', v1: 'bloom-wellness-v1' };
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('save failed', e); } };

function idb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('bloom-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
const memPhotos = {};
async function idbOp(mode, fn) {
  const db = await idb();
  if (!db) return fn(null);
  return new Promise((res) => {
    const tx = db.transaction('p', mode);
    const req = fn(tx.objectStore('p'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => res(undefined);
  });
}

export function localStore() {
  const saveMain = () => write(LK.main, S.main);
  return {
    mode: 'local',
    start() {
      let main = read(LK.main);
      if (!main) main = read(LK.v1); // migrate from v1
      setMain(main);
      S.days = read(LK.days) || {};
      S.meals = read(LK.meals) || {};
      S.user = { local: true, displayName: 'Local' };
      S.mainReady = true;
      emit('user');
      emit('all');
    },
    saveMain: () => saveMain(),
    setLog: () => saveMain(),
    deleteLogs: () => saveMain(),
    saveDay: (key, partial) => { S.days[key] = { ...(S.days[key] || {}), ...partial }; write(LK.days, S.days); },
    saveMeal: (m) => { S.meals[m.id] = m; write(LK.meals, S.meals); },
    deleteMeal: (id) => { delete S.meals[id]; write(LK.meals, S.meals); idbOp('readwrite', (st) => st?.delete(id)); delete memPhotos[id]; },
    savePhoto: (id, data) => { memPhotos[id] = data; return idbOp('readwrite', (st) => st?.put(data, id)); },
    getPhoto: async (id) => memPhotos[id] ?? (await idbOp('readonly', (st) => st?.get(id))) ?? null,
    deletePhoto: (id) => { delete memPhotos[id]; return idbOp('readwrite', (st) => st?.delete(id)); },
    async importAll(data) {
      setMain(data.main); S.days = data.days || {}; S.meals = data.meals || {};
      write(LK.main, S.main); write(LK.days, S.days); write(LK.meals, S.meals);
      emit('all');
    },
    async resetAll() {
      ['main', 'days', 'meals', 'v1'].forEach((k) => { try { localStorage.removeItem(LK[k]); } catch {} });
      setMain(null); S.days = {}; S.meals = {}; emit('all');
    },
  };
}

/* ================= Firebase ================= */
export async function firebaseStore(config) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appMod, A, F] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
  ]);
  const app = appMod.initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  // Local testing against the Firebase emulators: http://localhost:5050/?emu
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('emu')) {
    A.connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    F.connectFirestoreEmulator(db, location.hostname, 8080);
  }
  try { F.enableIndexedDbPersistence?.(db).catch(() => {}); } catch {}

  let uid = null, unsubs = [];
  const userDoc = () => F.doc(db, 'users', uid);
  const sub = (name) => F.collection(db, 'users', uid, name);
  const photoCache = {};
  const fail = (err) => { console.error(err); emit('error:' + (err?.message || 'Could not reach the cloud')); };

  function listen() {
    unsubs.forEach((u) => u()); unsubs = [];
    if (!uid) { startSocial(); return; }
    unsubs.push(F.onSnapshot(userDoc(), (snap) => {
      if (!snap.exists()) {
        F.setDoc(userDoc(), { createdAt: F.serverTimestamp(), email: auth.currentUser?.email || null }, { merge: true }).catch(fail);
        setMain(null);
      } else setMain(snap.data());
      S.mainReady = true;
      emit('all');
    }, fail));
    unsubs.push(F.onSnapshot(sub('days'), (qs) => {
      const days = {};
      qs.forEach((d) => { days[d.id] = d.data(); });
      S.days = days; emit('all');
    }, fail));
    const cutoff = dayKey(addDays(new Date(), -400));
    unsubs.push(F.onSnapshot(F.query(sub('meals'), F.where('date', '>=', cutoff)), (qs) => {
      const meals = {};
      qs.forEach((d) => { meals[d.id] = { ...d.data(), id: d.id }; });
      S.meals = meals; emit('all');
    }, fail));
    startSocial();
  }

  /* ---------- Friends (profiles, codes, requests, inbox) ----------
     profiles/{uid}                 progress snapshot friends can read
     profiles/{uid}/friends/{fid}   who can read it
     profiles/{uid}/inbox/{id}      cheers / "request accepted" from friends
     codes/{CODE}                   friend code -> uid
     requests/{from}_{to}           pending friend requests
     profiles/{uid}/posts/{id}      feed posts (workouts, milestones) with kudos      */
  let socialFn = null;
  const EMPTY = () => ({ incoming: [], outgoing: [], friends: {}, friendIds: [], inbox: [], code: null, ready: false, posts: {}, myPosts: [], myPostsReady: false });
  const soc = EMPTY();
  const pushSocial = () => socialFn?.({ ...soc });
  const ms = (ts) => ts?.toMillis?.() ?? Date.now();
  const profDoc = (id) => F.doc(db, 'profiles', id);
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function ensureCode() {
    const me = uid;
    try {
      const snap = await F.getDoc(profDoc(me));
      if (snap.exists() && snap.data().code) return snap.data().code;
      for (let i = 0; i < 6; i++) {
        const code = newCode();
        try {
          await F.setDoc(F.doc(db, 'codes', code), { uid: me });
          await F.setDoc(profDoc(me), { code }, { merge: true });
          return code;
        } catch { /* taken: try another */ }
      }
    } catch (e) { console.warn('friend code', e); }
    return null;
  }

  function startSocial() {
    Object.assign(soc, EMPTY());
    pushSocial();
    if (!uid) return;
    const me = uid;
    ensureCode().then((c) => { if (uid === me) { soc.code = c; pushSocial(); } });
    const reqs = F.collection(db, 'requests');
    const toReq = (d) => ({ id: d.id, ...d.data(), at: ms(d.data().at) });
    unsubs.push(F.onSnapshot(F.query(reqs, F.where('to', '==', me)), (qs) => { soc.incoming = qs.docs.map(toReq); soc.ready = true; pushSocial(); }, fail));
    unsubs.push(F.onSnapshot(F.query(reqs, F.where('from', '==', me)), (qs) => { soc.outgoing = qs.docs.map(toReq); pushSocial(); }, fail));
    unsubs.push(F.onSnapshot(F.collection(db, 'profiles', me, 'inbox'), (qs) => {
      soc.inbox = qs.docs.map((d) => ({ id: d.id, ...d.data(), at: ms(d.data().at) })).sort((a, b) => b.at - a.at);
      pushSocial();
    }, fail));
    const postsQ = (id, n) => F.query(F.collection(db, 'profiles', id, 'posts'), F.orderBy('at', 'desc'), F.limit(n));
    const toPosts = (id, qs) => qs.docs.map((d) => ({ ...d.data(), id: d.id, uid: id }));
    unsubs.push(F.onSnapshot(postsQ(me, 60), (qs) => { soc.myPosts = toPosts(me, qs); soc.myPostsReady = true; pushSocial(); }, fail));
    const friendSubs = {};
    unsubs.push(F.onSnapshot(F.collection(db, 'profiles', me, 'friends'), (qs) => {
      const ids = qs.docs.map((d) => d.id);
      soc.friendIds = ids;
      Object.keys(friendSubs).forEach((id) => { if (!ids.includes(id)) { friendSubs[id](); delete friendSubs[id]; delete soc.friends[id]; delete soc.posts[id]; } });
      // Right after accepting, the friendship may not have reached the server yet, so a refused read is retried.
      const watch = (id, attempt = 0) => {
        let failed = false, timer = null;
        const offs = [];
        const stop = () => { offs.forEach((u) => u()); clearTimeout(timer); };
        const onErr = () => {
          if (failed) return;
          failed = true;
          offs.forEach((u) => u());
          if (attempt < 5) {
            timer = setTimeout(() => { if (soc.friendIds.includes(id) && uid === me) watch(id, attempt + 1); }, 1000 * (attempt + 1));
            return;
          }
          soc.friends[id] = { uid: id, hidden: true }; soc.posts[id] = []; pushSocial();
        };
        friendSubs[id] = stop;
        offs.push(F.onSnapshot(profDoc(id), (s) => { soc.friends[id] = s.exists() ? { ...s.data(), uid: id } : { uid: id }; pushSocial(); }, onErr));
        offs.push(F.onSnapshot(postsQ(id, 25), (qs) => { soc.posts[id] = toPosts(id, qs); pushSocial(); }, onErr));
      };
      ids.forEach((id) => {
        if (friendSubs[id]) return;
        soc.friends[id] = soc.friends[id] || null;
        watch(id);
      });
      pushSocial();
    }, fail));
    unsubs.push(() => { Object.values(friendSubs).forEach((u) => u()); });
  }

  async function acceptReq(r, myName, myPhoto) {
    const b = F.writeBatch(db);
    b.set(F.doc(db, 'profiles', uid, 'friends', r.from), { since: F.serverTimestamp() });
    b.set(F.doc(db, 'profiles', r.from, 'friends', uid), { since: F.serverTimestamp() });
    b.delete(F.doc(db, 'requests', r.id));
    await b.commit();
    await F.addDoc(F.collection(db, 'profiles', r.from, 'inbox'), { type: 'accepted', from: uid, fromName: myName, fromPhoto: myPhoto || '', at: F.serverTimestamp() }).catch(() => {});
  }

  const social = {
    subscribe(fn) { socialFn = fn; pushSocial(); },
    publish: (snap) => uid && F.setDoc(profDoc(uid), { ...snap, updatedAt: F.serverTimestamp() }, { merge: true }).catch((e) => console.warn('profile', e)),
    async sendRequest(rawCode, myName, myPhoto) {
      const code = cleanCode(rawCode);
      if (code.length !== 6) throw new Error('Friend codes have 6 letters and numbers.');
      if (code === soc.code) throw new Error("That's your own code.");
      const c = await F.getDoc(F.doc(db, 'codes', code));
      const to = c.exists() ? c.data().uid : null;
      if (!to) throw new Error('No one has that code. Check it and try again.');
      if (to === uid) throw new Error("That's your own code.");
      if (soc.friendIds.includes(to)) throw new Error("You're already friends.");
      if (soc.outgoing.some((r) => r.to === to)) throw new Error('You already sent them a request.');
      const back = await F.getDoc(F.doc(db, 'requests', `${to}_${uid}`));
      if (back.exists()) { await acceptReq({ id: back.id, ...back.data() }, myName, myPhoto); return 'accepted'; }
      await F.setDoc(F.doc(db, 'requests', `${uid}_${to}`), { from: uid, to, fromName: myName, fromPhoto: myPhoto || '', toCode: code, at: F.serverTimestamp() });
      return 'sent';
    },
    accept: (r, myName, myPhoto) => acceptReq(r, myName, myPhoto),
    dropRequest: (r) => F.deleteDoc(F.doc(db, 'requests', r.id)),
    async removeFriend(fid) {
      const b = F.writeBatch(db);
      b.delete(F.doc(db, 'profiles', uid, 'friends', fid));
      b.delete(F.doc(db, 'profiles', fid, 'friends', uid));
      await b.commit();
    },
    cheer: (fid, myName, myPhoto) => F.addDoc(F.collection(db, 'profiles', fid, 'inbox'), { type: 'cheer', from: uid, fromName: myName, fromPhoto: myPhoto || '', at: F.serverTimestamp() }),
    savePost: (id, data, isNew) => uid && F.setDoc(F.doc(db, 'profiles', uid, 'posts', id), isNew ? { ...data, kudos: {} } : data, { merge: true }).catch((e) => console.warn('post', e)),
    deletePost: (id) => uid && F.deleteDoc(F.doc(db, 'profiles', uid, 'posts', id)).catch((e) => console.warn('post', e)),
    kudos: (owner, id, myName, on) => F.updateDoc(F.doc(db, 'profiles', owner, 'posts', id), new F.FieldPath('kudos', uid), on ? myName : F.deleteField()),
    clearInbox: (ids) => Promise.all(ids.map((id) => F.deleteDoc(F.doc(db, 'profiles', uid, 'inbox', id)).catch(() => {}))),
  };

  const friendly = (e) => {
    const code = e?.code || '';
    const map = {
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/wrong-password': 'Email or password is incorrect.',
      'auth/user-not-found': 'No account with that email. Try creating one.',
      'auth/email-already-in-use': 'That email already has an account. Try signing in.',
      'auth/weak-password': 'Password needs at least 6 characters.',
      'auth/invalid-email': 'That email address looks off.',
      'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
      'auth/popup-closed-by-user': 'Sign-in window was closed.',
      'auth/operation-not-allowed': 'That sign-in method is not enabled in Firebase yet.',
    };
    return new Error(map[code] || e?.message || 'Something went wrong.');
  };
  const wrap = (p) => p.catch((e) => { throw friendly(e); });

  // Feedback: anyone signed in can send; only accounts listed in admins/{uid} can read (see firestore.rules).
  const feedback = {
    send: (d) => F.addDoc(F.collection(db, 'feedback'), { ...d, uid, email: d.email ? (auth.currentUser?.email || '') : '', at: F.serverTimestamp(), status: 'new' }),
    watch: (cb) => F.onSnapshot(F.query(F.collection(db, 'feedback'), F.orderBy('at', 'desc'), F.limit(200)),
      (qs) => cb(qs.docs.map((d) => ({ ...d.data(), id: d.id, at: ms(d.data().at) }))), (e) => cb(null, e)),
    setStatus: (id, status) => F.updateDoc(F.doc(db, 'feedback', id), { status }),
    remove: (id) => F.deleteDoc(F.doc(db, 'feedback', id)),
    async isAdmin() { try { return uid ? (await F.getDoc(F.doc(db, 'admins', uid))).exists() : false; } catch { return false; } },
  };

  return {
    mode: 'cloud',
    social,
    feedback,
    auth: {
      google: () => wrap(A.signInWithPopup(auth, new A.GoogleAuthProvider())),
      signIn: (email, pw) => wrap(A.signInWithEmailAndPassword(auth, email, pw)),
      signUp: async (name, email, pw) => {
        const cred = await wrap(A.createUserWithEmailAndPassword(auth, email, pw));
        if (name) await A.updateProfile(cred.user, { displayName: name }).catch(() => {});
        S.user = cred.user; emit('user');
        return cred;
      },
      reset: (email) => wrap(A.sendPasswordResetEmail(auth, email)),
      signOut: () => A.signOut(auth),
    },
    start() {
      A.onAuthStateChanged(auth, (user) => {
        uid = user?.uid || null;
        S.mainReady = false;
        S.user = user || null;
        if (!user) { setMain(null); S.days = {}; S.meals = {}; }
        emit('user');
        listen();
      });
    },
    saveMain: (fields) => uid && F.setDoc(userDoc(), fields ?? S.main, { merge: true }).catch(fail),
    setLog: (id, key, v) => uid && F.updateDoc(userDoc(), new F.FieldPath('logs', id, key), v).catch(fail),
    deleteLogs: (id) => uid && F.updateDoc(userDoc(), new F.FieldPath('logs', id), F.deleteField()).catch(fail),
    saveDay: (key, partial) => {
      S.days[key] = { ...(S.days[key] || {}), ...partial };
      return uid && F.setDoc(F.doc(db, 'users', uid, 'days', key), partial, { merge: true }).catch(fail);
    },
    saveMeal: (m) => { S.meals[m.id] = m; return uid && F.setDoc(F.doc(db, 'users', uid, 'meals', m.id), m).catch(fail); },
    deleteMeal: (id) => {
      delete S.meals[id]; delete photoCache[id];
      if (!uid) return;
      F.deleteDoc(F.doc(db, 'users', uid, 'meals', id)).catch(fail);
      F.deleteDoc(F.doc(db, 'users', uid, 'photos', id)).catch(() => {});
    },
    savePhoto: (id, data) => { photoCache[id] = data; return uid && F.setDoc(F.doc(db, 'users', uid, 'photos', id), { data }).catch(fail); },
    getPhoto: async (id) => {
      if (id in photoCache) return photoCache[id];
      if (!uid) return null;
      try { const s = await F.getDoc(F.doc(db, 'users', uid, 'photos', id)); photoCache[id] = s.exists() ? s.data().data : null; }
      catch { photoCache[id] = null; }
      return photoCache[id];
    },
    deletePhoto: (id) => { delete photoCache[id]; return uid && F.deleteDoc(F.doc(db, 'users', uid, 'photos', id)).catch(() => {}); },
    async importAll(data) {
      const ops = [];
      ops.push(['set', userDoc(), data.main || {}]);
      Object.entries(data.days || {}).forEach(([k, v]) => ops.push(['set', F.doc(db, 'users', uid, 'days', k), v]));
      Object.values(data.meals || {}).forEach((m) => ops.push(['set', F.doc(db, 'users', uid, 'meals', m.id), m]));
      for (let i = 0; i < ops.length; i += 400) {
        const b = F.writeBatch(db);
        ops.slice(i, i + 400).forEach(([, ref, v]) => b.set(ref, v));
        await b.commit();
      }
    },
    async resetAll() {
      const refs = [];
      for (const name of ['days', 'meals', 'photos']) {
        const qs = await F.getDocs(sub(name));
        qs.forEach((d) => refs.push(d.ref));
      }
      for (let i = 0; i < refs.length; i += 400) {
        const b = F.writeBatch(db);
        refs.slice(i, i + 400).forEach((r) => b.delete(r));
        await b.commit();
      }
      await F.setDoc(userDoc(), { tasks: [], logs: {}, customFoods: [] }, { merge: true });
    },
  };
}

export async function resolveConfig(fileConfig) {
  if (fileConfig && fileConfig.apiKey && !String(fileConfig.apiKey).startsWith('YOUR_')) return fileConfig;
  try {
    const r = await fetch('/__/firebase/init.json');
    if (r.ok) { const j = await r.json(); if (j.apiKey) return j; }
  } catch {}
  return null;
}
