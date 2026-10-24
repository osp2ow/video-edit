// 로그인 화면 · 프로젝트 목록 · 선생님 관리
import { Cloud, CloudStatus, CloudUser, ProjectDoc, MemberDoc, refsOf, monthDownloaded } from './cloud';

const { useState, useEffect } = React;

export function LoginScreen(p: { cloud: Cloud; status: CloudStatus; user: CloudUser | null }) {
  const [err, setErr] = useState('');
  const signIn = async () => {
    setErr('');
    try { await p.cloud.signIn(); }
    catch (e: any) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
      if (e?.code === 'auth/unauthorized-domain') setErr('이 주소가 Firebase에 승인된 도메인으로 등록되지 않았어요. README의 "승인된 도메인" 단계를 확인해 주세요.');
      else setErr(`로그인하지 못했어요 (${e?.code || e?.message || e}).`);
    }
  };
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand big">
          <span className="logo" aria-hidden="true"><i /><i /><i /><i /></span>
          <h1>연주 영상 편집기</h1>
        </div>
        <p className="login-sub">주니퍼 실용음악학원 선생님 전용</p>
        {p.status === 'loading' && <p className="note">확인 중…</p>}
        {p.status === 'out' && (
          <>
            <button type="button" className="btn google" onClick={signIn}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              구글 계정으로 로그인
            </button>
            {err && <p className="note warn-text">{err}</p>}
          </>
        )}
        {p.status === 'blocked' && p.user && (
          <>
            <p className="note warn-text">{p.user.email} 계정은 아직 선생님 명단에 없어요.<br />부원장님께 이 이메일을 알려주시면 등록해 드려요.</p>
            <button type="button" className="btn" onClick={() => p.cloud.signOut()}>다른 계정으로 로그인</button>
          </>
        )}
      </div>
    </div>
  );
}

interface PanelProps {
  cloud: Cloud;
  user: CloudUser;
  admin: boolean;
  projects: ProjectDoc[];
  currentId: string | null;
  onOpen: (d: ProjectDoc, copy: boolean) => void;
  onNew: () => void;
  onClose: () => void;
  onDelete: (d: ProjectDoc) => Promise<void>;
  onClearFiles: (d: ProjectDoc) => Promise<void>;
}

