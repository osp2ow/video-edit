// Firebase(구글 로그인 + Firestore + Storage) — GitHub Pages 버전에서만 켜진다.
// config.js 에 window.FIREBASE_CONFIG 와 window.APP_ADMINS 가 있어야 한다.
import { CardLayout, Project, Ratio } from './model';

declare const firebase: any;

export interface CloudUser { uid: string; name: string; email: string; photo: string }
export type CloudStatus = 'loading' | 'out' | 'blocked' | 'member' | 'admin';

/** 클라우드에 올라간 파일 하나 */
export interface FileRef { name: string; path: string; size: number; type: string }
/** 프로젝트가 쓰는 파일들 */
export interface ProjectFiles { video?: FileRef; rec?: FileRef; sheet?: FileRef; angles?: Record<string, FileRef>; sources?: Record<string, FileRef>; sheets?: Record<string, FileRef>; recs?: Record<string, FileRef> }
export const refsOf = (f?: ProjectFiles): FileRef[] =>
  f ? [f.video, f.rec, f.sheet, ...Object.values(f.angles || {}), ...Object.values(f.sources || {}), ...Object.values(f.sheets || {}), ...Object.values(f.recs || {})].filter(Boolean) as FileRef[] : [];

export interface ProjectDoc {
  id: string;
  title: string;
  ownerUid: string;
  ownerName: string;
  videoName: string;
  recName: string;
  sheetName: string;
  angleNames: string[];
  sourceNames?: string[];   // 이어 붙인 영상들 (첫 영상 다음)
  recNames?: string[];      // 두 번째부터 넣은 녹음본들
  sheetNames?: string[];    // 더 넣은 악보들 (첫 악보 다음)
  project: Project;
  layouts: Record<Ratio, CardLayout>;
  ratio: Ratio;
  files?: ProjectFiles;
  createdAt: number;
  updatedAt: number;
  editedByUid?: string;    // 마지막으로 고친 선생님 (프로젝트는 모두 함께 씀)
  editedByName?: string;
  editSession?: string;    // 마지막으로 저장한 창 (다른 컴퓨터에서 고쳤는지 알아보는 데 씀)
}
/** 이 창(브라우저 탭)만의 표시 — 내가 저장한 건지 다른 컴퓨터가 저장한 건지 구분 */
export const EDIT_SESSION = Math.random().toString(36).slice(2) + Date.now().toString(36);
export interface TemplateDoc { id: string; name: string; layouts: Record<Ratio, CardLayout>; createdByUid: string; createdByName: string; createdAt: number }
export interface MemberDoc { email: string; name: string; addedAt: number }

