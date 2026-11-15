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
  try { F.enableIndexedDbPersistence?.(db).catch(() => {}); } catch {}

  let uid = null, unsubs = [];
  const userDoc = () => F.doc(db, 'users', uid);
  const sub = (name) => F.collection(db, 'users', uid, name);
  const photoCache = {};
  const fail = (err) => { console.error(err); emit('error:' + (err?.message || 'Could not reach the cloud')); };

  function listen() {
    unsubs.forEach((u) => u()); unsubs = [];
    if (!uid) return;
    unsubs.push(F.onSnapshot(userDoc(), (snap) => {
      if (!snap.exists()) {
        F.setDoc(userDoc(), { createdAt: F.serverTimestamp(), email: auth.currentUser?.email || null }, { merge: true }).catch(fail);
        setMain(null);
      } else setMain(snap.data());
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
  }

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

  return {
    mode: 'cloud',
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