const FREE = 5 * 1024 ** 3;
// ---------- 예상 요금 (Firebase Storage, *.firebasestorage.app 버킷 = Google Cloud Storage 요금) ----------
// 2026-10 기준 공개 요금표. 무료 한도는 미국 지역(us-central1·us-east1·us-west1) 버킷에만 있음.
//   보관: 미국 $0.020, 그 외(서울·도쿄 등) 약 $0.023 / GB·월 — 미국은 5GB까지 무료
//   내려받기(인터넷으로 나가는 양): $0.12 / GB — 미국은 한 달 100GB까지 무료
//   올리기는 무료, 요청 횟수 요금은 이 앱 사용량에선 몇 원 수준이라 뺌
export type Region = 'us' | 'asia';
const GB = 1024 ** 3, KRW = 1450;
const PRICE = {
  us:   { store: 0.020, freeStore: 5, egress: 0.12, freeEgress: 100 },
  asia: { store: 0.023, freeStore: 0, egress: 0.12, freeEgress: 0 },
};
export function estimateCost(region: Region, storedBytes: number, downloadedBytes: number) {
  const p = PRICE[region];
  const store = Math.max(0, storedBytes / GB - p.freeStore) * p.store * KRW;
  const egress = Math.max(0, downloadedBytes / GB - p.freeEgress) * p.egress * KRW;
  return { store, egress, total: store + egress };
}
const fmtWon = (w: number) => w < 1 ? '0원' : w < 10 ? '10원 미만' : `${Math.round(w).toLocaleString('ko-KR')}원`;
const REGION_KEY = 'pve.storageRegion';
const loadRegion = (): Region => { try { return localStorage.getItem(REGION_KEY) === 'asia' ? 'asia' : 'us'; } catch { return 'us'; } };
const fmtSize = (b: number) => b <= 0 ? "0MB" : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)}GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function ProjectsPanel(p: PanelProps) {
  const [tab, setTab] = useState<'all' | 'members'>('all');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 클라우드 사용량 (같은 파일은 한 번만 셈)
  const seen = new Map<string, number>();
  p.projects.forEach(d => refsOf(d.files).forEach(r => seen.set(r.path, r.size || 0)));
  const used = Array.from(seen.values()).reduce((a, b) => a + b, 0);
  const projSize = (d: ProjectDoc) => refsOf(d.files).reduce((a, r) => a + (r.size || 0), 0);
  const [q, setQ] = useState('');
  const list = p.projects
    .filter(d => !q.trim() || `${d.title} ${d.videoName} ${d.ownerName}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="pj-title" onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="modal wide">
        <div className="modal-head">
          <h2 id="pj-title">프로젝트</h2>
          <div className="row">
            <button type="button" className="btn accent sm" onClick={p.onNew}>새 프로젝트</button>
            <button type="button" className="btn ghost sm" onClick={p.onClose}>닫기</button>
          </div>
        </div>
        <div className="modal-body">
          {p.admin && !p.cloud.open && (
            <div className="seg small">
              <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>프로젝트</button>
              <button type="button" className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>선생님 관리</button>
            </div>
          )}
          {tab === 'all' && <p className="note">모든 선생님이 같은 프로젝트 목록을 함께 써요. 어느 컴퓨터에서 열어 고쳐도 같은 프로젝트에 저장돼요.</p>}
          {tab === 'members' ? <Members cloud={p.cloud} /> : (
            <>
              {p.cloud.storage && (
                <CostBox used={used} />
              )}
              <input id="pj-search" type="text" placeholder="제목·파일 이름·선생님으로 찾기" value={q} onChange={e => setQ(e.target.value)} />
              {list.length === 0 ? (
                <p className="note">프로젝트가 없어요</p>
              ) : (
                <ul className="pj-list">
                  {list.map(d => {
                    const editor = d.editedByName || d.ownerName;
                    return (
                      <li key={d.id} className={d.id === p.currentId ? 'current' : ''}>
                        <div className="pj-main">
                          {renaming === d.id ? (
                            <form className="row" onSubmit={e => { e.preventDefault(); if (renameVal.trim()) p.cloud.saveProject(d.id, { title: renameVal.trim() }); setRenaming(null); }}>
                              <input id={`rn-${d.id}`} type="text" value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)} />
                              <button type="submit" className="btn sm">저장</button>
                            </form>
                          ) : <span className="pj-title">{d.title || '제목 없음'}{d.id === p.currentId && <span className="tag">지금 작업 중</span>}</span>}
                          <span className="pj-meta">
                            <b>{editor}</b> {fmtDate(d.updatedAt)} 저장{d.ownerName && d.ownerName !== editor ? ` · 만든 사람 ${d.ownerName}` : ''} · BPM {d.project?.bpm ?? '-'} · 앵글 {1 + (d.angleNames?.length || 0)}개 · 전환 {d.project?.cuts?.length || 0}곳
                          </span>
                          <span className="pj-files mono">{[d.videoName, d.recName, d.sheetName, ...(d.angleNames || [])].filter(Boolean).join(' · ') || '파일 없음'}</span>
                          {p.cloud.storage && <span className={`pj-cloud ${projSize(d) ? 'on' : ''}`}>{projSize(d) ? `클라우드 ${fmtSize(projSize(d))}` : '클라우드에 파일 없음'}</span>}
                        </div>
                        <div className="pj-act">
                          <button type="button" className="btn sm" onClick={() => p.onOpen(d, false)}>열기</button>
                          <button type="button" className="btn ghost sm" onClick={() => p.onOpen(d, true)} title="따로 고쳐 보고 싶을 때: 복사본을 새 프로젝트로 만들어요. 원본은 그대로예요.">복사본 만들기</button>
                          <button type="button" className="btn ghost sm" onClick={() => { setRenaming(d.id); setRenameVal(d.title); }}>이름 바꾸기</button>
                          {projSize(d) > 0 && (confirmClear === d.id
                            ? <button type="button" className="btn danger sm" disabled={busy === d.id} onClick={async () => { setBusy(d.id); await p.onClearFiles(d); setBusy(null); setConfirmClear(null); }}>파일만 지우기</button>
                            : <button type="button" className="btn ghost sm" onClick={() => { setConfirmClear(d.id); setConfirmDel(null); }} title="설정은 남기고 클라우드 파일만 지워요">파일 지우기</button>)}
                          {(confirmDel === d.id
                            ? <button type="button" className="btn danger sm" disabled={busy === d.id} onClick={async () => { setBusy(d.id); await p.onDelete(d); setBusy(null); setConfirmDel(null); }}>정말 삭제</button>
                            : <button type="button" className="btn ghost sm" onClick={() => { setConfirmDel(d.id); setConfirmClear(null); }}>삭제</button>)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 클라우드 예상 요금 (이번 달) */
function CostBox({ used }: { used: number }) {
  const [region, setRegion] = useState<Region>(loadRegion);
  const dl = monthDownloaded();
  const c = estimateCost(region, used, dl);
  const pick = (r: Region) => { setRegion(r); try { localStorage.setItem(REGION_KEY, r); } catch { /* 무시 */ } };
  const free = region === 'us';
  return (
    <div className="usage">
      <div className="usage-row"><span>이번 달 예상 요금</span><b className="mono cost-total">{fmtWon(c.total)}</b></div>
      <div className="usage-row sub">
        <span>보관 {fmtSize(used)}{free ? ' (5GB까지 무료)' : ''}</span><span className="mono">{fmtWon(c.store)}</span>
      </div>
      {free && <div className={`bar ${used > FREE ? 'over' : used > FREE * 0.8 ? 'near' : ''}`}><i style={{ width: `${Math.min(100, used / FREE * 100)}%` }} /></div>}
      <div className="usage-row sub">
        <span>내려받기 {fmtSize(dl)} · 이 컴퓨터, 이번 달{free ? ' (100GB까지 무료)' : ''}</span><span className="mono">{fmtWon(c.egress)}</span>
      </div>
      <div className="usage-row sub">
        <span>Storage 위치</span>
        <select id="cost-region" value={region} onChange={e => pick(e.target.value as Region)}>
          <option value="us">미국 (us-central1 등, 무료 한도 있음)</option>
          <option value="asia">서울·도쿄 등 그 외 (무료 한도 없음)</option>
        </select>
      </div>
      <p className="note small">대략적인 금액이에요 (1달러≈{KRW.toLocaleString('ko-KR')}원). 올리기는 무료이고, 다른 컴퓨터에서 내려받은 양은 빠져 있어요. 위치는 Firebase 콘솔 → Storage에서 버킷 이름 옆에 나와요.</p>
    </div>
  );
}

function Members(p: { cloud: Cloud }) {
  const [list, setList] = useState<MemberDoc[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => p.cloud.watchMembers(setList), []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) { setErr('이메일 형식을 확인해 주세요.'); return; }
    setErr('');
    try { await p.cloud.addMember(m, name); setEmail(''); setName(''); }
    catch (e: any) { setErr(`추가하지 못했어요 (${e?.code || e}).`); }
  };
  return (
    <div className="members">
      <form className="member-form" onSubmit={add}>
        <input id="m-name" type="text" placeholder="이름 (예: 김믿음 선생님)" value={name} onChange={e => setName(e.target.value)} />
        <input id="m-email" type="text" placeholder="구글 이메일" value={email} onChange={e => setEmail(e.target.value)} />
        <button type="submit" className="btn sm">추가</button>
      </form>
      {err && <p className="note warn-text">{err}</p>}
      {list.length === 0 ? <p className="note">아직 등록된 선생님이 없어요.</p> : (
        <ul className="pj-list">
          {list.map(m => (
            <li key={m.email}>
              <div className="pj-main"><span className="pj-title">{m.name || m.email}</span><span className="pj-files mono">{m.email}</span></div>
              <div className="pj-act"><button type="button" className="btn ghost sm" onClick={() => p.cloud.removeMember(m.email)}>빼기</button></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 프로젝트를 열었을 때 다시 넣어야 할 파일 목록 */
export function NeededFiles(p: { need: { label: string; name: string; ok: boolean }[]; onClose?: () => void }) {
  if (!p.need.length || p.need.every(n => n.ok)) return null;
  return (
    <div className="needed">
      <div className="needed-head">
        <p className="needed-title">필요한 파일</p>
        {p.onClose && <button type="button" className="btn ghost xs" onClick={p.onClose} title="이 안내 닫기 (파일은 나중에 넣어도 돼요)">닫기</button>}
      </div>
      <ul>
        {p.need.map(n => (
          <li key={n.label + n.name} className={n.ok ? 'ok' : ''}>
            <span className="chk" aria-hidden="true">{n.ok ? '✓' : ''}</span>
            <span className="needed-label">{n.label}</span>
            <span className="mono">{n.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