export interface Cloud {
  onAuth(cb: (u: CloudUser | null, s: CloudStatus) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  watchProjects(cb: (list: ProjectDoc[]) => void): () => void;
  createProject(d: Omit<ProjectDoc, 'id' | 'createdAt' | 'updatedAt' | 'ownerUid' | 'ownerName'>): Promise<string>;
  saveProject(id: string, d: Partial<ProjectDoc>): Promise<void>;
  deleteProject(id: string): Promise<void>;
  watchTemplates(cb: (list: TemplateDoc[]) => void): () => void;
  addTemplate(name: string, layouts: Record<Ratio, CardLayout>): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  watchMembers(cb: (list: MemberDoc[]) => void): () => void;
  addMember(email: string, name: string): Promise<void>;
  removeMember(email: string): Promise<void>;
  setFiles(id: string, files: ProjectFiles): Promise<void>;
  storage: boolean; // Storage 사용 가능 여부
  uploadFile(f: File, onProgress: (r: number) => void): Promise<FileRef>;
  downloadFile(r: FileRef, onProgress: (r: number) => void): Promise<File>;
  deleteFile(path: string): Promise<void>;
  user(): CloudUser | null;
  isAdmin(): boolean;
  getPref(key: string): Promise<any>;          // 내 계정 설정 (여러 PC에서 같이 씀)
  setPref(key: string, value: any): Promise<void>;
  open: boolean; // 구글 로그인만 하면 누구나 사용 (명단 없음)
}

/** Firestore는 undefined 값을 받지 않으므로 JSON으로 한 번 걸러서 저장 */
const clean = <T>(o: T): T => JSON.parse(JSON.stringify(o));

// ---------- 이번 달 내려받은 양 (요금 추정용, 이 컴퓨터 기준) ----------
const dlKey = (d = new Date()) => `pve.dl.${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** 이 컴퓨터(브라우저)에서 이번 달 클라우드에서 내려받은 바이트 */
export function monthDownloaded(): number {
  try { return Number(localStorage.getItem(dlKey())) || 0; } catch { return 0; }
}
function addDownloaded(n: number) {
  try { localStorage.setItem(dlKey(), String(monthDownloaded() + n)); } catch { /* 저장 못 해도 그만 */ }
}

/** 같은 파일을 두 번 올리지 않도록 만드는 지문: 크기 + 앞뒤 4MB의 SHA-256 */
async function fileKey(f: File): Promise<string> {
  const CH = 4 << 20;
  const head = new Uint8Array(await f.slice(0, CH).arrayBuffer());
  const tail = f.size > CH * 2 ? new Uint8Array(await f.slice(f.size - CH).arrayBuffer()) : new Uint8Array(0);
  const meta = new TextEncoder().encode(`${f.size}:`);
  const buf = new Uint8Array(meta.length + head.length + tail.length);
  buf.set(meta, 0); buf.set(head, meta.length); buf.set(tail, meta.length + head.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

export function initCloud(): Cloud | null {
  const w = window as any;
  const cfg = w.FIREBASE_CONFIG;
  if (typeof firebase === 'undefined' || !cfg || !cfg.apiKey || String(cfg.apiKey).includes('여기에')) return null;
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const st = typeof firebase.storage === 'function' && cfg.storageBucket ? firebase.storage() : null;
  const admins: string[] = (w.APP_ADMINS || []).map((e: string) => e.toLowerCase());
  const open = admins.includes('*');
  let me: CloudUser | null = null;
  let admin = false;

  const sortBy = <T>(arr: T[], key: keyof T) => arr.sort((a: any, b: any) => (b[key] || 0) - (a[key] || 0));
  const watch = <T>(col: string, map: (id: string, d: any) => T, key: keyof T, cb: (l: T[]) => void) =>
    db.collection(col).onSnapshot((snap: any) => {
      const out: T[] = [];
      snap.forEach((doc: any) => out.push(map(doc.id, doc.data())));
      cb(sortBy(out, key));
    }, () => cb([]));

  return {
    open,
    onAuth(cb) {
      cb(null, 'loading');
      return auth.onAuthStateChanged(async (u: any) => {
        if (!u) { me = null; admin = false; cb(null, 'out'); return; }
        me = { uid: u.uid, name: u.displayName || u.email, email: (u.email || '').toLowerCase(), photo: u.photoURL || '' };
        admin = open || admins.includes(me.email);
        if (admin) { cb(me, 'admin'); return; }
        try {
          const m = await db.collection('members').doc(me.email).get();
          cb(me, m.exists ? 'member' : 'blocked');
        } catch { cb(me, 'blocked'); }
      });
    },
    async signIn() {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await auth.signInWithPopup(provider);
    },
    async signOut() { await auth.signOut(); },
    user: () => me,
    isAdmin: () => admin,

    watchProjects(cb) {
      return watch<ProjectDoc>('projects', (id, d) => ({ id, ...d }), 'updatedAt', cb);
    },
    async createProject(d) {
      const ref = db.collection('projects').doc();
      const now = Date.now();
      await ref.set(clean({ ...d, ownerUid: me!.uid, ownerName: me!.name, editedByUid: me!.uid, editedByName: me!.name, editSession: EDIT_SESSION, createdAt: now, updatedAt: now }));
      return ref.id;
    },
    async saveProject(id, d) {
      // 만든 사람은 그대로 두고, 마지막으로 고친 사람만 기록 (모든 선생님이 같은 프로젝트를 함께 고침)
      await db.collection('projects').doc(id).set(clean({ ...d, editedByUid: me!.uid, editedByName: me!.name, editSession: EDIT_SESSION, updatedAt: Date.now() }), { merge: true });
    },
    async deleteProject(id) { await db.collection('projects').doc(id).delete(); },
    async setFiles(id, files) {
      await db.collection('projects').doc(id).update({ files: clean(files), editedByUid: me!.uid, editedByName: me!.name, editSession: EDIT_SESSION, updatedAt: Date.now() });
    },

    storage: !!st,
    async uploadFile(f, onProgress) {
      if (!st) throw new Error('storage-off');
      const ext = (f.name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || 'bin').toLowerCase();
      const path = `files/${await fileKey(f)}.${ext}`;
      const ref = st.ref(path);
      const out: FileRef = { name: f.name, path, size: f.size, type: f.type || '' };
      try { await ref.getMetadata(); onProgress(1); return out; } catch { /* 아직 없음 → 올리기 */ }
      await new Promise<void>((res, rej) => {
        const task = ref.put(f, { contentType: f.type || undefined, customMetadata: { name: f.name } });
        task.on('state_changed', (s: any) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), rej, () => res());
      });
      return out;
    },
    async downloadFile(r, onProgress) {
      if (!st) throw new Error('storage-off');
      const url = await st.ref(r.path).getDownloadURL();
      const resp = await fetch(url);
      if (!resp.ok || !resp.body) throw new Error(`download ${resp.status}`);
      const total = Number(resp.headers.get('content-length')) || r.size || 0;
      const reader = resp.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        if (total) onProgress(Math.min(1, got / total));
      }
      addDownloaded(got);
      return new File(parts, r.name, { type: r.type || resp.headers.get('content-type') || '' });
    },
    async deleteFile(path) {
      if (!st) return;
      try { await st.ref(path).delete(); } catch (e: any) { if (e?.code !== 'storage/object-not-found') throw e; }
    },

    watchTemplates(cb) {
      return watch<TemplateDoc>('templates', (id, d) => ({ id, ...d }), 'createdAt', cb);
    },
    async addTemplate(name, layouts) {
      await db.collection('templates').doc().set(clean({ name, layouts, createdByUid: me!.uid, createdByName: me!.name, createdAt: Date.now() }));
    },
    async deleteTemplate(id) { await db.collection('templates').doc(id).delete(); },
    async getPref(key) { if (!me) return null; const d = await db.collection('prefs').doc(me.uid).get(); return d.exists ? (d.data() || {})[key] ?? null : null; },
    async setPref(key, value) { if (!me) return; await db.collection('prefs').doc(me.uid).set({ [key]: clean(value) }, { merge: true }); },

    watchMembers(cb) {
      return watch<MemberDoc>('members', (id, d) => ({ email: id, name: d.name || '', addedAt: d.addedAt || 0 }), 'addedAt', cb);
    },
    async addMember(email, name) {
      await db.collection('members').doc(email.trim().toLowerCase()).set({ name: name.trim(), addedAt: Date.now(), addedBy: me!.email });
    },
    async removeMember(email) { await db.collection('members').doc(email).delete(); },
  };
}
