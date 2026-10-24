// 테스트용 가짜 Firebase (compat API 중 앱이 쓰는 부분만). 데이터는 localStorage에 보관해 새로고침해도 유지.
(function () {
  const KEY = '__fakefs', AKEY = '__fakeauth';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const subs = [];
  const notify = () => subs.forEach(s => s());
  window.addEventListener('storage', e => { if (e.key === KEY) notify(); });   // 다른 창(다른 컴퓨터 흉내)에서 저장하면 알림
  let user = JSON.parse(localStorage.getItem(AKEY) || 'null');
  const authCbs = [];
  const setUser = (u) => { user = u; localStorage.setItem(AKEY, JSON.stringify(u)); authCbs.forEach(cb => setTimeout(() => cb(u), 10)); };
  let seq = 0;
  const docRef = (col, id) => ({
    id,
    async get() { const d = load(); const v = d[col]?.[id]; return { exists: !!v, data: () => v }; },
    async set(data, opts) {
      if (window.__FAKE_FAIL) throw new Error('offline');
      const d = load(); d[col] = d[col] || {};
      d[col][id] = opts && opts.merge ? { ...(d[col][id] || {}), ...data } : data;
      save(d); notify();
    },
    async delete() { const d = load(); if (d[col]) delete d[col][id]; save(d); notify(); },
    async update(data) { const d = load(); if (!d[col]?.[id]) throw { code: 'not-found' }; d[col][id] = { ...d[col][id], ...data }; save(d); notify(); },
  });
  // 가짜 Storage (메모리)
  const blobs = window.__fakeBlobs = new Map();
  const storage = {
    ref(path) {
      return {
        async getMetadata() { if (!blobs.has(path)) throw { code: 'storage/object-not-found' }; return { size: blobs.get(path).size }; },
        put(file) {
          const subs = [];
          setTimeout(async () => {
            for (const r of [0.25, 0.5, 0.75, 1]) { await new Promise(t => setTimeout(t, 40)); subs.forEach(s => s.next && s.next({ bytesTransferred: file.size * r, totalBytes: file.size })); }
            blobs.set(path, file); subs.forEach(s => s.done && s.done());
          }, 10);
          return { on(ev, next, err, done) { subs.push({ next, err, done }); } };
        },
        async getDownloadURL() { if (!blobs.has(path)) throw { code: 'storage/object-not-found' }; return URL.createObjectURL(blobs.get(path)); },
        async delete() { if (!blobs.has(path)) throw { code: 'storage/object-not-found' }; blobs.delete(path); },
      };
    },
  };
  const db = {
    collection(col) {
      return {
        doc(id) { return docRef(col, id || ('id' + Date.now().toString(36) + (seq++))); },
        onSnapshot(cb) {
          const run = () => { const d = load()[col] || {}; const docs = Object.entries(d).map(([id, v]) => ({ id, data: () => v })); cb({ forEach: f => docs.forEach(f) }); };
          subs.push(run); setTimeout(run, 0);
          return () => { const i = subs.indexOf(run); if (i >= 0) subs.splice(i, 1); };
        },
      };
    },
  };
  function GoogleAuthProvider() {} GoogleAuthProvider.prototype.setCustomParameters = function () {};
  const auth = {
    onAuthStateChanged(cb) { authCbs.push(cb); setTimeout(() => cb(user), 10); return () => {}; },
    async signInWithPopup() { const u = window.__FAKE_LOGIN; if (!u) throw { code: 'auth/popup-closed-by-user' }; setUser(u); },
    async signOut() { setUser(null); },
  };
  const fb = { apps: [], initializeApp(c) { fb.apps.push(c); }, auth: () => auth, firestore: () => db, storage: () => storage };
  fb.auth.GoogleAuthProvider = GoogleAuthProvider;
  window.firebase = fb;
  window.__fakeDump = () => load();
})();
