// 타임라인: 마디 눈금(고정) + 앵글 전환 줄 + 파형 줄(영상·앵글들·녹음본, 세로 스크롤) + 재생 위치
import { Project, Cut, Caption, ZoomSeg, Punch, getFx, markKind, cardSpan, cardPages, CardPage, SheetClip, sheetClipsOf, sheetClipEnd, Skip, mergeSkips, trimOf, Clip, clipsOf, clipEnd, sheetPos, MARK_KINDS, MARK_AMT, MarkKind, MAIN, TRANS_LIST, TransType, barAt, barStart, beatLen, barLen, normalizeCuts, sheetStart, sheetEnd, Fx, clipBarLen, snapTime, bpmAt, recKeyOf, fadeOf, Fade, clipFade, RecClip, MAIN_REC, Trim } from './model';
import { Track, PEAKS_RATE } from './analysis';

const { useRef, useEffect, useState } = React;

interface Props {
  video: HTMLVideoElement;
  duration: number;
  project: Project;
  vTrack: Track | null;
  rTrack: Track | null;
  nBars: number;
  onSeek: (t: number) => void;
  onPlayFrom: (t: number) => void;   // 눈금 숫자 부분 더블클릭 = 그 지점부터 재생
  angleInfo: (id: string) => { color: string; num: number; label: string };
  multi: boolean;
  onCuts: (c: Cut[]) => void;
  snap: (t: number) => number;
  angleTracks: { id: string; num: number; color: string; track: Track | null; offset: number }[];
  selected: string;                       // 'program' | 'main' | 앵글 id | 'rec'
  onSelect: (id: string) => void;
  inOut: { a: number | null; b: number | null };
  selCut: number | null;
  onSelectCut: (i: number | null) => void;
  selFx: { kind: 'zoom' | 'punch'; id: string } | null;
  onSelectFx: (s: { kind: 'zoom' | 'punch'; id: string } | null) => void;
  onFxItems: (patch: { zooms?: ZoomSeg[]; punches?: Punch[] }) => void;
  onAddPunch: (t: number) => void;
  selCaption: string | null;
  onCaptions: (list: Caption[]) => void;
  onSelectCaption: (id: string | null) => void;
  onEditCaption: (id: string) => void;
  onCard: (kind: 'intro' | 'outro', patch: { at?: number; dur?: number; pages?: CardPage[] }) => void;
  onSelectCard: (kind: 'intro' | 'outro' | null, edit?: boolean) => void;
  selCard: 'intro' | 'outro' | null;
  pick: { a: number | null; b: number | null } | null;   // 추출 구간 고르는 중
  onPick: (a: number, b: number) => void;
  onSheetClips: (list: SheetClip[] | null) => void;   // 악보 조각 (null = 처음대로)
  hasSheet: boolean;
  onSlip: (id: string, offset: number) => void;               // 녹음본·앵글 위치 끌기 (싱크 맞추기)
  onGrid: (patch: { anchorTime?: number; bpm?: number }) => void;  // 마디 눈금 끌기
  onSkips: (list: Skip[]) => void;                             // 잘라낸 구간
  onTrim: (id: string, tr: { in: number; out: number }) => void;   // 트랙 앞뒤 줄이기
  srcDur: number;                                              // 기준 영상 파일 길이
  now: () => number;                                           // 재생 시계 (타임라인 시간)
  playing: boolean;
  onClips: (list: Clip[]) => void;                             // 기준 영상 조각 (자르기 · 옮기기 · 줄이기)
  onSelectClip?: (c: Clip | null) => void;                     // 고른 영상 조각 (영상마다 크기·위치를 따로 맞추려고)
  onCycle: (c: { start: number; end: number; on: boolean } | null) => void;  // 구간 반복
  onGroup: (patch: Partial<Project>) => void;
  sheetHidden: boolean; onSheetHidden: (v: boolean) => void;   // 악보 보이기·숨기기
  sheetNames?: string[];                        // 들어 있는 악보 파일들 (첫 번째가 기본)
  nBarsOf?: (sheet?: string) => number;         // 그 악보의 마디 수
  onSheetBpm?: (clipId: string, bpm: number | undefined) => void;   // 고른 악보의 템포
  recAt: number;                                // 녹음본이 타임라인에서 시작하는 시각 (녹음본이 기준)
  srcTrackOf?: (src?: string) => Track | null;  // 영상 파일별 소리 (파형)
  srcDurOf?: (src?: string) => number;          // 영상 파일별 길이
  srcLabelOf?: (src?: string) => string;        // 영상 파일 이름 (조각 위에 표시)
  recExtras?: { key: string; src: string; name: string; at: number; track: Track | null; dur: number }[];   // 녹음본 조각들 (추가 녹음본 · 잘라서 생긴 조각)
  onFade?: (key: string, f: Fade) => void;   // 페이드 인·아웃: 녹음본 조각('rec'·'recx:…') · 영상 조각('clip:id')
  onSplitRec?: (t: number, key: string | null) => string | null;   // 녹음본 자르기 (I) → 새 조각 키
  onDeleteRec?: (key: string) => void;                              // 녹음본 조각 지우기
  recName?: string;                             // 첫 녹음본 파일 이름
  viewShift?: { n: number; dt: number };         // 타임라인 전체가 dt초 앞으로 당겨짐 (화면도 같이 옮겨서 제자리처럼 보이게)
}
type CapItem = { id: string; start: number; end: number; text: string; card?: 'intro' | 'outro' };

const C = {
  bg: '#1a1814', ruler: '#221f1a', grid: 'rgba(236,230,218,0.10)', gridBar: 'rgba(236,230,218,0.28)',
  text: '#cfc6b6', dim: '#6f675a', accent: '#ff8a1f', accentSoft: 'rgba(255,138,31,0.10)',
  vWave: '#d9cbb2', rWave: '#8bd26a', head: '#fff4e6',
};
const CY_H = 11;   // 눈금 줄 맨 위: 구간 반복 띠 (그 아래 숫자 부분은 재생 위치 이동)
const RULER = 30, AROW = 24, GAP = 6;
// 세로 확대: 소리 줄(기준 영상 · 녹음본 · 앵글) 높이와 타임라인이 보이는 높이
let ROW = 50, MAX_VIS = 250;
function setRowH(h: number) {
  ROW = Math.max(28, Math.min(160, Math.round(h)));
  MAX_VIS = Math.max(250, Math.min(480, 250 + (ROW - 50) * 2));
  try { localStorage.setItem('pve.tl.row', String(ROW)); } catch { /* 저장 불가 */ }
}
try { const v = Number(localStorage.getItem('pve.tl.row')); if (v) setRowH(v); } catch { /* 저장 불가 */ }
// 스크롤되는 영역 안의 좌표(눈금 아래부터 0)
const A_Y = GAP;
const CROW = 26;
const C_Y = A_Y + AROW + GAP;          // 자막 줄
const FROW = 26;
const KROW = 26;
const K_Y = C_Y + CROW + GAP;          // 악보 카드 줄 (보이는 구간)
const F_Y = K_Y + KROW + GAP;          // 효과 줄 (확대 구간 · 펀치 지점)
const ROWS_Y = F_Y + FROW + GAP;
const LANE = { flash: 6, punch: 13, shake: 20 } as const; // 효과 줄 안에서 종류별 높이

/** 소리가 없는 영상도 기준 영상 줄에 조각이 보이고 자르기·옮기기가 되게 (파형만 없음) */
const silentCache = new Map<number, Track>();
function silentTrack(dur: number): Track | null {
  if (!(dur > 0)) return null;
  let t = silentCache.get(dur);
  if (!t) { t = { mono: new Float32Array(0), env: new Float32Array(0), low: new Float32Array(0), mid: new Float32Array(0), peaks: new Float32Array(0), onsets: [], duration: dur, bias: 0 }; silentCache.set(dur, t); }
  return t;
}

/** 타임라인 복사·붙여넣기 (이 창 안에서만, 프로젝트를 바꿔도 남아 있음) */
type CopyItem =
  | { k: 'cap'; v: Caption } | { k: 'zoom'; v: ZoomSeg } | { k: 'punch'; v: Punch } | { k: 'clip'; v: Clip } | { k: 'sheet'; v: SheetClip }
  | { k: 'rec'; src: string; at: number; trim: Trim; fade?: Fade };
let clipboard: CopyItem[] | null = null;
const itemStart = (it: CopyItem) => it.k === 'cap' || it.k === 'zoom' || it.k === 'clip' || it.k === 'sheet' ? it.v.start : it.k === 'punch' ? it.v.t : it.at + it.trim.in;

export function Timeline(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const view = useRef({ start: 0, pps: 20, fitted: false });
  const [, force] = useState(0);
  const seeking = useRef(false);
  const pendingScrub = useRef<number | null>(null); // 줄을 누른 x — 4px 넘게 끌면 그때 재생 위치 이동
  const dragCut = useRef<number | null>(null);
  const scrollY = useRef(0);
  // 결과물 줄의 앵글 구간을 누르면 뜨는 메뉴 (구간 삭제 · 들어갈/나올 때 장면 전환)
  const [segMenu, setSegMenuS] = useState<{ i: number; x: number; y: number } | null>(null);
  const segMenuRef = useRef<{ i: number; x: number; y: number } | null>(null);
  const setSegMenu = (m: { i: number; x: number; y: number } | null) => { segMenuRef.current = m; setSegMenuS(m); };
  const pendingSeg = useRef<number | null>(null);
  // 효과 지점을 누르고 끌지 않고 떼면 그 지점 하나만 편집하는 메뉴
  const [markMenu, setMarkMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const markDown = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const geo = () => {
    const n = 2 + live.current.angleTracks.length;
    const contentH = ROWS_Y + n * (ROW + GAP) + 2;
    const visH = Math.min(contentH, MAX_VIS);
    return { contentH, visH, H: RULER + visH, maxScroll: Math.max(0, contentH - visH) };
  };

  const fit = () => {
    const w = wrap.current?.clientWidth || 800;
    const d = live.current.duration || 10;
    view.current = { start: -d * 0.01, pps: (w - 2) / (d * 1.02), fitted: true };
    force(n => n + 1);
  };

  // 처음 영상을 넣었을 때만 전체 보기로 맞춤 (조각을 옮겨 타임라인 길이가 바뀌어도 확대 상태는 그대로)
  useEffect(() => { if (props.srcDur) fit(); }, [props.srcDur]);
  useEffect(() => { if (props.duration && !props.srcDur) fit(); }, [props.duration]);
  useEffect(() => {
    const vs = props.viewShift; if (!vs || !vs.n) return;
    if (view.current.fitted) fit(); else { view.current.start -= vs.dt; force(n => n + 1); }
    // eslint-disable-next-line
  }, [props.viewShift?.n]);

  useEffect(() => {
    let raf = 0;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const draw = () => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    // 화면 배율(125%·150% 등)에서도 글자가 번지지 않게: 실제 픽셀 크기에 정확히 맞춤
    const wr = w.getBoundingClientRect();
    const pw = Math.floor((wr.width - 2) * dpr + 1e-3);      // 실제 화면 픽셀 수
    const cw = pw / dpr;
    const { contentH, visH, H, maxScroll } = geo();
    scrollY.current = Math.round(Math.max(0, Math.min(maxScroll, scrollY.current)));
    const sy = scrollY.current;
    if (c.width !== pw || c.height !== Math.round(H * dpr)) {
      c.width = pw; c.height = Math.round(H * dpr);
      c.style.width = cw + 'px'; c.style.height = Math.round(H * dpr) / dpr + 'px';
    }
    // 캔버스가 화면 픽셀 경계에 딱 맞게 (소수점 위치면 전체가 흐려짐)
    {
      const fx = ((wr.left + 1) * dpr) % 1, fy = ((wr.top + 1) * dpr) % 1;
      const tf = fx > 0.01 || fy > 0.01 ? `translate(${(fx > 0.5 ? 1 - fx : -fx) / dpr}px, ${(fy > 0.5 ? 1 - fy : -fy) / dpr}px)` : '';
      if (c.style.transform !== tf) c.style.transform = tf;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { project: p, vTrack, rTrack, nBars, video, duration, angleTracks } = live.current;
    const v = view.current;
    const t = live.current.now();
    if (live.current.playing && v.fitted === false) {
      const span = cw / v.pps;
      if (t > v.start + span * 0.92 || t < v.start) v.start = t - span * 0.1;
    }
    const X = (time: number) => (time - v.start) * v.pps;
    const t0 = v.start, t1 = v.start + cw / v.pps;
    const bl = beatLen(p), barPx = bl * p.beatsPerBar * v.pps;
    // 1마디 앞은 한 마디(-1마디, 내부 번호 0)만 그린다
    const n0 = Math.max(0, Math.floor(barAt(p, t0))), n1 = Math.ceil(barAt(p, t1));
    const firstBar = 1 + p.sheetOffset, lastBar = nBars + p.sheetOffset;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, cw, H);

    // ---- 스크롤 영역 (눈금 아래) ----
    ctx.save();
    ctx.beginPath(); ctx.rect(0, RULER, cw, visH); ctx.clip();
    ctx.translate(0, RULER - sy);
    if (nBars > 0) { const a = X(sheetStart(p, nBars)), b = X(sheetEnd(p, nBars)); ctx.fillStyle = C.accentSoft; ctx.fillRect(a, 0, b - a, contentH); }
    if (duration) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (X(0) > 0) ctx.fillRect(0, 0, X(0), contentH);
      if (X(duration) < cw) ctx.fillRect(X(duration), 0, cw - X(duration), contentH);
    }
    {
      // 박선: 마디마다 그 마디의 템포로 나눔 (악보마다 템포가 다를 수 있음)
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (let n = n0; n <= n1; n++) {
        const a = barStart(p, n), b = barStart(p, n + 1), w = (b - a) / p.beatsPerBar;
        if (w * v.pps < 7) continue;
        for (let k = 1; k < p.beatsPerBar; k++) { const x = Math.round(X(a + k * w)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, contentH); }
      }
      ctx.stroke();
    }
    for (let n = n0; n <= n1; n++) {
      const x = Math.round(X(barStart(p, n))) + 0.5;
      ctx.strokeStyle = n === 1 ? C.accent : C.gridBar; ctx.lineWidth = n === 1 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, contentH); ctx.stroke();
    }
    // 앵글 전환 줄
    {
      ctx.fillStyle = live.current.selected === 'program' ? 'rgba(255,138,31,0.10)' : 'rgba(255,255,255,0.025)'; ctx.fillRect(0, A_Y, cw, AROW);
      const segs: { a: number; b: number; id: string }[] = [];
      let prevT = Math.min(0, t0), prevId = MAIN;
      for (const cu of p.cuts) { segs.push({ a: prevT, b: cu.t, id: prevId }); prevT = cu.t; prevId = cu.angle; }
      segs.push({ a: prevT, b: Math.max(duration, t1), id: prevId });
      ctx.font = '700 12px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
      for (const sg of segs) {
        const xa = Math.max(0, X(sg.a)), xb = Math.min(cw, X(Math.min(sg.b, duration || sg.b)));
        if (xb <= xa) continue;
        const info = live.current.angleInfo(sg.id);
        ctx.globalAlpha = live.current.multi ? 0.55 : 0.18;
        ctx.fillStyle = info.color; ctx.fillRect(xa, A_Y + 2, xb - xa, AROW - 4);
        ctx.globalAlpha = 1;
        if (xb - xa > 16) { ctx.fillStyle = '#16130f'; ctx.fillText(info.label, Math.round(xa + 5), A_Y + AROW / 2); }
      }
      const sm = segMenuRef.current;
      if (sm && p.cuts[sm.i]) {
        const xa = X(p.cuts[sm.i].t), xb = X(sm.i + 1 < p.cuts.length ? p.cuts[sm.i + 1].t : (duration || t1));
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(xa + 1, A_Y + 1, xb - xa - 2, AROW - 2);
      }
      {
        const gfx = getFx(p);
        for (const cu of p.cuts) {
          const type = cu.tr?.type || gfx.trType;
          if (type === 'cut') continue;
          const d = cu.tr?.dur || gfx.trDur, xa = X(cu.t - d / 2), xb = X(cu.t + d / 2);
          if (xb < 0 || xa > cw) continue;
          const g = ctx.createLinearGradient(xa, 0, xb, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(xa, A_Y + 2, xb - xa, AROW - 4);
        }
      }
      for (let i = 0; i < p.cuts.length; i++) {
        const x = Math.round(X(p.cuts[i].t)) + 0.5;
        if (x < -5 || x > cw + 5) continue;
        const selc = allSel.current || live.current.selCut === i;
        ctx.strokeStyle = selc || dragCut.current === i ? '#fff' : '#f3ead9'; ctx.lineWidth = selc || dragCut.current === i ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(x, A_Y - 2); ctx.lineTo(x, A_Y + AROW + 2); ctx.stroke();
        if (selc) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, A_Y - 1, 4, 0, Math.PI * 2); ctx.fill(); }
      }
      const psel = live.current.selected === 'program';
      label(ctx, '결과물', A_Y + 3, psel ? C.accent : C.text, psel);
      if (psel) { ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.strokeRect(1, A_Y + 1, cw - 2, AROW - 2); ctx.fillStyle = C.accent; ctx.fillRect(0, A_Y, 5, AROW); }
    }
    // 자막 줄
    {
      ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(0, C_Y, cw, CROW);
      ctx.font = '600 12px "IBM Plex Sans KR", sans-serif'; ctx.textBaseline = 'middle';
      for (const c of capItems()) {
        const xa = X(c.start), xb = X(c.end);
        if (xb < 0 || xa > cw) continue;
        const sel = allSel.current || (!c.card && msel.current.has('cap:' + c.id)) || (c.card ? live.current.selCard === c.card : c.id === live.current.selCaption);
        const isChord = !!(c as any).chord;   // 기타 코드표는 초록색
        ctx.fillStyle = c.card ? (sel ? '#a9cbff' : 'rgba(127,178,255,0.8)') : isChord ? (sel ? '#c6f5d3' : 'rgba(150,225,170,0.82)') : sel ? '#ffd27a' : 'rgba(236,230,218,0.78)';
        ctx.beginPath(); ctx.roundRect(xa, C_Y + 2, Math.max(3, xb - xa), CROW - 4, 4); ctx.fill();
        if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        const pgs = c.card === 'outro' ? cardPages(getFx(p).outro) : [];
        if (pgs.length > 1) {
          // 엔딩 카드 안에서 바뀌는 문구들: 경계선 + 문구마다 글자
          pgs.forEach((pg, i) => {
            const pa = X(c.start + pg.at), pb = i + 1 < pgs.length ? X(c.start + pgs[i + 1].at) : xb;
            if (i > 0) { ctx.fillStyle = '#1b1712'; ctx.fillRect(Math.round(pa) - 1, C_Y + 2, 2, CROW - 4); }
            if (pb - pa > 16) {
              ctx.save(); ctx.beginPath(); ctx.rect(pa + 4, C_Y, pb - pa - 8, CROW); ctx.clip();
              ctx.fillStyle = '#1b1712'; ctx.fillText((i === 0 ? '엔딩 · ' : '') + ((pg.title || pg.sub || '(빈 문구)').replace(/\n/g, ' ')), Math.round(pa + 6), C_Y + CROW / 2);
              ctx.restore();
            }
          });
        } else if (xb - xa > 20) {
          ctx.save(); ctx.beginPath(); ctx.rect(xa + 4, C_Y, xb - xa - 8, CROW); ctx.clip();
          ctx.fillStyle = '#1b1712'; ctx.fillText((c.text || '').replace(/\n/g, ' '), Math.round(xa + 6), C_Y + CROW / 2);
          ctx.restore();
        }
      }
      label(ctx, '자막', C_Y + 4, C.text);
    }

    // 악보 줄: 악보 조각들 (조각 안에서만 카드가 보이고, 템포대로 흘러감)
    {
      ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(0, K_Y, cw, KROW);
      const list = sheetClipsOf(p, nBars), many = (live.current.sheetNames || []).length > 1;
      ctx.textBaseline = 'middle';
      for (const c of list) {
        const L = clipBarLen(p, c), nB = live.current.nBarsOf ? live.current.nBarsOf(c.sheet) : nBars;
        const xa = X(c.start), xb = X(sheetClipEnd(p, c));
        if (xb < 0 || xa > cw) continue;
        const sel = isSel('sheet:' + c.id) || selSheet.current === c.id;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(xa, K_Y + 2, Math.max(3, xb - xa), KROW - 4, 4); ctx.clip();
        ctx.fillStyle = sel ? '#dcebff' : 'rgba(190,215,250,0.78)'; ctx.fillRect(xa, K_Y, xb - xa, KROW);
        // 악보 밖(카운트인 · 끝난 뒤)은 흐리게
        const xs = X(c.start + (0 - c.barIn) * L), xe = X(c.start + (nB - c.barIn) * L);
        ctx.fillStyle = 'rgba(20,30,45,0.35)';
        if (xs > xa) ctx.fillRect(xa, K_Y, xs - xa, KROW);
        if (xe < xb) ctx.fillRect(xe, K_Y, xb - xe, KROW);
        // 악보 마디선 · 번호 (첫 마디는 파랗고 굵게)
        const step = L * view.current.pps < 22 ? (L * view.current.pps < 8 ? 8 : 4) : 1;
        ctx.font = '600 10.5px "IBM Plex Sans KR", sans-serif';
        for (let k = Math.ceil(c.barIn - 1e-6); k <= Math.floor(c.barOut + 1e-6); k++) {
          if (k < 0 || k > nB) continue;
          const x = Math.round(X(c.start + (k - c.barIn) * L)) + 0.5;
          if (x < xa - 1 || x > xb + 1 || x < -2 || x > cw + 2) continue;
          const first = k === 0;
          ctx.strokeStyle = first ? '#1f63d0' : 'rgba(23,32,43,0.4)'; ctx.lineWidth = first ? 2.5 : 1;
          ctx.beginPath(); ctx.moveTo(x, K_Y + 2); ctx.lineTo(x, K_Y + KROW - 2); ctx.stroke();
          if (k < nB && (k % step === 0 || first)) { ctx.fillStyle = first ? '#1f63d0' : 'rgba(23,32,43,0.75)'; ctx.fillText(String(k + 1), x + 3, K_Y + KROW / 2 + 0.5); }
        }
        // 악보 이름 · 템포 (악보가 여러 개이거나 템포를 정했을 때)
        if (many || c.bpm) {
          const tag = `${many ? (c.sheet || (live.current.sheetNames || [])[0] || '').replace(/\.[^.]+$/, '') : ''}${c.bpm ? ` ♩${Math.round(c.bpm * 10) / 10}` : ''}`.trim();
          ctx.font = '700 10px "IBM Plex Sans KR", sans-serif';
          const tw = Math.min(xb - xa - 6, ctx.measureText(tag).width + 8);
          if (tw > 14) { ctx.fillStyle = 'rgba(31,99,208,0.9)'; ctx.fillRect(Math.max(xa, 0) + 2, K_Y + 2, tw, 11); ctx.fillStyle = '#fff'; ctx.fillText(tag, Math.max(xa, 0) + 6, K_Y + 8, tw - 6); }
        }
        ctx.restore();
        ctx.strokeStyle = sel ? '#ffffff' : 'rgba(150,185,235,0.9)'; ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(xa + 0.5, K_Y + 2.5, Math.max(3, xb - xa - 1), KROW - 5, 4); ctx.stroke();
      }
      if (live.current.hasSheet && !list.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '500 11px "IBM Plex Sans KR", sans-serif';
        ctx.fillText('빈 곳을 더블클릭하면 그 자리에 악보를 다시 넣어요', 80, K_Y + KROW / 2);
      }
      label(ctx, '악보', K_Y + 4, C.text);
    }

    // 효과 줄
    {
      const fx = getFx(p), sf = live.current.selFx;
      ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(0, F_Y, cw, FROW);
      ctx.font = '600 11.5px "IBM Plex Sans KR", sans-serif'; ctx.textBaseline = 'middle';
      for (const z of fx.zooms) {
        const xa = X(z.start), xb = X(z.end);
        if (xb < 0 || xa > cw) continue;
        const sel = isSel('zoom:' + z.id) || (sf?.kind === 'zoom' && sf.id === z.id);
        const g = ctx.createLinearGradient(xa, 0, xb, 0);
        g.addColorStop(0, 'rgba(179,146,255,0.45)'); g.addColorStop(1, 'rgba(179,146,255,0.95)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.roundRect(xa, F_Y + 3, Math.max(3, xb - xa), FROW - 6, 4); ctx.fill();
        if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (xb - xa > 60) { ctx.fillStyle = '#1a1328'; ctx.fillText(`확대 ${Math.round(z.from * 100)}→${Math.round(z.to * 100)}%`, Math.round(xa + 6), F_Y + FROW / 2); }
      }
      for (const pu of fx.punches) {
        const x = X(pu.t);
        if (x < -8 || x > cw + 8) continue;
        const sel = isSel('punch:' + pu.id) || (sf?.kind === 'punch' && sf.id === pu.id);
        const k = markKind(pu), cy = F_Y + LANE[k], r = sel ? 6 : 4.5;
        if (sel) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 0.5, F_Y); ctx.lineTo(x + 0.5, F_Y + FROW); ctx.stroke(); }
        if (k === 'punch') {         // 주황 마름모
          ctx.fillStyle = sel ? '#fff' : '#ff8a1f';
          ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x + r, cy); ctx.lineTo(x, cy + r); ctx.lineTo(x - r, cy); ctx.closePath(); ctx.fill();
        } else if (k === 'flash') {  // 노란 별빛
          ctx.fillStyle = sel ? '#fff' : '#ffe14d';
          ctx.beginPath();
          for (let j = 0; j < 8; j++) { const a = j * Math.PI / 4, rr = j % 2 ? r * 0.45 : r * 1.15; ctx.lineTo(x + Math.sin(a) * rr, cy - Math.cos(a) * rr); }
          ctx.closePath(); ctx.fill();
        } else {                     // 청록 지그재그
          ctx.strokeStyle = sel ? '#fff' : '#56c2b4'; ctx.lineWidth = sel ? 2.2 : 1.8; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(x - r * 1.2, cy);
          ctx.lineTo(x - r * 0.6, cy - r * 0.8); ctx.lineTo(x, cy + r * 0.8); ctx.lineTo(x + r * 0.6, cy - r * 0.8); ctx.lineTo(x + r * 1.2, cy);
          ctx.stroke();
        }
      }
      label(ctx, '효과', F_Y + 4, C.text);
    }

    // 파형 줄: 기준 영상 조각들 → 앵글들 → 녹음본 (앵글·녹음본은 기준 영상 조각에 붙어서 같이 움직임)
    const clips = clipsOf(p, live.current.srcDur);
    const rows: { id: string; tr: Track | null; col: string; name: string; muted: boolean; off: number }[] = [
      { id: 'main', tr: vTrack || silentTrack(live.current.srcDur) || (clips.length ? silentTrack(1) : null), col: C.vWave, name: '영상', muted: p.videoMuted, off: 0 },
      ...angleTracks.map(a => ({ id: a.id, tr: a.track, col: a.color, name: `${a.num}번 앵글`, muted: false, off: a.offset })),
      { id: 'rec', tr: rTrack, col: C.rWave, name: '녹음본', muted: p.recMuted, off: 0 },
    ];
    rows.forEach((r, i) => {
      const y = ROWS_Y + i * (ROW + GAP);
      if (y + ROW < sy || y > sy + visH) return;
      const sel = live.current.selected === r.id;
      ctx.fillStyle = sel ? hexA(r.col, 0.1) : 'rgba(255,255,255,0.025)'; ctx.fillRect(0, y, cw, ROW);
      if (r.tr) {
        const recAt = live.current.recAt;
        // 녹음본은 타임라인에 붙어 있는 한 덩어리 · 영상 줄은 조각마다 그 영상 파일 · 앵글은 첫 영상 조각에만
        // 녹음본 줄: 첫 녹음본 + 추가 녹음본들 (각자 타임라인에 붙은 한 덩어리, 줄이기는 녹음본마다)
        const recX = r.id === 'rec' ? (live.current.recExtras || []) : [];
        const segs: Clip[] = r.id === 'rec' ? [{ id: 'rec', start: recAt, srcIn: 0, srcOut: r.tr.duration },
          ...recX.map(x => ({ id: x.key, start: x.at, srcIn: 0, srcOut: x.dur || x.track?.duration || 1 }))] : r.id === 'main' ? clips : clips.filter(c => !c.src);
        for (const c of segs) {
          const rx = r.id === 'rec' && c.id !== 'rec' ? recX.find(x => x.key === c.id) : undefined;
          const ctr = r.id === 'main' ? ((live.current.srcTrackOf ? live.current.srcTrackOf(c.src) : null) || (c.src ? silentTrack(live.current.srcDurOf?.(c.src) || 1) : r.tr))
            : rx ? (rx.track || silentTrack(rx.dur || 1)) : r.tr;
          if (!ctr) continue;
          const dur = ctr.duration, tr = r.id === 'main' ? { in: 0, out: 1e9 } : trimOf(p, rx ? c.id : r.id, dur);
          const xa = X(c.start), xb = X(clipEnd(c));
          if (xb < 0 || xa > cw) continue;
          const shift = c.start - c.srcIn;              // 타임라인 = 영상 시간 + shift
          // 이 조각 안에서 이 트랙이 실제로 소리·화면이 있는 범위 (파일 시간 → 타임라인)
          const fa = Math.max(c.start, tr.in - r.off + shift, -r.off + shift), fb = Math.min(clipEnd(c), tr.out - r.off + shift, dur - r.off + shift);
          if (fb <= fa) continue;
          const pa = X(fa), pb = X(fb);
          const selClip = (r.id === 'main' && (isSel('clip:' + c.id) || selClipRef.current === c.id)) || (r.id === 'rec' && (isSel('rec:' + c.id) || (sel && selRecRef.current === c.id)));
          // 조각 상자
          ctx.fillStyle = hexA(r.col, selClip ? 0.28 : 0.13);
          ctx.beginPath(); ctx.roundRect(pa, y + 1.5, Math.max(2, pb - pa), ROW - 3, 5); ctx.fill();
          // 파형
          ctx.save(); ctx.beginPath(); ctx.rect(pa, y, pb - pa, ROW); ctx.clip();
          ctx.globalAlpha = r.muted ? 0.25 : 0.9;
          ctx.fillStyle = r.col;
          const mid = y + ROW / 2, pk = ctr.peaks;
          for (let px = Math.max(0, Math.floor(pa)); px < Math.min(cw, Math.ceil(pb)); px++) {
            const ta = t0 + px / v.pps - shift + r.off, tb = t0 + (px + 1) / v.pps - shift + r.off;
            const ka = ta * PEAKS_RATE, kb = tb * PEAKS_RATE;
            let m = 0;
            for (let k = Math.max(0, Math.floor(ka)); k < Math.min(pk.length, Math.ceil(kb)); k++) if (pk[k] > m) m = pk[k];
            if (m > 0.004) { const hh = Math.max(1, m * (ROW / 2 - 4)); ctx.fillRect(px, mid - hh, 1, hh * 2); }
          }
          ctx.restore();
          ctx.globalAlpha = 1;
          // 페이드 (녹음본 조각 · 영상 조각): 어둡게 덮은 삼각형 + 위쪽 손잡이 (끌어서 길이 조절)
          if (r.id === 'rec' || r.id === 'main') {
            const key = r.id === 'main' ? 'clip:' + c.id : rx ? c.id : 'rec', f = fadeFor(key, fb - fa);
            const top = y + 1.5, bot = y + ROW - 1.5, xi = X(fa + f.in), xo = X(fb - f.out);
            ctx.save(); ctx.beginPath(); ctx.roundRect(pa, top, Math.max(2, pb - pa), ROW - 3, 5); ctx.clip();
            ctx.fillStyle = 'rgba(10,8,6,0.55)'; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
            if (f.in > 0) { ctx.beginPath(); ctx.moveTo(pa, top); ctx.lineTo(xi, top); ctx.lineTo(pa, bot); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(pa, bot); ctx.lineTo(xi, top); ctx.stroke(); }
            if (f.out > 0) { ctx.beginPath(); ctx.moveTo(pb, top); ctx.lineTo(xo, top); ctx.lineTo(pb, bot); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(pb, bot); ctx.lineTo(xo, top); ctx.stroke(); }
            ctx.restore();
            const hotF = fadeHover.current?.key === key ? fadeHover.current.edge : null;
            if (selClip || hotF || f.in > 0 || f.out > 0) for (const [hx, ed] of [[xi, 'in'], [xo, 'out']] as [number, 'in' | 'out'][]) {
              if (hx < -6 || hx > cw + 6) continue;
              ctx.fillStyle = hotF === ed ? '#fff' : selClip ? '#ffe2b8' : 'rgba(255,226,184,0.7)';
              ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.rect(Math.round(hx) - 4, top + 1, 8, 8); ctx.fill(); ctx.stroke();
            }
          }
          // 테두리 · 양쪽 손잡이
          const hot = clipHover.current && clipHover.current.id === r.id && clipHover.current.clip === c.id;
          ctx.strokeStyle = selClip ? '#fff' : hexA(r.col, sel || hot ? 0.95 : 0.55); ctx.lineWidth = selClip ? 2 : sel || hot ? 1.5 : 1;
          ctx.beginPath(); ctx.roundRect(pa + 0.5, y + 1.5, Math.max(2, pb - pa - 1), ROW - 3, 5); ctx.stroke();
          for (const [ex, side] of [[pa, 1], [pb, -1]] as [number, number][]) {
            if (ex < -8 || ex > cw + 8) continue;
            const on = hot && clipHover.current!.edge === (side > 0 ? 'in' : 'out');
            ctx.fillStyle = on ? '#fff' : hexA(r.col, sel || selClip ? 0.95 : 0.65);
            ctx.beginPath(); ctx.roundRect(side > 0 ? ex : ex - 6, y + 8, 6, ROW - 16, 3); ctx.fill();
          }
          // 영상·녹음본이 여러 개면 조각 위에 파일 이름
          if (((r.id === 'main' && live.current.srcLabelOf) || (r.id === 'rec' && recX.length)) && pb - pa > 40) {
            const nm = r.id === 'rec' ? (rx ? rx.name : (live.current.recName || '')) : live.current.srcLabelOf!(c.src);
            if (nm) { ctx.font = '600 10px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textBaseline = 'top'; ctx.fillText(nm, Math.max(pa, 0) + 8, y + ROW - 14, pb - pa - 14); ctx.textBaseline = 'middle'; }
          }
        }
      }
      label(ctx, r.tr ? (r.muted ? `${r.name} · 꺼짐` : r.name) : `${r.name} 없음`, y + 5, r.tr ? r.col : C.dim, sel);
      if (sel) { ctx.fillStyle = r.col; ctx.fillRect(0, y, 4, ROW); }
    });
    ctx.restore();

    // ---- 눈금 (고정) ----
    ctx.fillStyle = C.ruler; ctx.fillRect(0, 0, cw, RULER);
    if (nBars > 0) { const a = X(sheetStart(p, nBars)), b = X(sheetEnd(p, nBars)); ctx.fillStyle = C.accentSoft; ctx.fillRect(a, 0, b - a, RULER); }
    let every = 1;
    while (barPx * every < 26) every *= 2;
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let n = n0; n <= n1; n++) {
      const x = Math.round(X(barStart(p, n))) + 0.5;
      ctx.strokeStyle = n === 1 ? C.accent : C.gridBar; ctx.lineWidth = n === 1 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, RULER); ctx.stroke();
      if (((n % every) + every) % every === 0 || n === 1) {
        ctx.fillStyle = nBars === 0 || (n >= firstBar && n <= lastBar) ? C.text : C.dim;
        ctx.fillText(n === 0 ? '-1' : String(n), Math.round(x + 4), CY_H + (RULER - CY_H) / 2);
      }
    }
    { const x = X(p.anchorTime); ctx.fillStyle = C.accent; ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, RULER - 1, cw, 1);

    // 세로 스크롤 막대
    if (maxScroll > 0) {
      const th = Math.max(20, visH * visH / contentH), ty = RULER + (visH - th) * (sy / maxScroll);
      ctx.fillStyle = 'rgba(236,230,218,0.25)';
      ctx.beginPath(); ctx.roundRect(cw - 6, ty + 2, 4, th - 4, 2); ctx.fill();
    }

    // 추출 구간 고르기
    if (live.current.pick) {
      const { a, b } = live.current.pick;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, cw, H);
      if (a !== null && b !== null && b > a) {
        ctx.fillStyle = 'rgba(255,138,31,0.16)'; ctx.fillRect(X(a), 0, X(b) - X(a), H);
        for (const tm of [a, b]) {
          const x = Math.round(X(tm)) + 0.5;
          ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
          ctx.fillStyle = C.accent; ctx.fillRect(x - 4, RULER / 2 - 8, 8, 16);
        }
      }
    }

    // 넣을 구간 (I/O)
    {
      const { a, b } = live.current.inOut;
      ctx.fillStyle = 'rgba(58,209,192,0.9)';
      if (a !== null && b !== null && b > a) { ctx.fillStyle = 'rgba(58,209,192,0.13)'; ctx.fillRect(X(a), 0, X(b) - X(a), H); }
      for (const [tm, tag] of [[a, 'I'], [b, 'O']] as [number | null, string][]) {
        if (tm === null) continue;
        const x = Math.round(X(tm)) + 0.5;
        ctx.strokeStyle = '#3ad1c0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillStyle = '#3ad1c0'; ctx.fillRect(tag === 'I' ? x : x - 14, RULER - 14, 14, 14);
        ctx.fillStyle = '#10201e'; ctx.font = '700 10px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
        ctx.fillText(tag, (tag === 'I' ? x : x - 14) + 4, RULER - 7);
      }
    }

    // 구간 반복 (눈금 줄 위 노란 띠 + 바깥은 살짝 어둡게)
    {
      const cy = p.cycle;
      ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(0, 0, cw, CY_H);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, CY_H, cw, 1);
      if (cy && cy.end > cy.start) {
        const xa = X(cy.start), xb = X(cy.end);
        if (cy.on) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, RULER, Math.max(0, xa), H - RULER); ctx.fillRect(xb, RULER, cw - xb, H - RULER); }
        ctx.fillStyle = cy.on ? '#f2c94c' : 'rgba(242,201,76,0.35)';
        ctx.beginPath(); ctx.roundRect(xa, 1, Math.max(2, xb - xa), 10, 3); ctx.fill();
        ctx.fillStyle = cy.on ? 'rgba(242,201,76,0.9)' : 'rgba(242,201,76,0.35)'; ctx.fillRect(xa - 1, 0, 2, RULER); ctx.fillRect(xb - 1, 0, 2, RULER);
      }
    }
    // 1마디 시작 손잡이 (끌어서 마디 눈금 전체 이동)
    {
      const ax = Math.round(X(barStart(p, handleBar()))) + 0.5;
      if (ax > -10 && ax < cw + 10) {
        ctx.fillStyle = gridDrag.current ? '#fff' : C.accent;
        ctx.beginPath(); ctx.moveTo(ax - 5, 1); ctx.lineTo(ax + 5, 1); ctx.lineTo(ax + 5, 9); ctx.lineTo(ax, 14); ctx.lineTo(ax - 5, 9); ctx.closePath(); ctx.fill();
      }
    }
    // 끌어서 고르는 네모
    if (marquee.current) {
      const m = marquee.current, r = canvas.current!.getBoundingClientRect();
      const x = Math.min(m.x0, m.x1) - r.left, y = Math.min(m.y0, m.y1) - r.top, w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      ctx.fillStyle = 'rgba(255,138,31,0.12)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,138,31,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
    }
    if ((allSel.current || msel.current.size > 0) && !tip.current) {
      // 전체·여러 개 선택 중 안내
      const txt = allSel.current ? '전체 선택됨 · 아무거나 끌면 같이 이동 · Esc 해제' : `${msel.current.size}개 선택됨 · 끌면 같이 이동 · Delete 지우기 · Esc 해제`;
      ctx.font = '600 12px "IBM Plex Sans KR", sans-serif'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(txt).width + 16;
      ctx.fillStyle = 'rgba(255,138,31,0.92)'; ctx.beginPath(); ctx.roundRect(cw - tw - 8, RULER + 4, tw, 22, 5); ctx.fill();
      ctx.fillStyle = '#1a1814'; ctx.fillText(txt, cw - tw, RULER + 15);
    }
    if (tip.current) {
      ctx.font = '600 12px "IBM Plex Sans KR", "IBM Plex Mono", sans-serif'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(tip.current.text).width + 14;
      const r = canvas.current!.getBoundingClientRect(), tx = Math.min(cw - tw - 4, Math.max(4, tip.current.x - r.left + 10));
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.beginPath(); ctx.roundRect(tx, RULER + 4, tw, 22, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(tip.current.text, tx + 7, RULER + 15);
    }

    // 재생 위치
    const hx = Math.round(X(t)) + 0.5;
    ctx.strokeStyle = C.head; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke();
    ctx.fillStyle = C.head;
    ctx.beginPath(); ctx.moveTo(hx - 5, RULER - 8); ctx.lineTo(hx + 5, RULER - 8); ctx.lineTo(hx, RULER - 1); ctx.closePath(); ctx.fill();
  };

  const timeAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return view.current.start + (clientX - r.left) / view.current.pps;
  };

  /** 마디선 자석: 마디선 10px 안이면 마디 시작에, 확대해서 박 간격이 넓으면 박선 5px 안에도 붙는다 (Alt 누르면 끔) */
  // 끌어서 편집할 때 박자 단위로 딱딱 맞춤 (Alt를 누르면 자유롭게)
  /** 자석 간격: 확대할수록 잘게 (마디 → 박 → 8분 → 16분 → 32분), 칸 사이가 화면에서 14px 이상이 되는 가장 작은 단위 */
  const snapUnit = () => {
    const p = live.current.project, pps = view.current.pps, bt = beatLen(p);
    for (const u of [bt / 8, bt / 4, bt / 2, bt]) if (u * pps >= 14) return u;
    return bt * pps >= 6 ? bt : barLen(p);
  };
  const unitName = (u: number) => {
    const bt = beatLen(live.current.project), k = Math.round(bt / u);
    return k >= 8 ? '32분' : k >= 4 ? '16분' : k >= 2 ? '8분' : u > bt * 1.5 ? '마디' : '박';
  };
  /** 옮긴 양을 '+1¼박'처럼 */
  const beatsText = (dt: number) => {
    const bt = beatLen(live.current.project), q = Math.round(dt / bt * 8) / 8, sg = q >= 0 ? '+' : '−', a = Math.abs(q);
    const w = Math.floor(a + 1e-9), f = Math.round((a - w) * 8);
    const fr = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'][f];
    return `${sg}${w || !fr ? w : ''}${fr}박`;
  };
  const magnet = (t: number, alt: boolean) => {
    if (alt) return t;
    // 마디 번호 단위로 반올림 → 템포가 바뀌는 곳에서도 그 구간의 박에 붙음
    const p = live.current.project, ub = snapUnit() / barLen(p), b = barAt(p, t) - p.anchorBar;
    return barStart(p, Math.max(-1, Math.round(b / ub) * ub) + p.anchorBar);
  };
  // 재생 위치 이동은 박자 근처에서만 살짝 붙음
  const softSnap = (t: number, alt: boolean) => {
    if (alt) return t;
    const p = live.current.project, pps = view.current.pps, bt = beatLen(p);
    if (bt * pps < 12) return t;
    const nbt = snapTime(p, t, 'beat');
    return Math.abs(nbt - t) * pps <= 5 ? nbt : t;
  };
  const seekAt = (e: React.PointerEvent) => {
    const d = live.current.duration || 0;
    props.onSeek(Math.max(0, Math.min(d, softSnap(timeAt(e.clientX), e.altKey))));
  };

  const cutNear = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const y = e.clientY - r.top - RULER + scrollY.current, x = e.clientX - r.left;
    if (e.clientY - r.top < RULER || y < A_Y - 4 || y > A_Y + AROW + 4) return -1;
    const v = view.current;
    let best = -1, bd = 7;
    props.project.cuts.forEach((c, i) => { const d = Math.abs((c.t - v.start) * v.pps - x); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  const capItems = (): CapItem[] => {
    const p = live.current.project, fx = getFx(p), d = live.current.duration || 0;
    const out: CapItem[] = [];
    for (const k of ['intro', 'outro'] as const) {
      if (!fx[k].on) continue;
      const [a, b] = cardSpan(fx, k, 0, d);
      out.push({ id: '__' + k, start: a, end: b, text: (k === 'intro' ? '인트로' : '엔딩') + (fx[k].title ? ' · ' + fx[k].title.replace(/\n/g, ' ') : ''), card: k });
    }
    return [...out, ...(p.captions || [])];
  };
  const pickDrag = useRef<{ fixed: number } | null>(null);
  // 싱크 맞추기 · 마디 눈금 · 자르기
  const slipDrag = useRef<{ id: string; x0: number; off0: number; moved: boolean; live: number } | null>(null);
  const gridDrag = useRef<{ mode: 'anchor' | 'bpm'; n: number; x0: number; anchor0: number; bpm0: number } | null>(null);
  const [cutMode, setCutModeS] = useState(false);
  const cutModeRef = useRef(false);
  const setCutMode = (v: boolean) => { cutModeRef.current = v; setCutModeS(v); };
  const cutDrag = useRef<{ fixed: number; a: number; b: number } | null>(null);
  const skipDrag = useRef<{ id: string; edge: 'start' | 'end' } | null>(null);
  const selSkip = useRef<string | null>(null);
  const tip = useRef<{ text: string; x: number } | null>(null);
  // 기준 영상 잡고 끌기: 영상·녹음본·앵글 전체를 마디 눈금에 대해 박자 단위로 옮김
  const mainDrag = useRef<{ x0: number; anchor0: number; start0: number; moved: boolean; q: number } | null>(null);
  const trimDrag = useRef<{ id: string; edge: 'in' | 'out'; off: number; dur: number; shift: number } | null>(null);
  const clipHover = useRef<{ id: string; edge: 'in' | 'out'; clip: string } | null>(null);
  const selClipRef = useRef<string | null>(null);                    // 고른 기준 영상 조각
  const pickClip = (c: Clip | null) => { selClipRef.current = c ? c.id : null; live.current.onSelectClip?.(c); };
  const clipMove = useRef<{ id: string; x0: number; start0: number; moved: boolean } | null>(null);
  const clipTrim = useRef<{ id: string; edge: 'in' | 'out' } | null>(null);
  const rulerDown = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);
  const cycleDrag = useRef<{ mode: 'start' | 'end' | 'move'; grab: number; c0: { start: number; end: number; on: boolean }; x0: number; moved: boolean } | null>(null);
  /** 파형 줄의 트랙 정보 (오프셋 · 파일 길이) */
  const clipInfo = (id: string) => {
    const p = live.current;
    if (id === 'main') return p.vTrack ? { off: 0, dur: p.vTrack.duration } : p.srcDur ? { off: 0, dur: p.srcDur } : null;
    if (id === 'rec') return p.rTrack ? { off: 0, dur: p.rTrack.duration } : null;
    const a = p.angleTracks.find(x => x.id === id);
    return a?.track ? { off: a.offset, dur: a.track.duration } : null;
  };
  /** 마우스 아래 기준 영상 조각 */
  const clipUnder = (clientX: number) => {
    const t = timeAt(clientX);
    let hit: Clip | null = null;
    for (const c of clipsOf(live.current.project, live.current.srcDur)) if (t >= c.start && t < clipEnd(c)) hit = c;
    return hit;
  };
  /** 조각(또는 녹음본·앵글이 쓰는 부분)의 양 끝 근처인지 */
  const clipEdgeAt = (clientX: number, clientY: number) => {
    const id = rowAt(clientY); if (!id) return null;
    const ci = clipInfo(id); if (!ci) return null;
    const r = canvas.current!.getBoundingClientRect(), x = clientX - r.left, v = view.current, p = live.current.project;
    const tx = (t: number) => (t - v.start) * v.pps;
    if (id === 'rec') {
      // 추가 녹음본 먼저 (위에 그려짐)
      for (const rx of [...(live.current.recExtras || [])].reverse()) {
        const dur = rx.dur || rx.track?.duration || 0; if (!dur) continue;
        const key = rx.key, tr = trimOf(p, key, dur), clip = { id: key, start: rx.at, srcIn: 0, srcOut: dur };
        if (tr.out - tr.in < 0.01) continue;
        const a = rx.at + tr.in, b = rx.at + tr.out;
        if (x >= tx(a) - 3 && x <= tx(a) + 9) return { id: key, edge: 'in' as const, clip, off: 0, dur };
        if (x >= tx(b) - 9 && x <= tx(b) + 3) return { id: key, edge: 'out' as const, clip, off: 0, dur };
      }
      // 녹음본은 타임라인에 붙은 한 덩어리
      const recAt = live.current.recAt, tr = trimOf(p, 'rec', ci.dur), clip = { id: 'rec', start: recAt, srcIn: 0, srcOut: ci.dur };
      const a = recAt + tr.in, b = recAt + tr.out;
      if (b - a < 0.01) return null;   // 지운 조각
      if (x >= tx(a) - 3 && x <= tx(a) + 9) return { id, edge: 'in' as const, clip, ...ci };
      if (x >= tx(b) - 9 && x <= tx(b) + 3) return { id, edge: 'out' as const, clip, ...ci };
      return null;
    }
    for (const c of clipsOf(p, live.current.srcDur)) {
      if (id !== 'main' && c.src) continue;   // 앵글은 첫 영상 조각에만
      let a = c.start, b = clipEnd(c);
      if (id !== 'main') {
        const sh = c.start - c.srcIn, tr = trimOf(p, id, ci.dur);
        a = Math.max(a, tr.in - ci.off + sh, -ci.off + sh); b = Math.min(b, tr.out - ci.off + sh, ci.dur - ci.off + sh);
        if (b <= a) continue;
      }
      if (x >= tx(a) - 3 && x <= tx(a) + 9) return { id, edge: 'in' as const, clip: c, ...ci };
      if (x >= tx(b) - 9 && x <= tx(b) + 3) return { id, edge: 'out' as const, clip: c, ...ci };
    }
    return null;
  };
  const skipAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect(), x = clientX - r.left, v = view.current;
    for (const k of live.current.project.skips || []) {
      const xa = (k.start - v.start) * v.pps, xb = (k.end - v.start) * v.pps;
      if (x >= xa - 5 && x <= xb + 5) return { k, edge: (Math.abs(x - xa) <= 6 ? 'start' : Math.abs(x - xb) <= 6 ? 'end' : null) as 'start' | 'end' | null };
    }
    return null;
  };
  /** 눈금 줄에서 마디선 근처인지 (n = 마디 번호) */
  /** 끌어서 눈금 전체를 옮기는 손잡이 마디: 영상 안에 들어오는 첫 마디 */
  const handleBar = () => { const p = live.current.project; return Math.max(p.anchorBar - 1, Math.ceil(barAt(p, 0) - 1e-6)); };
  const barLineNear = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect(), x = clientX - r.left, v = view.current, p = live.current.project;
    const n = Math.round(barAt(p, timeAt(clientX)));
    const bx = (barStart(p, n) - v.start) * v.pps;
    return Math.abs(bx - x) <= 6 ? n : null;
  };
  const selSheet = useRef<string | null>(null);
  const fadeDrag = useRef<{ key: string; edge: 'in' | 'out'; a: number; b: number } | null>(null);
  const fadeHover = useRef<{ key: string; edge: 'in' | 'out' } | null>(null);
  /** 녹음본 조각들의 타임라인 범위 (위에 그려진 것부터) */
  const recPieces = () => {
    const p = live.current.project, out: { key: string; a: number; b: number }[] = [];
    for (const rx of [...(live.current.recExtras || [])].reverse()) {
      const dur = rx.dur || rx.track?.duration || 0; if (!dur) continue;
      const tr = trimOf(p, rx.key, dur); if (tr.out - tr.in > 0.01) out.push({ key: rx.key, a: rx.at + tr.in, b: rx.at + tr.out });
    }
    if (live.current.rTrack) { const tr = trimOf(p, 'rec', live.current.rTrack.duration), at = live.current.recAt; if (tr.out - tr.in > 0.01) out.push({ key: 'rec', a: at + tr.in, b: at + tr.out }); }
    return out;
  };
  /** 영상 조각들의 타임라인 범위 (키 'clip:id', 위에 그려진 것부터) */
  const clipPieces = () => clipsOf(live.current.project, live.current.srcDur).map(c => ({ key: 'clip:' + c.id, a: c.start, b: clipEnd(c) })).reverse();
  /** 페이드 값: 영상 조각은 조각에 저장, 녹음본은 recFades */
  const fadeFor = (key: string, len: number): Fade => {
    const p = live.current.project;
    if (key.startsWith('clip:')) { const c = clipsOf(p, live.current.srcDur).find(x => x.id === key.slice(5)); return c ? clipFade(c) : { in: 0, out: 0 }; }
    return fadeOf(p, key, len);
  };
  /** 녹음본·영상 조각 위쪽의 페이드 손잡이 근처인지 */
  const fadeHandleAt = (clientX: number, clientY: number) => {
    const row = trackAt(clientY);
    if (!live.current.onFade || (row !== 'rec' && row !== 'main')) return null;
    if (row === 'main' && !(live.current.vTrack || live.current.srcDur)) return null;
    const r = canvas.current!.getBoundingClientRect(), v = view.current;
    const i = row === 'main' ? 0 : 1 + live.current.angleTracks.length, top = RULER + ROWS_Y + i * (ROW + GAP) - scrollY.current;
    const yy = clientY - r.top - top;
    if (yy < 0 || yy > 13) return null;
    const x = clientX - r.left, tx = (t: number) => (t - v.start) * v.pps;
    // 맞닿은 조각 경계에서는 지금 고른 조각의 손잡이를 먼저
    const selKey = row === 'main' ? (selClipRef.current ? 'clip:' + selClipRef.current : null) : selRecRef.current;
    const list = row === 'main' ? clipPieces() : recPieces();
    list.sort((a, b) => (b.key === selKey ? 1 : 0) - (a.key === selKey ? 1 : 0));
    for (const pc of list) {
      const f = fadeFor(pc.key, pc.b - pc.a);
      if (Math.abs(x - tx(pc.a + f.in)) <= 7 && x >= tx(pc.a) - 2) return { ...pc, edge: 'in' as const };
      if (Math.abs(x - tx(pc.b - f.out)) <= 7 && x <= tx(pc.b) + 2) return { ...pc, edge: 'out' as const };
    }
    return null;
  };
  const selRecRef = useRef<string | null>(null);   // 고른 녹음본 조각 ('rec' = 첫 녹음본 · 'recx:…' = 추가 녹음본·잘라낸 조각)
  // 전체 선택: 자막·효과·악보·기준 영상 조각·앵글 전환점·인트로/엔딩을 한꺼번에 박 단위로 옮김
  const allSel = useRef(false);
  // 여러 개 선택 (끌어서 네모로 고르기 · Ctrl/Cmd+클릭): 'cap:id' · 'sheet:id' · 'zoom:id' · 'punch:id' · 'clip:id' · 'rec:rec' · 'rec:recx:…'
  const msel = useRef<Set<string>>(new Set());
  const marquee = useRef<{ x0: number; y0: number; x1: number; y1: number; base: Set<string> } | null>(null);
  const isSel = (k: string) => allSel.current || msel.current.has(k);
  const groupDrag = useRef<{ x0: number; P0: Project; moved: boolean; sel?: Set<string> } | null>(null);
  /** 전체(sel 없음) 또는 고른 것들(sel)을 q초만큼 옮기는 변경 */
  const groupPatch = (P0: Project, q0: number, sel?: Set<string>): { patch: Partial<Project>; q: number } => {
    const lp = live.current, fx = getFx(P0), dur = lp.duration || 0;
    const has = (k: string) => !sel || sel.has(k);
    const card = (k: 'intro' | 'outro') => !sel && fx[k].on ? cardSpan(fx, k, 0, dur)[0] : Infinity;
    // 0초보다 앞으로는 못 감 (자막·효과·카드 기준)
    const mins = [...(P0.captions || []).filter(c => has('cap:' + c.id)).map(c => c.start), ...fx.zooms.filter(z => has('zoom:' + z.id)).map(z => z.start),
      ...fx.punches.filter(u => has('punch:' + u.id)).map(u => u.t), card('intro'), card('outro')];
    const q = Math.max(q0, -Math.min(Infinity, ...mins.filter(v => isFinite(v))));
    const nf: Fx = { ...fx, zooms: fx.zooms.map(z => has('zoom:' + z.id) ? { ...z, start: z.start + q, end: z.end + q } : z), punches: fx.punches.map(u => has('punch:' + u.id) ? { ...u, t: u.t + q } : u) };
    if (!sel) for (const k of ['intro', 'outro'] as const) if (fx[k].on) nf[k] = { ...fx[k], at: cardSpan(fx, k, 0, dur)[0] + q };
    const patch: Partial<Project> = {
      captions: (P0.captions || []).map(c => has('cap:' + c.id) ? { ...c, start: c.start + q, end: c.end + q } : c),
      fx: nf,
    };
    if (!sel) patch.cuts = normalizeCuts(P0.cuts.map(c => ({ ...c, t: c.t <= 1e-6 ? 0 : Math.max(0, c.t + q) })));
    const cs = clipsOf(P0, lp.srcDur);
    if ((lp.vTrack || lp.srcDur) && cs.some(c => has('clip:' + c.id))) { patch.clips = cs.map(c => has('clip:' + c.id) ? { ...c, start: c.start + q } : c); patch.skips = []; }
    const ss = lp.hasSheet && lp.nBars ? sheetClipsOf(P0, lp.nBars) : [];
    if (ss.some(c => has('sheet:' + c.id))) patch.sheetClips = ss.map(c => has('sheet:' + c.id) ? { ...c, start: c.start + q } : c);
    // 녹음본도 같이 (영상과 싱크가 어긋나지 않게)
    if (lp.rTrack && typeof P0.recAt === 'number' && has('rec:rec')) patch.recAt = P0.recAt + q;
    if (P0.recClips?.some(c => has('rec:' + recKeyOf(c)))) patch.recClips = P0.recClips.map(c => has('rec:' + recKeyOf(c)) ? { ...c, at: c.at + q } : c);
    return { patch, q };
  };
  /** 누른 곳의 요소 키 (여러 개 선택용) */
  const itemKeyAt = (clientX: number, clientY: number): string | null => {
    const tr = trackAt(clientY), lp = live.current;
    if (tr === 'captions') { const h = captionAt(clientX); return h && !h.c.card ? 'cap:' + h.c.id : null; }
    if (tr === 'sheetcard') { const h = sheetAt(clientX); return h ? 'sheet:' + h.c.id : null; }
    if (tr === 'fx') { const h = fxAt(clientX, clientY); return h ? h.kind + ':' + h.id : null; }
    if (tr === 'main') { const c = clipUnder(clientX); return c ? 'clip:' + c.id : null; }
    if (tr === 'rec') { const k = recPieceAt(clientX); return k ? 'rec:' + k : null; }
    void lp; return null;
  };
  /** 녹음본 줄에서 누른 조각 ('rec' 또는 'recx:…') */
  const recPieceAt = (clientX: number): string | null => {
    const p = live.current, t = timeAt(clientX);
    let hit: string | null = null;
    const mt = p.rTrack ? trimOf(p.project, 'rec', p.rTrack.duration) : null;
    if (mt && t >= p.recAt + mt.in && t < p.recAt + mt.out) hit = 'rec';
    for (const rx of p.recExtras || []) {
      const tr = trimOf(p.project, rx.key, rx.dur || rx.track?.duration || 0);
      if (t >= rx.at + tr.in && t < rx.at + tr.out) hit = rx.key;
    }
    return hit;
  };
  /** 지금 하나만 골라 둔 것 (Ctrl/Cmd+클릭으로 여러 개 고르기 시작할 때 같이 넣음) */
  const singleSelKey = (): string | null => {
    const lp = live.current;
    if (lp.selCaption) return 'cap:' + lp.selCaption;
    if (lp.selFx) return lp.selFx.kind + ':' + lp.selFx.id;
    if (selSheet.current) return 'sheet:' + selSheet.current;
    if (selClipRef.current && lp.selected === 'main') return 'clip:' + selClipRef.current;
    if (lp.selected === 'rec' && selRecRef.current) return 'rec:' + selRecRef.current;
    return null;
  };
  /** 네모 안에 걸친 요소들 */
  const marqueeKeys = (m: { x0: number; y0: number; x1: number; y1: number }) => {
    const lp = live.current, P = lp.project, fx = getFx(P);
    const ta = timeAt(Math.min(m.x0, m.x1)), tb = timeAt(Math.max(m.x0, m.x1));
    const rows = new Set<string>();
    for (let y = Math.min(m.y0, m.y1); y <= Math.max(m.y0, m.y1); y += 3) { const r = trackAt(y); if (r) rows.add(r); }
    const over = (a: number, b: number) => b > ta && a < tb;
    const out = new Set<string>();
    if (rows.has('captions')) for (const c of P.captions || []) if (over(c.start, c.end)) out.add('cap:' + c.id);
    if (rows.has('sheetcard') && lp.hasSheet) for (const c of sheetClipsOf(P, lp.nBars)) if (over(c.start, sheetClipEnd(P, c))) out.add('sheet:' + c.id);
    if (rows.has('fx')) {
      for (const z of fx.zooms) if (over(z.start, z.end)) out.add('zoom:' + z.id);
      for (const u of fx.punches) if (u.t >= ta && u.t <= tb) out.add('punch:' + u.id);
    }
    if (rows.has('main') && (lp.vTrack || lp.srcDur)) for (const c of clipsOf(P, lp.srcDur)) if (over(c.start, clipEnd(c))) out.add('clip:' + c.id);
    if (rows.has('rec')) {
      const mt = lp.rTrack ? trimOf(P, 'rec', lp.rTrack.duration) : null;
      if (mt && mt.out - mt.in > 0.01 && over(lp.recAt + mt.in, lp.recAt + mt.out)) out.add('rec:rec');
      for (const rx of lp.recExtras || []) { const tr = trimOf(P, rx.key, rx.dur); if (tr.out - tr.in > 0.01 && over(rx.at + tr.in, rx.at + tr.out)) out.add('rec:' + rx.key); }
    }
    return out;
  };
  /** 복사할 요소 키: 전체 선택 · 여러 개 선택 · 하나 고른 것 순 */
  const copyKeys = (): string[] => {
    const lp = live.current, P = lp.project, fx = getFx(P);
    if (allSel.current) {
      const ks = [...(P.captions || []).map(c => 'cap:' + c.id), ...fx.zooms.map(z => 'zoom:' + z.id), ...fx.punches.map(u => 'punch:' + u.id)];
      if (lp.vTrack || lp.srcDur) ks.push(...clipsOf(P, lp.srcDur).map(c => 'clip:' + c.id));
      if (lp.hasSheet) ks.push(...sheetClipsOf(P, lp.nBars).map(c => 'sheet:' + c.id));
      ks.push(...recPieces().map(x => 'rec:' + x.key));
      return ks;
    }
    if (msel.current.size) return [...msel.current];
    const one = singleSelKey();
    return one ? [one] : [];
  };
  /** 고른 요소들을 복사 (지금 모습 그대로 저장) → 복사한 개수 */
  const copySelected = (): number => {
    const lp = live.current, P = lp.project, fx = getFx(P), out: CopyItem[] = [];
    const clips = clipsOf(P, lp.srcDur), sheets = lp.hasSheet ? sheetClipsOf(P, lp.nBars) : [];
    for (const key of copyKeys()) {
      const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
      const cp = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
      if (kind === 'cap') { const c = (P.captions || []).find(x => x.id === id); if (c) out.push({ k: 'cap', v: cp(c) }); }
      else if (kind === 'zoom') { const z = fx.zooms.find(x => x.id === id); if (z) out.push({ k: 'zoom', v: cp(z) }); }
      else if (kind === 'punch') { const u = fx.punches.find(x => x.id === id); if (u) out.push({ k: 'punch', v: cp(u) }); }
      else if (kind === 'clip') { const c = clips.find(x => x.id === id); if (c) out.push({ k: 'clip', v: cp(c) }); }
      else if (kind === 'sheet') { const c = sheets.find(x => x.id === id); if (c) out.push({ k: 'sheet', v: cp(c) }); }
      else if (kind === 'rec') {
        if (id === 'rec' && lp.rTrack) out.push({ k: 'rec', src: MAIN_REC, at: lp.recAt, trim: trimOf(P, 'rec', lp.rTrack.duration), fade: P.recFades?.rec });
        else {
          const c = (P.recClips || []).find(x => recKeyOf(x) === id), rx = (lp.recExtras || []).find(x => x.key === id);
          if (c && rx) out.push({ k: 'rec', src: c.src, at: c.at, trim: trimOf(P, id, rx.dur || rx.track?.duration || 0), fade: P.recFades?.[id] });
        }
      }
    }
    if (out.length) clipboard = out;
    return out.length;
  };
  /** 복사한 요소들을 재생 위치에 붙여넣기 (여러 개면 서로 간격 그대로, 맨 앞 요소가 재생 위치에) */
  const pasteAtPlayhead = (): number => {
    const items = clipboard; if (!items?.length) return 0;
    const lp = live.current, P = lp.project, fx = getFx(P);
    const t0 = Math.min(...items.map(itemStart));
    const T = Math.max(0, lp.now());
    const dt = T - t0;
    const uid = (() => { const base = Date.now().toString(36); let n = 0; return (pre: string) => pre + base + (n++).toString(36); })();
    const keys = new Set<string>();
    const caps = [...(P.captions || [])], zooms = [...fx.zooms], punches = [...fx.punches];
    let clips: Clip[] | null = null, sheets: SheetClip[] | null = null, recClips: RecClip[] | null = null;
    const trims = { ...(P.trims || {}) }, fades = { ...(P.recFades || {}) };
    for (const it of items) {
      if (it.k === 'cap') { const id = uid('cap'); caps.push({ ...it.v, id, start: it.v.start + dt, end: it.v.end + dt }); keys.add('cap:' + id); }
      else if (it.k === 'zoom') { const id = uid('z'); zooms.push({ ...it.v, id, start: it.v.start + dt, end: it.v.end + dt }); keys.add('zoom:' + id); }
      else if (it.k === 'punch') { const id = uid('m'); punches.push({ ...it.v, id, t: it.v.t + dt }); keys.add('punch:' + id); }
      else if (it.k === 'clip') {
        if (!(lp.vTrack || lp.srcDur)) continue;
        clips = clips || clipsOf(P, lp.srcDur);
        const id = uid('c'); clips.push({ ...it.v, id, start: Math.round((it.v.start + dt) * 1000) / 1000 }); keys.add('clip:' + id);
      } else if (it.k === 'sheet') {
        if (!lp.hasSheet) continue;
        sheets = sheets || sheetClipsOf(P, lp.nBars);
        const id = uid('k'); sheets.push({ ...it.v, id, start: Math.round((it.v.start + dt) * 1000) / 1000 }); keys.add('sheet:' + id);
      } else {
        if (it.src === MAIN_REC ? !lp.rTrack : !(lp.recExtras || []).some(x => x.src === it.src)) continue;   // 그 녹음본 파일이 없으면 건너뜀
        recClips = recClips || [...(P.recClips || [])];
        const nc: RecClip = { src: it.src, at: Math.round((it.at + dt) * 1000) / 1000, id: uid('r') };
        recClips.push(nc); trims[recKeyOf(nc)] = { ...it.trim }; if (it.fade) fades[recKeyOf(nc)] = { ...it.fade };
        keys.add('rec:' + recKeyOf(nc));
      }
    }
    if (!keys.size) return 0;
    const patch: Partial<Project> = { captions: caps, fx: { ...fx, zooms, punches } };
    if (clips) { patch.clips = clips; patch.skips = []; }
    if (sheets) patch.sheetClips = sheets;
    if (recClips) { patch.recClips = recClips; patch.trims = trims; patch.recFades = fades; }
    lp.onGroup(patch);
    // 붙여넣은 것들을 골라 둠 (바로 끌어서 옮기거나 Delete로 지울 수 있게)
    allSel.current = false; selSheet.current = null; pickClip(null); selRecRef.current = null;
    lp.onSelectCaption(null); lp.onSelectFx(null);
    msel.current = keys; force(n => n + 1);
    return keys.size;
  };

  /** 고른 것들 한꺼번에 지우기 (되돌리기 한 번으로 살아남) */
  const deleteSelected = () => {
    const lp = live.current, P = lp.project, fx = getFx(P), s = msel.current;
    const patch: Partial<Project> = {
      captions: (P.captions || []).filter(c => !s.has('cap:' + c.id)),
      fx: { ...fx, zooms: fx.zooms.filter(z => !s.has('zoom:' + z.id)), punches: fx.punches.filter(u => !s.has('punch:' + u.id)) },
    };
    const cs = clipsOf(P, lp.srcDur);
    if (cs.some(c => s.has('clip:' + c.id))) { patch.clips = cs.filter(c => !s.has('clip:' + c.id)); patch.skips = []; }
    if (lp.hasSheet) { const ss = sheetClipsOf(P, lp.nBars); if (ss.some(c => s.has('sheet:' + c.id))) patch.sheetClips = ss.filter(c => !s.has('sheet:' + c.id)); }
    const trims = { ...(P.trims || {}) };
    if (P.recClips?.some(c => s.has('rec:' + recKeyOf(c)))) { for (const c of P.recClips) if (s.has('rec:' + recKeyOf(c))) delete trims[recKeyOf(c)]; patch.recClips = P.recClips.filter(c => !s.has('rec:' + recKeyOf(c))); patch.trims = trims; }
    if (s.has('rec:rec') && lp.rTrack) { const t = trimOf(P, 'rec', lp.rTrack.duration); trims.rec = { in: t.out, out: t.out }; patch.trims = trims; }
    lp.onGroup(patch);
    lp.onSelectCaption(null); lp.onSelectFx(null); selSheet.current = null; pickClip(null); selRecRef.current = null;
    flashTip(`${s.size}개를 지웠어요 · 되돌리기 Ctrl/Cmd+Z`);
    msel.current = new Set(); force(n => n + 1);
  };
  const sheetMove = useRef<{ id: string; x0: number; start0: number; moved: boolean } | null>(null);
  const sheetTrim = useRef<{ id: string; edge: 'in' | 'out' } | null>(null);
  const sheetAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = clientX - r.left, v = view.current, P = live.current.project;
    const list = sheetClipsOf(P, live.current.nBars);
    // 양 끝 먼저 (붙어 있는 조각 사이에서도 손잡이를 잡을 수 있게)
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i], xa = (c.start - v.start) * v.pps, xb = (sheetClipEnd(P, c) - v.start) * v.pps;
      if (Math.abs(x - xb) <= 6 && x <= xb + 6) return { c, mode: 'out' as const };
      if (Math.abs(x - xa) <= 6) return { c, mode: 'in' as const };
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i], xa = (c.start - v.start) * v.pps, xb = (sheetClipEnd(P, c) - v.start) * v.pps;
      if (x > xa && x < xb) return { c, mode: 'move' as const };
    }
    return null;
  };
  /** 재생 위치에서 자르기: 악보 구간을 골랐으면 그것, 아니면 기준 영상 조각 */
  /** 재생 위치에 잠깐 안내 글씨 (무엇을 잘랐는지 · 왜 안 잘렸는지) */
  const flashTip = (text: string) => {
    const v = view.current, r = canvas.current?.getBoundingClientRect();
    const tp = { text, x: (r?.left || 0) + (live.current.now() - v.start) * v.pps };
    tip.current = tp;
    setTimeout(() => { if (tip.current === tp) tip.current = null; }, 1400);
  };
  const splitAtPlayhead = () => {
    const lp = live.current, t = lp.now();
    if (selSheet.current) {
      const list = sheetClipsOf(lp.project, lp.nBars), c = list.find(x => x.id === selSheet.current);
      const L = c ? clipBarLen(lp.project, c) : barLen(lp.project);
      if (c && t > c.start + 0.05 && t < sheetClipEnd(lp.project, c) - 0.05) {
        const xb = c.barIn + (t - c.start) / L, id2 = 'k' + Date.now().toString(36);
        lp.onSheetClips(list.flatMap(x => x.id === c.id ? [{ ...x, barOut: xb }, { ...x, id: id2, start: t, barIn: xb }] : [x]));
        selSheet.current = id2;
        flashTip('악보를 잘랐어요 · 영상을 자르려면 기준 영상 줄을 한 번 누른 뒤 I');
        return;
      }
      selSheet.current = null;   // 고른 악보 조각 밖이면 기준 영상을 자름
    }
    // 녹음본 줄을 고른 상태면 녹음본을 자름
    if (lp.selected === 'rec' && lp.onSplitRec) {
      const k = lp.onSplitRec(t, selRecRef.current);
      if (k) { selRecRef.current = k; flashTip('녹음본을 잘랐어요 · 조각을 끌어서 옮기거나 Delete로 지울 수 있어요'); }
      else flashTip('재생 위치에 녹음본이 없어요 (또는 이미 조각 경계예요)');
      return;
    }
    const cs = clipsOf(lp.project, lp.srcDur);
    let c: Clip | null = null; for (const x of cs) if (t > x.start + 0.05 && t < clipEnd(x) - 0.05) c = x;
    if (!c) {
      const edge = cs.some(x => Math.abs(t - x.start) <= 0.05 || Math.abs(t - clipEnd(x)) <= 0.05);
      flashTip(edge ? '이미 조각 경계예요' : '재생 위치에 영상이 없어요');
      return;
    }
    const cut = c.srcIn + (t - c.start), id2 = 'c' + Date.now().toString(36);
    lp.onClips(cs.flatMap(x => x.id === c!.id ? [{ ...x, srcOut: cut }, { id: id2, start: t, srcIn: cut, srcOut: x.srcOut }] : [x]));
    selClipRef.current = id2;
  };
  // 고른 악보 구간은 Delete로 지움
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // 글자를 치는 칸에 있을 때만 단축키를 막음 (슬라이더·체크박스·색 고르기를 만진 뒤에도 I·C 등이 되게)
      const typing = !!el && (el.tagName === 'TEXTAREA' || !!el.isContentEditable
        || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'file'].includes((el as HTMLInputElement).type)));
      // Cmd(맥)·Ctrl(윈도우) + ←/→ 가로 확대·축소, ↑/↓ 세로 확대·축소
      if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey && e.code.startsWith('Arrow')) {
        e.preventDefault(); e.stopImmediatePropagation();
        // 재생 위치가 화면 안에 있으면 그 자리를 기준으로
        const v = view.current, w = wrap.current?.clientWidth || 800, ph = live.current.now();
        const at = ph >= v.start && ph <= v.start + w / v.pps ? ph : undefined;
        if (e.code === 'ArrowRight') zoomRef.current(1.3, at);
        else if (e.code === 'ArrowLeft') zoomRef.current(1 / 1.3, at);
        else if (e.code === 'ArrowUp') { setRowH(ROW * 1.2); force(n => n + 1); }
        else if (e.code === 'ArrowDown') { setRowH(ROW / 1.2); force(n => n + 1); }
        return;
      }
      // Cmd(맥)·Ctrl(윈도우) + C / V: 고른 요소 복사 · 재생 위치에 붙여넣기
      if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyV')) {
        if (e.code === 'KeyC') {
          if (String(window.getSelection() || '').trim()) return;   // 화면 글자를 고른 상태면 보통 복사
          const n = copySelected();
          if (n) { e.preventDefault(); e.stopImmediatePropagation(); flashTip(`${n}개 복사했어요 · 재생 위치를 옮기고 ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}V로 붙여넣기`); }
          return;
        }
        if (clipboard?.length) { e.preventDefault(); e.stopImmediatePropagation(); const n = pasteAtPlayhead(); flashTip(n ? `${n}개 붙여넣었어요` : '붙여넣을 수 있는 요소가 없어요 (그 파일이 이 프로젝트에 없어요)'); }
        return;
      }
      // Cmd(맥)·Ctrl(윈도우) + A: 타임라인 요소 전체 선택 (Esc로 풀기)
      if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyA') {
        e.preventDefault(); e.stopImmediatePropagation();
        const lp = live.current;
        selSheet.current = null; pickClip(null);
        lp.onSelectCaption(null); lp.onSelectFx(null); lp.onSelectCard(null); lp.onSelectCut(null);
        allSel.current = true; msel.current = new Set(); force(n => n + 1);
        return;
      }
      if (msel.current.size && e.code === 'Escape') { msel.current = new Set(); force(n => n + 1); e.stopPropagation(); return; }
      if (msel.current.size && !typing && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); e.stopPropagation(); deleteSelected(); return; }
      if (allSel.current && e.code === 'Escape') { allSel.current = false; force(n => n + 1); e.stopPropagation(); return; }
      if (allSel.current && !typing && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); e.stopPropagation(); return; }   // 전체 지우기는 막음 (실수 방지)
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyI' && (live.current.vTrack || live.current.srcDur || live.current.rTrack)) { e.preventDefault(); e.stopPropagation(); splitAtPlayhead(); return; }
      if (!typing && live.current.selected === 'rec' && selRecRef.current && live.current.onDeleteRec && (e.code === 'Delete' || e.code === 'Backspace')) {
        live.current.onDeleteRec(selRecRef.current); selRecRef.current = null; e.preventDefault(); e.stopPropagation(); return;
      }
      if (!typing && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.code === 'KeyC') {
        const cy = live.current.project.cycle; if (cy) { e.preventDefault(); e.stopPropagation(); live.current.onCycle({ ...cy, on: !cy.on }); } return;
      }
      if (!typing && selClipRef.current && (e.code === 'Delete' || e.code === 'Backspace')) {
        const lp = live.current;
        lp.onClips(clipsOf(lp.project, lp.srcDur).filter(c => c.id !== selClipRef.current));
        pickClip(null); e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.code === 'Escape' && cutModeRef.current) { setCutMode(false); e.stopPropagation(); return; }
      if (selSkip.current && (e.code === 'Delete' || e.code === 'Backspace') && el?.tagName !== 'INPUT' && el?.tagName !== 'TEXTAREA') {
        live.current.onSkips((live.current.project.skips || []).filter(k => k.id !== selSkip.current));
        selSkip.current = null; e.preventDefault(); e.stopPropagation(); return;
      }
      if (!selSheet.current || (e.code !== 'Delete' && e.code !== 'Backspace') || typing) return;
      const p = live.current;
      p.onSheetClips(sheetClipsOf(p.project, p.nBars).filter(x => x.id !== selSheet.current));
      selSheet.current = null; e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    // 타임라인 밖을 누르면 전체 선택 풀기 (다른 곳에서 작업하다 돌아와 끌 때 전부 움직이는 실수 방지)
    const outside = (e: PointerEvent) => { if (allSel.current && e.target !== canvas.current) { allSel.current = false; force(n => n + 1); } };
    window.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', outside, true); };
  }, []);
  const zoomRef = useRef<(f: number, at?: number) => void>(() => {});
  const capDrag = useRef<{ id: string; mode: 'move' | 'start' | 'end' | 'page'; grab: number; len: number; base?: Caption[]; page?: string } | null>(null);
  const captionAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = clientX - r.left, v = view.current;
    const list = capItems();
    // 붙어 있는 두 자막의 경계에서는 지금 골라 둔 자막의 끝을 먼저 잡음 (A를 골랐으면 A가 줄어들게)
    const selId = live.current.selCaption;
    const sc = selId ? list.find(c => c.id === selId) : null;
    if (sc) {
      const xa = (sc.start - v.start) * v.pps, xb = (sc.end - v.start) * v.pps;
      if (Math.abs(x - xb) <= 6) return { c: sc, mode: 'end' as const };
      if (Math.abs(x - xa) <= 6) return { c: sc, mode: 'start' as const };
    }
    // 엔딩 카드 안 문구 경계선 (끌어서 바뀌는 시점 옮기기)
    const oc = list.find(c => c.card === 'outro');
    if (oc) for (const pg of cardPages(getFx(live.current.project).outro).slice(1))
      if (Math.abs((oc.start + pg.at - v.start) * v.pps - x) <= 5) return { c: oc, mode: 'page' as const, page: pg.id };
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      const xa = (c.start - v.start) * v.pps, xb = (c.end - v.start) * v.pps;
      if (x >= xa - 5 && x <= xb + 5) {
        const mode: 'move' | 'start' | 'end' = Math.abs(x - xa) <= 6 ? 'start' : Math.abs(x - xb) <= 6 ? 'end' : 'move';
        return { c, mode };
      }
    }
    return null;
  };

  const fxDrag = useRef<{ kind: 'zoom' | 'punch'; id: string; mode: 'move' | 'start' | 'end'; grab: number; len: number } | null>(null);
  const fxAt = (clientX: number, clientY?: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = clientX - r.left, v = view.current, fx = getFx(live.current.project);
    const yy = clientY === undefined ? null : clientY - r.top - RULER + scrollY.current - F_Y;
    let bestM: Punch | null = null, bd = 1e9;
    for (const pu of fx.punches) {
      const dx = Math.abs((pu.t - v.start) * v.pps - x); if (dx > 7) continue;
      const d = dx + (yy === null ? 0 : Math.abs(yy - LANE[markKind(pu)]) * 0.8);
      if (d < bd) { bd = d; bestM = pu; }
    }
    if (bestM) return { kind: 'punch' as const, id: bestM.id, mode: 'move' as const, t0: bestM.t, len: 0 };
    for (let i = fx.zooms.length - 1; i >= 0; i--) {
      const z = fx.zooms[i];
      const xa = (z.start - v.start) * v.pps, xb = (z.end - v.start) * v.pps;
      if (x >= xa - 5 && x <= xb + 5) {
        const mode = Math.abs(x - xa) <= 6 ? 'start' as const : Math.abs(x - xb) <= 6 ? 'end' as const : 'move' as const;
        return { kind: 'zoom' as const, id: z.id, mode, t0: z.start, len: z.end - z.start };
      }
    }
    return null;
  };

  /** 파형 줄(기준 영상·앵글·녹음본)이면 그 id */
  const rowAt = (clientY: number) => {
    const t = trackAt(clientY);
    if (!t || ['program', 'captions', 'sheetcard', 'fx'].includes(t)) return null;
    return t;
  };
  /** 클릭한 위치의 트랙 id (눈금 줄이면 null) */
  const trackAt = (clientY: number): string | null => {
    const r = canvas.current!.getBoundingClientRect();
    const yy = clientY - r.top;
    if (yy < RULER) return null;
    const y = yy - RULER + scrollY.current;
    if (y >= A_Y - 3 && y < C_Y - GAP / 2) return 'program';
    if (y >= C_Y - GAP / 2 && y < K_Y - GAP / 2) return 'captions';
    if (y >= K_Y - GAP / 2 && y < F_Y - GAP / 2) return 'sheetcard';
    if (y >= F_Y - GAP / 2 && y < ROWS_Y - GAP / 2) return 'fx';
    const i = Math.floor((y - ROWS_Y + GAP / 2) / (ROW + GAP));
    const ids = ['main', ...live.current.angleTracks.map(a => a.id), 'rec'];
    return i >= 0 && i < ids.length ? ids[i] : null;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const tr = trackAt(e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    // 전체 선택 중: 아무 요소나 잡고 끌면 전부 같이 이동. 빈 곳을 누르면 선택 풀림
    // Ctrl(윈도우)·Cmd(맥)+클릭: 하나씩 더하거나 빼기 · 빈 곳에서 끌면 네모로 더 고르기
    if ((e.ctrlKey || e.metaKey) && tr && tr !== 'program' && !live.current.pick) {
      allSel.current = false;
      const k = itemKeyAt(e.clientX, e.clientY);
      const next = new Set(msel.current);
      if (!next.size) { const s0 = singleSelKey(); if (s0) next.add(s0); }
      if (k) { if (next.has(k)) next.delete(k); else next.add(k); msel.current = next; force(n => n + 1); return; }
      msel.current = next;
      marquee.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, base: next };
      return;
    }
    // 여러 개 고른 상태: 고른 것 중 하나를 잡고 끌면 같이 이동 · 다른 곳을 누르면 풀림
    if (msel.current.size) {
      const k = itemKeyAt(e.clientX, e.clientY);
      if (k && msel.current.has(k)) { groupDrag.current = { x0: e.clientX, P0: live.current.project, moved: false, sel: new Set(msel.current) }; return; }
      msel.current = new Set(); force(n => n + 1);
    }
    if (allSel.current) {
      const lp = live.current, rr = rowAt(e.clientY);
      const onItem = (tr === 'captions' && !!captionAt(e.clientX)) || (tr === 'sheetcard' && !!sheetAt(e.clientX)) || (tr === 'fx' && !!fxAt(e.clientX, e.clientY))
        || (rr === 'main' && !!clipUnder(e.clientX)) || (tr === 'program' && cutNear(e) >= 0);
      if (onItem) { groupDrag.current = { x0: e.clientX, P0: lp.project, moved: false }; return; }
      allSel.current = false;
    }
    if (live.current.pick) {
      const { a, b } = live.current.pick, v = view.current;
      const x = e.clientX - canvas.current!.getBoundingClientRect().left;
      const tm = Math.max(0, Math.min(live.current.duration || 1e9, magnet(timeAt(e.clientX), e.altKey)));
      if (a !== null && b !== null && Math.abs((a - v.start) * v.pps - x) < 8) pickDrag.current = { fixed: b };
      else if (a !== null && b !== null && Math.abs((b - v.start) * v.pps - x) < 8) pickDrag.current = { fixed: a };
      else { pickDrag.current = { fixed: tm }; live.current.onPick(tm, tm); }
      return;
    }
    // 눈금 줄: 끌면 구간 반복 · 클릭하면 재생 위치 (주황 손잡이는 마디 눈금, Shift+마디선은 템포)
    if (e.clientY - canvas.current!.getBoundingClientRect().top < RULER) {
      const p = live.current.project, v = view.current, x = e.clientX - canvas.current!.getBoundingClientRect().left;
      const hb = handleBar(), hx = (barStart(p, hb) - v.start) * v.pps;
      if (Math.abs(x - hx) <= 6 && e.clientY - canvas.current!.getBoundingClientRect().top < 15) {
        gridDrag.current = { mode: 'anchor', n: hb, x0: e.clientX, anchor0: p.anchorTime, bpm0: p.bpm }; return;
      }
      const n = barLineNear(e.clientX);
      if (e.shiftKey && n !== null && n > hb) { gridDrag.current = { mode: 'bpm', n, x0: e.clientX, anchor0: p.anchorTime, bpm0: p.bpm }; return; }
      // 맨 위 노란 띠 부분: 구간 반복 옮기기 · 양 끝 조절 · 빈 곳을 끌면 새로 만들기
      if (e.clientY - canvas.current!.getBoundingClientRect().top < CY_H + 1) {
        const cy = p.cycle;
        if (cy && cy.end > cy.start) {
          const xa = (cy.start - v.start) * v.pps, xb = (cy.end - v.start) * v.pps;
          if (Math.abs(x - xa) <= 6) { cycleDrag.current = { mode: 'start', grab: 0, c0: { ...cy }, x0: e.clientX, moved: false }; return; }
          if (Math.abs(x - xb) <= 6) { cycleDrag.current = { mode: 'end', grab: 0, c0: { ...cy }, x0: e.clientX, moved: false }; return; }
          if (x > xa && x < xb) { cycleDrag.current = { mode: 'move', grab: timeAt(e.clientX) - cy.start, c0: { ...cy }, x0: e.clientX, moved: false }; return; }
        }
        rulerDown.current = { x0: e.clientX, t0: Math.max(0, magnet(timeAt(e.clientX), e.altKey)), moved: false };
        return;
      }
      // 숫자 부분: 누르고 끌면 재생 위치 이동
      seeking.current = true; seekAt(e);
      return;
    }
    // 녹음본 페이드 손잡이: 끌어서 페이드 길이
    {
      const fh = fadeHandleAt(e.clientX, e.clientY);
      if (fh) {
        selSheet.current = null;
        if (fh.key.startsWith('clip:')) { live.current.onSelect('main'); pickClip(clipsOf(live.current.project, live.current.srcDur).find(c => c.id === fh.key.slice(5)) || null); }
        else { live.current.onSelect('rec'); selRecRef.current = fh.key; }
        fadeDrag.current = { key: fh.key, edge: fh.edge, a: fh.a, b: fh.b };
        force(n => n + 1);
        return;
      }
    }
    // 조각 양 끝: 끌어서 줄이기·늘리기
    {
      const ce = clipEdgeAt(e.clientX, e.clientY);
      if (ce) {
        live.current.onSelect(ce.id.startsWith('recx:') ? 'rec' : ce.id);
        if (ce.id === 'rec' || ce.id.startsWith('recx:')) { selRecRef.current = ce.id; force(n => n + 1); }
        selSheet.current = null;
        if (ce.id === 'main') { pickClip(ce.clip); clipTrim.current = { id: ce.clip.id, edge: ce.edge }; }
        else trimDrag.current = { id: ce.id, edge: ce.edge, off: ce.off, dur: ce.dur, shift: ce.clip.start - ce.clip.srcIn };
        return;
      }
    }
    // 기준 영상 조각: 잡고 끌면 박 단위로 이동 (녹음본·앵글이 같이 따라감)
    {
      const r = rowAt(e.clientY);
      if (r === 'main' && (live.current.vTrack || live.current.srcDur)) {
        live.current.onSelect('main');
        selSheet.current = null;   // 영상 줄을 누르면 악보 선택은 풀림 (그다음 I는 영상을 자름)
        const c = clipUnder(e.clientX);
        pickClip(c || null);
        if (c) clipMove.current = { id: c.id, x0: e.clientX, start0: c.start, moved: false };
        else marquee.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, base: new Set() };   // 빈 곳: 끌어서 여러 개 고르기
        return;
      }
      pickClip(null);
      // 녹음본 · 앵글 줄: 끌면 위치(싱크)가 움직임
      if (r && r !== 'main' && r !== 'program') {
        const p = live.current;
        // 녹음본 줄: 누른 곳에 추가 녹음본이 있으면 그것을 옮김
        let id = r, off0 = r === 'rec' ? p.recAt : (p.angleTracks.find(a => a.id === r)?.offset ?? 0);
        if (r === 'rec') {
          const t = timeAt(e.clientX);
          for (const rx of p.recExtras || []) {
            const dur = rx.dur || rx.track?.duration || 0, tr = trimOf(p.project, rx.key, dur);
            if (t >= rx.at + tr.in && t < rx.at + tr.out) { id = rx.key; off0 = rx.at; }
          }
          // 누른 조각을 고름 (I로 자르기 · Delete로 지우기)
          const mt = p.rTrack ? trimOf(p.project, 'rec', p.rTrack.duration) : null;
          selRecRef.current = id !== 'rec' ? id : (mt && t >= p.recAt + mt.in && t < p.recAt + mt.out ? 'rec' : null);
          force(n => n + 1);
          if (!selRecRef.current) { p.onSelect(r); marquee.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, base: new Set() }; return; }
        }
        p.onSelect(r);
        slipDrag.current = { id, x0: e.clientX, off0, moved: false, live: off0 };
        return;
      }
    }
    if (tr !== 'sheetcard' && selSheet.current) { selSheet.current = null; force(n => n + 1); }
    if (tr === 'sheetcard') {
      const h = sheetAt(e.clientX);
      live.current.onSelectCaption(null); live.current.onSelectFx(null);
      pickClip(null);
      if (h) {
        // 악보 조각: 가운데를 잡고 끌면 박 단위로 이동, 양 끝은 줄이기·늘리기
        if (selSheet.current !== h.c.id) { selSheet.current = h.c.id; force(n => n + 1); }
        if (h.mode === 'move') sheetMove.current = { id: h.c.id, x0: e.clientX, start0: h.c.start, moved: false };
        else sheetTrim.current = { id: h.c.id, edge: h.mode };
        return;
      }
      if (selSheet.current) { selSheet.current = null; force(n => n + 1); }
    } else if (tr === 'captions') {
      const hitc = captionAt(e.clientX);
      if (hitc && hitc.c.card) {
        live.current.onSelectCaption(null); live.current.onSelectCard(hitc.c.card);
        capDrag.current = { id: hitc.c.id, mode: hitc.mode, grab: timeAt(e.clientX) - hitc.c.start, len: hitc.c.end - hitc.c.start, page: (hitc as any).page };
        return;
      }
      if (hitc) {
        live.current.onSelectCard(null);
        live.current.onSelectCaption(hitc.c.id);
        capDrag.current = { id: hitc.c.id, mode: hitc.mode, grab: timeAt(e.clientX) - hitc.c.start, len: hitc.c.end - hitc.c.start, base: live.current.project.captions || [] };
        return;
      }
      live.current.onSelectCaption(null); live.current.onSelectCard(null);
    } else if (tr === 'fx') {
      const h = fxAt(e.clientX, e.clientY);
      if (h) {
        live.current.onSelectFx({ kind: h.kind, id: h.id });
        fxDrag.current = { kind: h.kind, id: h.id, mode: h.mode, grab: timeAt(e.clientX) - h.t0, len: h.len };
        markDown.current = h.kind === 'punch' ? { id: h.id, x: e.clientX, moved: false } : null;
        if (markMenu) setMarkMenu(null);
        return;
      }
      live.current.onSelectFx(null);
      if (markMenu) setMarkMenu(null);
    } else if (tr) live.current.onSelect(tr);
    if (markMenu && tr !== 'fx') setMarkMenu(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const ci = cutNear(e);
    if (ci >= 0) { dragCut.current = ci; live.current.onSelectCut(ci); return; }
    if (tr === 'program') {
      live.current.onSelectCut(null);
      const tm = timeAt(e.clientX), cuts = live.current.project.cuts;
      let si = -1; cuts.forEach((c, k) => { if (c.t <= tm) si = k; });
      pendingSeg.current = si >= 0 && tm < (live.current.duration || 1e9) ? si : null;
    }
    if (segMenuRef.current) setSegMenu(null);
    if (tr === null) { seeking.current = true; seekAt(e); return; } // 위쪽 마디 숫자 줄: 바로 이동
    if (tr === 'captions' || tr === 'sheetcard' || tr === 'fx') { marquee.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, base: new Set() }; return; }   // 빈 곳을 끌면 네모로 여러 개 고르기
    pendingScrub.current = e.clientX;                               // 트랙 줄: 선택만 (끌면 이동)
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pps = view.current.pps;
    const lp = live.current, P = lp.project, bt = 60 / P.bpm;
    if (fadeDrag.current) {
      const d = fadeDrag.current, len = d.b - d.a, f = fadeFor(d.key, len), tm = timeAt(e.clientX);
      const r5 = (v: number) => Math.round(v * 20) / 20;
      const next = d.edge === 'in' ? { in: r5(Math.max(0, Math.min(len - f.out, tm - d.a))), out: f.out } : { in: f.in, out: r5(Math.max(0, Math.min(len - f.in, d.b - tm))) };
      lp.onFade?.(d.key, next);
      tip.current = { text: `페이드 ${d.edge === 'in' ? '인' : '아웃'} ${(d.edge === 'in' ? next.in : next.out).toFixed(2)}초`, x: e.clientX };
      e.currentTarget.style.cursor = 'ew-resize';
      return;
    }
    if (!e.buttons) {
      const fh = fadeHandleAt(e.clientX, e.clientY), prev = fadeHover.current;
      fadeHover.current = fh ? { key: fh.key, edge: fh.edge } : null;
      if (fh) { e.currentTarget.style.cursor = 'ew-resize'; return; }
      void prev;
    }
    if (marquee.current) {
      const m = marquee.current;
      m.x1 = e.clientX; m.y1 = e.clientY;
      if (Math.abs(m.x1 - m.x0) > 3 || Math.abs(m.y1 - m.y0) > 3) {
        const s = new Set(m.base); for (const k of marqueeKeys(m)) s.add(k);
        msel.current = s;
      }
      return;
    }
    if (groupDrag.current) {
      const d = groupDrag.current;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      const u = snapUnit(), dt = (e.clientX - d.x0) / pps, q0 = e.altKey ? dt : Math.round(dt / u) * u;
      const { patch, q } = groupPatch(d.P0, q0, d.sel);
      lp.onGroup(patch);
      tip.current = { text: `${d.sel ? `${d.sel.size}개` : '전체'} ${e.altKey ? `${q >= 0 ? '+' : ''}${q.toFixed(3)}초` : beatsText(q)}`, x: e.clientX };
      return;
    }
    // 눈금 줄을 끌면 구간 반복 만들기
    if (rulerDown.current) {
      const d = rulerDown.current;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 5) return;
      d.moved = true;
      const tm = Math.max(0, magnet(timeAt(e.clientX), e.altKey));
      lp.onCycle({ start: Math.min(d.t0, tm), end: Math.max(d.t0, tm), on: true });
      tip.current = { text: `구간 반복 ${Math.abs(tm - d.t0) / (bt * P.beatsPerBar) >= 1 ? (Math.abs(tm - d.t0) / (bt * P.beatsPerBar)).toFixed(2).replace(/\.?0+$/, '') + '마디' : Math.round(Math.abs(tm - d.t0) / bt) + '박'}`, x: e.clientX };
      return;
    }
    if (cycleDrag.current) {
      const d = cycleDrag.current, tm = Math.max(0, magnet(timeAt(e.clientX), e.altKey));
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      if (d.mode === 'start') lp.onCycle({ start: Math.min(tm, d.c0.end - 0.1), end: d.c0.end, on: true });
      else if (d.mode === 'end') lp.onCycle({ start: d.c0.start, end: Math.max(tm, d.c0.start + 0.1), on: true });
      else { const st = Math.max(0, magnet(timeAt(e.clientX) - d.grab, e.altKey)); lp.onCycle({ start: st, end: st + (d.c0.end - d.c0.start), on: true }); }
      return;
    }
    // 기준 영상 조각 옮기기: 박 단위로 딱딱 (Alt: 자유)
    if (clipMove.current) {
      const d = clipMove.current;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      const u = snapUnit(), dt = (e.clientX - d.x0) / pps, q = e.altKey ? dt : Math.round(dt / u) * u;
      const ns = Math.max(-1e6, d.start0 + q);
      lp.onClips(clipsOf(P, lp.srcDur).map(c => c.id === d.id ? { ...c, start: ns } : c));
      tip.current = { text: e.altKey ? `${q >= 0 ? '+' : ''}${q.toFixed(3)}초` : `${beatsText(q)} · ${unitName(u)} 단위`, x: e.clientX };
      return;
    }
    // 조각 양 끝 줄이기·늘리기 (끝은 박자 눈금에 붙음)
    if (clipTrim.current) {
      const d = clipTrim.current, tm = magnet(timeAt(e.clientX), e.altKey);
      lp.onClips(clipsOf(P, lp.srcDur).map(c => {
        if (c.id !== d.id) return c;
        if (d.edge === 'in') {
          const ns = Math.min(clipEnd(c) - 0.1, Math.max(c.start - c.srcIn, tm));   // 영상 처음보다 앞으로는 못 늘림
          return { ...c, start: ns, srcIn: c.srcIn + (ns - c.start) };
        }
        const ne = Math.max(c.start + 0.1, Math.min(c.start + ((lp.srcDurOf ? lp.srcDurOf(c.src) : lp.srcDur) - c.srcIn), tm));
        return { ...c, srcOut: c.srcIn + (ne - c.start) };
      }));
      tip.current = { text: d.edge === 'in' ? '시작 줄이기·늘리기' : '끝 줄이기·늘리기', x: e.clientX };
      return;
    }
    // 악보 조각 옮기기 (박 단위로 붙음, Alt는 자유롭게)
    if (sheetMove.current) {
      const d = sheetMove.current;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      const u = snapUnit(), dt = (e.clientX - d.x0) / pps, q = e.altKey ? dt : Math.round(dt / u) * u;
      lp.onSheetClips(sheetClipsOf(P, lp.nBars).map(c => c.id === d.id ? { ...c, start: d.start0 + q } : c));
      tip.current = { text: e.altKey ? `${q >= 0 ? '+' : ''}${q.toFixed(3)}초` : `악보 ${beatsText(q)}`, x: e.clientX };
      return;
    }
    // 악보 조각 양 끝 줄이기·늘리기 (박자 눈금에 붙음)
    if (sheetTrim.current) {
      const d = sheetTrim.current, tm = magnet(timeAt(e.clientX), e.altKey), minLen = snapUnit();
      lp.onSheetClips(sheetClipsOf(P, lp.nBars).map(c => {
        if (c.id !== d.id) return c;
        const L = clipBarLen(P, c), nB = lp.nBarsOf ? lp.nBarsOf(c.sheet) : lp.nBars;
        const end = sheetClipEnd(P, c);
        if (d.edge === 'in') {
          const ns = Math.min(end - minLen, Math.max(c.start + (-16 - c.barIn) * L, tm));   // 앞으로는 16마디까지 (카운트인)
          return { ...c, start: ns, barIn: c.barIn + (ns - c.start) / L };
        }
        const ne = Math.max(c.start + minLen, Math.min(c.start + (nB + 16 - c.barIn) * L, tm));
        return { ...c, barOut: c.barIn + (ne - c.start) / L };
      }));
      tip.current = { text: d.edge === 'in' ? '악보 시작 줄이기·늘리기' : '악보 끝 줄이기·늘리기', x: e.clientX };
      return;
    }
    if (cutDrag.current) {
      const tm = Math.max(0, Math.min(live.current.duration || 1e9, magnet(timeAt(e.clientX), e.altKey))), f = cutDrag.current.fixed;
      cutDrag.current.a = Math.min(f, tm); cutDrag.current.b = Math.max(f, tm);
      return;
    }
    if (skipDrag.current) {
      const d = skipDrag.current, tm = Math.max(0, Math.min(live.current.duration || 1e9, magnet(timeAt(e.clientX), e.altKey)));
      live.current.onSkips((live.current.project.skips || []).map(k => k.id !== d.id ? k
        : d.edge === 'start' ? { ...k, start: Math.min(tm, k.end - 0.1) } : { ...k, end: Math.max(tm, k.start + 0.1) }));
      return;
    }
    if (gridDrag.current) {
      const d = gridDrag.current, p = live.current.project;
      const dt = (e.clientX - d.x0) / pps * (e.shiftKey && d.mode === 'anchor' ? 0.2 : 1);
      const L0 = p.beatsPerBar * 60 / d.bpm0;
      if (d.mode === 'anchor') {
        live.current.onGrid({ anchorTime: d.anchor0 + dt });
        tip.current = { text: `${d.n}마디 시작 ${(d.anchor0 + dt + (d.n - p.anchorBar) * L0).toFixed(3)}초`, x: e.clientX };
      } else {
        // 손잡이 마디는 그대로 두고, 끈 마디선이 따라오도록 템포 조절
        const hb = handleBar(), th = d.anchor0 + (hb - p.anchorBar) * L0;
        const tn = d.anchor0 + (d.n - p.anchorBar) * L0 + dt;
        const len = (tn - th) / (d.n - hb);
        if (len > 0.3) {
          const bpm = Math.round(p.beatsPerBar * 60 / len * 100) / 100, L = p.beatsPerBar * 60 / bpm;
          live.current.onGrid({ bpm, anchorTime: th - (hb - p.anchorBar) * L });
          tip.current = { text: `BPM ${bpm.toFixed(2)}`, x: e.clientX };
        }
      }
      return;
    }
    if (trimDrag.current) {
      const d = trimDrag.current, p = live.current.project, tr = trimOf(p, d.id, d.dur);
      const src = magnet(timeAt(e.clientX), e.altKey) - d.shift + d.off;   // 타임라인 시간 → 그 파일 시간
      const nt = d.edge === 'in' ? { in: Math.max(0, Math.min(tr.out - 0.2, src)), out: tr.out } : { in: tr.in, out: Math.min(d.dur, Math.max(tr.in + 0.2, src)) };
      live.current.onTrim(d.id, nt);
      tip.current = { text: `${d.edge === 'in' ? '시작' : '끝'} ${(d.edge === 'in' ? nt.in : nt.out).toFixed(2)}초 · 길이 ${(nt.out - nt.in).toFixed(1)}초`, x: e.clientX };
      return;
    }
    if (mainDrag.current) {
      const d = mainDrag.current, p = live.current.project;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      // 오른쪽으로 끌면 영상(소리 포함)이 마디 눈금보다 늦게 → 1마디가 영상의 더 이른 지점에
      const dt = (e.clientX - d.x0) / pps, bt = 60 / p.bpm;
      const q = e.altKey ? dt : Math.round(dt / bt) * bt;     // 박자 단위로 딱딱 (Alt: 자유)
      if (Math.abs(q - d.q) > 1e-6) {
        d.q = q;
        view.current.start = d.start0 - q;     // 눈금은 화면에 그대로, 클립들이 움직여 보이게
        view.current.fitted = false;
        live.current.onGrid({ anchorTime: d.anchor0 - q });
      }
      const beats = Math.round(q / bt);
      tip.current = { text: e.altKey ? `${q >= 0 ? '+' : ''}${q.toFixed(3)}초` : `${beats >= 0 ? '+' : ''}${beats}박`, x: e.clientX };
      return;
    }
    if (slipDrag.current) {
      const d = slipDrag.current;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      // 오른쪽으로 끌면 소리가 늦게 나옴 → 오프셋 감소 (Shift: 5배 정밀)
      const dt = (e.clientX - d.x0) / pps * (e.shiftKey ? 0.2 : 1);
      // 녹음본: 오른쪽으로 끌면 녹음본이 늦게 시작 (값 = 타임라인 시작 위치) · 앵글: 오프셋 감소
      const isRec = d.id === 'rec' || d.id.startsWith('recx:');
      d.live = Math.round((isRec ? d.off0 + dt : d.off0 - dt) * 1000) / 1000;
      live.current.onSlip(d.id, d.live);
      tip.current = { text: isRec ? `녹음본 ${d.live - d.off0 >= 0 ? '+' : ''}${(d.live - d.off0).toFixed(3)}초` : `${d.live >= 0 ? '+' : ''}${d.live.toFixed(3)}초`, x: e.clientX };
      return;
    }
    // 다른 걸 끌고 있지 않을 때만 마우스 모양 바꾸기
    const busy = !!(fxDrag.current || capDrag.current || sheetMove.current || sheetTrim.current || dragCut.current !== null || seeking.current || pickDrag.current);
    if (!busy && e.clientY - canvas.current!.getBoundingClientRect().top < RULER && !pendingScrub.current) {
      const n = barLineNear(e.clientX), y = e.clientY - canvas.current!.getBoundingClientRect().top;
      const p = live.current.project, v = view.current, x = e.clientX - canvas.current!.getBoundingClientRect().left;
      const hx = (barStart(p, handleBar()) - v.start) * v.pps;
      if (Math.abs(x - hx) <= 6 && y < 15) { e.currentTarget.style.cursor = 'ew-resize'; return; }
      if (y < CY_H + 1) {
        const cy = p.cycle;
        const xa = cy ? (cy.start - v.start) * v.pps : -1e9, xb = cy ? (cy.end - v.start) * v.pps : -1e9;
        e.currentTarget.style.cursor = cy && cy.end > cy.start && (Math.abs(x - xa) <= 6 || Math.abs(x - xb) <= 6) ? 'ew-resize' : cy && x > xa && x < xb ? 'grab' : 'crosshair';
        tip.current = null;
        return;
      }
      e.currentTarget.style.cursor = n !== null && e.shiftKey ? 'ew-resize' : 'col-resize';
      return;
    }
    if (!busy && cutModeRef.current) { e.currentTarget.style.cursor = 'crosshair'; return; }
    if (!busy) {
      const ce = rowAt(e.clientY) ? clipEdgeAt(e.clientX, e.clientY) : null;
      clipHover.current = ce ? { id: ce.id, edge: ce.edge, clip: ce.clip.id } : null;
      if (ce) { e.currentTarget.style.cursor = 'ew-resize'; return; }
    }
    if (!busy && rowAt(e.clientY) && !pendingScrub.current) { e.currentTarget.style.cursor = 'grab'; return; }
    if (fxDrag.current) {
      const d = fxDrag.current, fx = getFx(live.current.project);
      const tm = timeAt(e.clientX), dur = live.current.duration || 1e9;
      if (d.kind === 'punch') {
        const md = markDown.current;
        if (md && !md.moved) { if (Math.abs(e.clientX - md.x) < 4) return; md.moved = true; }
        const t = Math.max(0, Math.min(dur, tm - d.grab));   // 찍은 지점은 마디에 붙이지 않고 그대로
        live.current.onFxItems({ punches: fx.punches.map(p => p.id === d.id ? { ...p, t } : p) });
      } else {
        live.current.onFxItems({ zooms: fx.zooms.map(z => {
          if (z.id !== d.id) return z;
          if (d.mode === 'move') { const st = Math.max(0, Math.min(dur - d.len, magnet(tm - d.grab, e.altKey))); return { ...z, start: st, end: st + d.len }; }
          if (d.mode === 'start') return { ...z, start: Math.max(0, Math.min(z.end - 0.3, magnet(tm, e.altKey))) };
          return { ...z, end: Math.min(dur, Math.max(z.start + 0.3, magnet(tm, e.altKey))) };
        }) });
      }
      return;
    }
    if (trackAt(e.clientY) === 'fx' && !seeking.current && dragCut.current === null) {
      const h = fxAt(e.clientX, e.clientY);
      e.currentTarget.style.cursor = h ? (h.kind === 'punch' || h.mode === 'move' ? 'grab' : 'ew-resize') : 'copy';
      return;
    }
    if (pickDrag.current) {
      const tm = Math.max(0, Math.min(live.current.duration || 1e9, magnet(timeAt(e.clientX), e.altKey))), f = pickDrag.current.fixed;
      live.current.onPick(Math.min(f, tm), Math.max(f, tm));
      return;
    }
    if (live.current.pick) { const v = view.current, pk = live.current.pick, x = e.clientX - canvas.current!.getBoundingClientRect().left;
      e.currentTarget.style.cursor = pk.a !== null && pk.b !== null && [pk.a, pk.b].some(tm => Math.abs((tm - v.start) * v.pps - x) < 8) ? 'ew-resize' : 'crosshair'; return; }
    if (trackAt(e.clientY) === 'sheetcard' && !seeking.current && dragCut.current === null) {
      const h = sheetAt(e.clientX);
      e.currentTarget.style.cursor = h ? (h.mode === 'move' ? 'grab' : 'ew-resize') : 'default';
      return;
    }
    if (capDrag.current && capDrag.current.id.startsWith('__')) {
      const d = capDrag.current, k = d.id.slice(2) as 'intro' | 'outro';
      const tm = timeAt(e.clientX), dur = live.current.duration || 1e9;
      const [a, b] = cardSpan(getFx(live.current.project), k, 0, live.current.duration || 0);
      if (d.mode === 'page' && d.page) {
        // 문구 경계선: 앞뒤 문구와 0.3초 넘게 떨어진 곳까지만
        const o = getFx(live.current.project).outro, ps = cardPages(o), i = ps.findIndex(x => x.id === d.page);
        if (i < 1) return;
        const lo = ps[i - 1].at + 0.3, hi = (i + 1 < ps.length ? ps[i + 1].at : o.dur) - 0.3;
        const at = Math.round(Math.max(lo, Math.min(hi, magnet(tm, e.altKey) - a)) * 100) / 100;
        live.current.onCard(k, { pages: (o.pages || []).map(x => x.id === d.page ? { ...x, at } : x) });
        return;
      }
      if (d.mode === 'move') { const st = Math.max(0, Math.min(dur - d.len, magnet(tm - d.grab, e.altKey))); live.current.onCard(k, { at: st }); }
      else if (d.mode === 'start') { const st = Math.max(0, Math.min(b - 0.5, magnet(tm, e.altKey))); live.current.onCard(k, { at: st, dur: Math.round((b - st) * 100) / 100 }); }
      else { const en = Math.min(dur, Math.max(a + 0.5, magnet(tm, e.altKey))); live.current.onCard(k, { at: a, dur: Math.round((en - a) * 100) / 100 }); }
      return;
    }
    if (capDrag.current) {
      const d = capDrag.current, p = live.current.project;
      const tm = timeAt(e.clientX), dur = live.current.duration || 1e9;
      // 길이 조절: 옆 자막 쪽으로 늘리면 옆 자막이 그만큼 줄어듦 (잡기 시작할 때의 위치 기준, 다시 줄이면 원래대로)
      const base = d.base || (p.captions || []);
      const me = base.find(c => c.id === d.id);
      if (!me) return;
      let list: Caption[];
      if (d.mode === 'move') {
        const st = Math.max(0, Math.min(dur - d.len, magnet(tm - d.grab, e.altKey)));
        list = (p.captions || []).map(c => c.id === d.id ? { ...c, start: st, end: st + d.len } : c);
      } else if (d.mode === 'end') {
        const next = base.filter(c => c.id !== d.id && c.start >= me.end - 0.05).sort((a, b) => a.start - b.start)[0];
        const hi = next ? next.end - 0.2 : dur;
        const ne = Math.min(hi, Math.max(me.start + 0.2, magnet(tm, e.altKey)));
        list = base.map(c => c.id === d.id ? { ...c, end: ne } : next && c.id === next.id ? { ...c, start: Math.max(next.start, ne) } : c);   // 늘리면 옆 자막이 줄어듦 (줄일 때 옆 자막은 그대로)
      } else {
        const prev = base.filter(c => c.id !== d.id && c.end <= me.start + 0.05).sort((a, b) => b.end - a.end)[0];
        const lo = prev ? prev.start + 0.2 : 0;
        const ns = Math.max(lo, Math.min(me.end - 0.2, magnet(tm, e.altKey)));
        list = base.map(c => c.id === d.id ? { ...c, start: ns } : prev && c.id === prev.id ? { ...c, end: Math.min(prev.end, ns) } : c);
      }
      live.current.onCaptions(list);
      return;
    }
    if (trackAt(e.clientY) === 'captions' && !seeking.current && dragCut.current === null) {
      const h = captionAt(e.clientX);
      e.currentTarget.style.cursor = h ? (h.mode === 'move' ? 'grab' : 'ew-resize') : 'text';
      return;
    }
    if (dragCut.current !== null) {
      const cuts = live.current.project.cuts;
      const i = dragCut.current;
      const lo = i > 0 ? cuts[i - 1].t + 0.05 : 0;
      const hi = i < cuts.length - 1 ? cuts[i + 1].t - 0.05 : (live.current.duration || 1e9);
      const t = Math.max(lo, Math.min(hi, live.current.snap(timeAt(e.clientX))));
      const next = cuts.map((c, k) => k === i ? { ...c, t } : c);
      live.current.onCuts(next);
      return;
    }
    e.currentTarget.style.cursor = cutNear(e) >= 0 ? 'ew-resize' : 'text';
    if (pendingScrub.current !== null && Math.abs(e.clientX - pendingScrub.current) > 4) { pendingScrub.current = null; seeking.current = true; }
    if (seeking.current) seekAt(e);
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    tip.current = null;
    if (fadeDrag.current) { fadeDrag.current = null; force(n => n + 1); return; }
    if (marquee.current) {
      const m = marquee.current; marquee.current = null;
      // 끌지 않고 빈 곳을 한 번 누른 것: 선택 풀기만
      if (Math.abs(m.x1 - m.x0) <= 3 && Math.abs(m.y1 - m.y0) <= 3 && !m.base.size) msel.current = new Set();
      else if (msel.current.size === 1 && !m.base.size) {
        // 하나만 걸렸으면 그것만 고른 것과 같게
        const k = [...msel.current][0];
        if (k.startsWith('cap:')) { live.current.onSelectCaption(k.slice(4)); msel.current = new Set(); }
      }
      force(n => n + 1);
      return;
    }
    if (groupDrag.current) {
      const d = groupDrag.current; groupDrag.current = null;
      if (!d.moved) { if (d.sel) msel.current = new Set(); else allSel.current = false; force(n => n + 1); }
      return;
    }
    if (rulerDown.current) { rulerDown.current = null; return; }
    if (cycleDrag.current) {
      // 노란 띠를 끌지 않고 한 번 클릭 = 구간 반복 잠깐 끄기 / 다시 켜기
      const d = cycleDrag.current; cycleDrag.current = null;
      if (!d.moved && d.mode === 'move') { const cy = live.current.project.cycle; if (cy) live.current.onCycle({ ...cy, on: !cy.on }); }
      return;
    }
    if (clipMove.current) { clipMove.current = null; return; }
    if (clipTrim.current) { clipTrim.current = null; return; }
    if (sheetMove.current) { sheetMove.current = null; return; }
    if (sheetTrim.current) { sheetTrim.current = null; return; }
    if (cutDrag.current) {
      const { a, b } = cutDrag.current; cutDrag.current = null;
      if (b - a > 0.1) live.current.onSkips(mergeSkips([...(live.current.project.skips || []), { id: 's' + Date.now().toString(36), start: a, end: b }]));
      return;
    }
    if (skipDrag.current) { skipDrag.current = null; live.current.onSkips(mergeSkips(live.current.project.skips || [])); return; }
    if (gridDrag.current) { gridDrag.current = null; return; }
    if (slipDrag.current) { slipDrag.current = null; return; }
    if (mainDrag.current) { mainDrag.current = null; return; }
    if (trimDrag.current) { trimDrag.current = null; return; }
    pickDrag.current = null;
    if (markDown.current && !markDown.current.moved) setMarkMenu({ id: markDown.current.id, x: e.clientX, y: e.clientY });
    markDown.current = null;
    if (pendingSeg.current !== null && pendingScrub.current !== null) setSegMenu({ i: pendingSeg.current, x: e.clientX, y: e.clientY });
    pendingSeg.current = null;
    capDrag.current = null;
    fxDrag.current = null;
    pendingScrub.current = null;
    if (dragCut.current !== null) { live.current.onCuts(normalizeCuts(live.current.project.cuts)); dragCut.current = null; }
    seeking.current = false;
  };
  const onDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (live.current.pick) return;
    {
      const y = e.clientY - canvas.current!.getBoundingClientRect().top;
      if (y >= CY_H + 1 && y < RULER) { live.current.onPlayFrom(Math.max(0, softSnap(timeAt(e.clientX), e.altKey))); return; }
    }
    if (trackAt(e.clientY) === 'fx') {
      const h = fxAt(e.clientX, e.clientY), fx = getFx(live.current.project);
      if (h?.kind === 'punch') { live.current.onFxItems({ punches: fx.punches.filter(p => p.id !== h.id) }); live.current.onSelectFx(null); }
      else if (!h) live.current.onAddPunch(Math.max(0, timeAt(e.clientX)));
      return;
    }
    if (trackAt(e.clientY) === 'sheetcard') {
      // 빈 곳 더블클릭 = 그 자리(박에 붙여)에 악보 전체를 한 조각으로 넣기
      const p = live.current;
      if (sheetAt(e.clientX) || !p.nBars) return;
      const st = magnet(timeAt(e.clientX), e.altKey), id = 'k' + Date.now().toString(36);
      p.onSheetClips([...sheetClipsOf(p.project, p.nBars), { id, start: st, barIn: 0, barOut: p.nBars }]);
      selSheet.current = id;
      return;
    }
    if (trackAt(e.clientY) === 'captions') { const h = captionAt(e.clientX); if (h?.c.card) live.current.onSelectCard(h.c.card, true); else if (h) live.current.onEditCaption(h.c.id); return; }
    const ci = cutNear(e);
    if (ci >= 0) live.current.onCuts(normalizeCuts(live.current.project.cuts.filter((_, k) => k !== ci)));
  };

  useEffect(() => {
    const c = canvas.current!;
    // Shift+스크롤 = 좌우 이동 · Ctrl+스크롤(트랙패드 핀치) = 확대/축소 · 그냥 스크롤 = 줄이 많을 때 위아래
    const onWheel = (e: WheelEvent) => {
      const v = view.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        v.fitted = false;
        const dy = e.deltaY || e.deltaX;
        const tm = timeAt(e.clientX);
        v.pps = Math.max(2, Math.min(2000, v.pps * Math.pow(1.0018, -dy * 3)));
        const r = c.getBoundingClientRect();
        v.start = tm - (e.clientX - r.left) / v.pps;
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        v.fitted = false;
        v.start += (e.deltaX || e.deltaY) / v.pps; // 윈도우 크롬은 Shift+휠을 가로(deltaX)로 보낸다
      } else {
        const g = geo();
        if (g.maxScroll <= 0) return; // 넘칠 게 없으면 페이지가 스크롤되게 둔다
        e.preventDefault();
        scrollY.current = Math.max(0, Math.min(g.maxScroll, scrollY.current + e.deltaY * 0.5));
      }
      force(n => n + 1);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  /** 가로 확대·축소: at(타임라인 시간)이 화면에서 제자리에 있게 (없으면 가운데) */
  const zoom = (f: number, at?: number) => {
    const v = view.current;
    const w = wrap.current?.clientWidth || 800;
    const t0 = at ?? v.start + w / v.pps / 2, sx = (t0 - v.start) * v.pps;
    v.pps = Math.max(2, Math.min(2000, v.pps * f));
    v.start = t0 - sx / v.pps;
    v.fitted = false;
    force(n => n + 1);
  };
  zoomRef.current = zoom;

  return (
    <div className="timeline">
      <div className="tl-head">
        <span className="tl-title">타임라인</span>
        <button type="button" className="btn sm" onClick={() => { const n = copySelected(); flashTip(n ? `${n}개 복사했어요 · 재생 위치를 옮기고 붙여넣기` : '복사할 요소를 먼저 골라 주세요 (클릭 · 끌어서 네모 · Ctrl/Cmd+클릭)'); }} title="고른 요소 복사 (Ctrl/Cmd+C) — 영상·녹음본·악보·자막·효과">복사</button>
        <button type="button" className="btn sm" onClick={() => { const n = pasteAtPlayhead(); flashTip(n ? `${n}개 붙여넣었어요` : '먼저 요소를 복사해 주세요'); }} title="복사한 요소를 재생 위치에 붙여넣기 (Ctrl/Cmd+V)">붙여넣기</button>
        <button type="button" className="btn sm" onClick={() => splitAtPlayhead()} title="재생 위치에서 고른 조각을 둘로 자르기 (I). 자른 조각은 끌어서 옮기거나 Delete로 지울 수 있어요">✂ 자르기 <span className="dim">I</span></button>
        <button type="button" className={`btn sm tl-loop ${props.project.cycle?.on ? 'on' : ''}`} disabled={!props.project.cycle} aria-pressed={!!props.project.cycle?.on}
          onClick={() => props.project.cycle && props.onCycle({ ...props.project.cycle, on: !props.project.cycle.on })} title="눈금 줄 맨 위 띠를 끌어서 구간을 만들고, 켜면 그 구간만 반복 재생·추출 (C · 노란 띠 클릭)">🔁 구간 반복 <span className="dim">C</span></button>
        {props.hasSheet && <button type="button" className={`btn sm tl-loop ${!props.sheetHidden ? 'on' : ''}`} aria-pressed={!props.sheetHidden} onClick={() => props.onSheetHidden(!props.sheetHidden)} title="악보를 영상에 보이기 · 숨기기 (미리보기와 추출 영상 모두)">악보 {props.sheetHidden ? '꺼짐' : '보임'}</button>}
        {props.hasSheet && props.onSheetBpm && (() => {
          const c = sheetClipsOf(props.project, props.nBars).find(x => x.id === selSheet.current);
          if (!c) return null;
          const name = (c.sheet || (props.sheetNames || [])[0] || '악보').replace(/\.[^.]+$/, '');
          return <BpmBox key={c.id} label={name} bpm={c.bpm} base={bpmAt(props.project, c.start - 1e-3)} onBpm={b => props.onSheetBpm!(c.id, b)} />;
        })()}
        {props.onFade && ((props.selected === 'rec' && selRecRef.current) || (props.selected === 'main' && selClipRef.current)) && (() => {
          const pc = props.selected === 'main' ? clipPieces().find(x => x.key === 'clip:' + selClipRef.current) : recPieces().find(x => x.key === selRecRef.current);
          if (!pc) return null;
          const f = fadeFor(pc.key, pc.b - pc.a);
          return <FadeBox key={pc.key} fade={f} max={pc.b - pc.a} onFade={nf => props.onFade!(pc.key, nf)} />;
        })()}
        {props.hasSheet && props.project.sheetClips && <button type="button" className="btn ghost sm" onClick={() => { selSheet.current = null; props.onSheetClips(null); }} title="악보 조각 편집을 지우고 1마디부터 악보 전체로 다시 넣기">악보 처음대로</button>}
        <div className="tl-zoom">
          <button type="button" className="btn ghost sm" onClick={() => zoom(1 / 1.6)} aria-label="축소" title="가로 축소 (Cmd/Ctrl+←) · 세로는 Cmd/Ctrl+↑↓">−</button>
          <button type="button" className="btn ghost sm" onClick={fit}>전체 보기</button>
          <button type="button" className="btn ghost sm" onClick={() => zoom(1.6)} aria-label="확대" title="가로 확대 (Cmd/Ctrl+→) · 세로는 Cmd/Ctrl+↑↓">+</button>
        </div>
      </div>
      <div ref={wrap} className="tl-canvas">
        <canvas ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl} />
      </div>
      {markMenu && getFx(props.project).punches.some(m => m.id === markMenu.id) && (
        <MarkMenu {...markMenu} project={props.project} onFxItems={props.onFxItems} onSeek={props.onSeek}
          onClose={() => setMarkMenu(null)} onDeleted={() => { setMarkMenu(null); props.onSelectFx(null); }} />
      )}
      {segMenu && props.project.cuts[segMenu.i] && <SegMenu {...segMenu} project={props.project} info={props.angleInfo} onCuts={props.onCuts} onClose={() => setSegMenu(null)} />}
    </div>
  );
}

/** 고른 녹음본 조각의 페이드 인·아웃 (초) */
function FadeNum({ id, label, v, set, max }: { id: string; label: string; v: number; set: (n: number) => void; max: number }) {
  const [s, setS] = useState(v ? String(Math.round(v * 100) / 100) : '');
  useEffect(() => { setS(v ? String(Math.round(v * 100) / 100) : ''); }, [v]);
  const commit = () => { const n = s.trim() ? parseFloat(s) : 0; if (isFinite(n) && n >= 0) set(Math.min(n, max)); else setS(v ? String(v) : ''); };
  return (
    <label className="tl-bpm" title="녹음본 조각 위쪽의 작은 네모를 끌어도 조절돼요">
      <span>{label}</span>
      <input id={id} type="number" min={0} max={Math.round(max * 10) / 10} step={0.1} inputMode="decimal" value={s} placeholder="0"
        onChange={e => setS(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }} />
      <span className="dim">초</span>
    </label>
  );
}

function FadeBox(p: { fade: Fade; max: number; onFade: (f: Fade) => void }) {
  return (
    <span className="tl-fade">
      <FadeNum max={p.max} id="rec-fade-in" label="페이드 인" v={p.fade.in} set={n => p.onFade({ in: n, out: Math.min(p.fade.out, Math.max(0, p.max - n)) })} />
      <FadeNum max={p.max} id="rec-fade-out" label="아웃" v={p.fade.out} set={n => p.onFade({ in: Math.min(p.fade.in, Math.max(0, p.max - n)), out: n })} />
    </span>
  );
}

/** 고른 악보 조각의 템포 입력 (비우면 앞 템포 그대로) */
export function BpmBox(p: { label: string; bpm?: number; base: number; onBpm: (b: number | undefined) => void; id?: string }) {
  const [v, setV] = useState(p.bpm ? String(Math.round(p.bpm * 100) / 100) : '');
  useEffect(() => { setV(p.bpm ? String(Math.round(p.bpm * 100) / 100) : ''); }, [p.bpm]);
  const commit = () => {
    const n = parseFloat(v);
    if (!v.trim()) { if (p.bpm) p.onBpm(undefined); return; }
    if (isFinite(n) && n >= 30 && n <= 300) { if (Math.abs(n - (p.bpm || 0)) > 1e-3) p.onBpm(n); }
    else setV(p.bpm ? String(p.bpm) : '');
  };
  return (
    <label className="tl-bpm" title="이 악보가 시작되는 곳부터 이 템포로 마디 눈금·메트로놈·악보가 흘러가요. 비우면 앞 템포 그대로">
      <span>{p.label} 템포</span>
      <input id={p.id || "sheet-bpm"} type="number" min={30} max={300} step={0.5} inputMode="decimal" value={v} placeholder={String(Math.round(p.base * 10) / 10)}
        onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }} />
      <span className="dim">BPM</span>
    </label>
  );
}

function label(ctx: CanvasRenderingContext2D, text: string, y: number, color: string, filled = false) {
  ctx.font = `${filled ? 700 : 600} 12px "IBM Plex Sans KR", sans-serif`;
  ctx.textBaseline = 'middle';
  const t = filled ? `▶ ${text}` : text;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = filled ? color : 'rgba(20,18,15,0.85)';
  ctx.beginPath(); ctx.roundRect(8, y, tw + 12, 18, 4); ctx.fill();
  ctx.fillStyle = filled ? '#14110d' : color; ctx.fillText(t, 14, y + 9);
}

function hexA(hex: string, a: number) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function SegMenu({ i, x, y, project, info, onCuts, onClose }: { i: number; x: number; y: number; project: Project; info: Props['angleInfo']; onCuts: (c: Cut[]) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // 누른 곳 바로 위에 띄움 (아래 기준이라 내용이 늘어나도 위로 자람)
  const left = Math.max(8, Math.min(window.innerWidth - 374, x - 183));
  const bottom = Math.max(8, window.innerHeight - y + 16);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.tl-canvas')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, []);
  const cuts = project.cuts, fx = getFx(project), cin = cuts[i], cout = cuts[i + 1] as Cut | undefined;
  const typeOf = (c: Cut) => c.tr?.type || fx.trType;
  const durOf = (c: Cut) => c.tr?.dur || fx.trDur;
  const setTr = (k: number, type: TransType) => onCuts(cuts.map((c, j) => j === k ? { ...c, tr: { type, dur: durOf(c) } } : c));
  const setDur = (d: number) => onCuts(cuts.map((c, j) => (j === i || j === i + 1) ? { ...c, tr: { type: typeOf(c), dur: d } } : c));
  const remove = () => { onCuts(normalizeCuts(cuts.filter((_, j) => j !== i))); onClose(); };
  const lab = info(cin.angle).label;
  const row = (k: number, c: Cut, title: string) => (
    <div className="sm-row">
      <span className="sm-lab">{title}</span>
      <div className="chips">{TRANS_LIST.map(([t, n]) => <button key={t} type="button" className={typeOf(c) === t ? 'on' : ''} onClick={() => setTr(k, t)}>{n}</button>)}</div>
    </div>
  );
  const anyTr = typeOf(cin) !== 'cut' || (cout && typeOf(cout) !== 'cut');
  return (
    <div ref={box} className="seg-menu" style={{ left, bottom }} role="dialog" aria-label={`${lab}번 구간`}>
      <div className="sm-head">
        <span className="sm-badge" style={{ background: info(cin.angle).color }}>{lab}</span>
        <span className="small dim mono">{cin.t.toFixed(2)}~{cout ? cout.t.toFixed(2) : '끝'}초</span>
        <button type="button" className="btn ghost xs" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      {row(i, cin, '들어갈 때')}
      {cout && row(i + 1, cout, '나올 때')}
      {anyTr && (
        <div className="field">
          <label htmlFor="sm-dur">전환 길이 <span className="mono dim">{durOf(cin).toFixed(2)}초</span></label>
          <input id="sm-dur" type="range" min={0.2} max={1.5} step={0.05} value={durOf(cin)} onChange={e => setDur(parseFloat(e.target.value))} />
        </div>
      )}
      <button type="button" className="btn sm danger-btn" onClick={remove}>구간 넣기 삭제</button>
    </div>
  );
}

function MarkMenu({ id, x, y, project, onFxItems, onSeek, onClose, onDeleted }: { id: string; x: number; y: number; project: Project; onFxItems: Props['onFxItems']; onSeek: (t: number) => void; onClose: () => void; onDeleted: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.tl-canvas')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, []);
  const fx = getFx(project), m = fx.punches.find(q => q.id === id)!;
  const k = markKind(m), r = MARK_AMT[k];
  const up = (patch: Partial<Punch>) => onFxItems({ punches: fx.punches.map(q => q.id === id ? { ...q, ...patch } : q) });
  const nudge = (d: number) => up({ t: Math.max(0, Math.round((m.t + d) * 1000) / 1000) });
  const left = Math.max(8, Math.min(window.innerWidth - 300, x - 146));
  const bottom = Math.max(8, window.innerHeight - y + 16);
  const amtLabel = k === 'punch' ? `+${Math.round(m.amt * 100)}%` : `${Math.round((m.amt - r.min) / (r.max - r.min) * 90 + 10)}`;
  return (
    <div ref={box} className="seg-menu mark-menu" style={{ left, bottom }} role="dialog" aria-label="효과 지점">
      <div className="sm-head">
        <span className={`mk-${k} mk-big`}><span className="mk-dot" aria-hidden="true" /></span>
        <button type="button" className="link small mono" onClick={() => onSeek(m.t)} title="이 위치로 이동">{m.t.toFixed(3)}초</button>
        <button type="button" className="btn ghost xs" onClick={() => nudge(-0.01)} title="조금 앞으로 (10ms)">◀</button>
        <button type="button" className="btn ghost xs" onClick={() => nudge(0.01)} title="조금 뒤로 (10ms)">▶</button>
        <button type="button" className="btn ghost xs" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="seg small mark-seg">
        {MARK_KINDS.map(([kk, n, , sh]) => (
          <button key={kk} type="button" title={n} className={`mk-${kk} ${k === kk ? 'on' : ''}`} onClick={() => up({ kind: kk as MarkKind, amt: kk === k ? m.amt : MARK_AMT[kk].def })}><span className="mk-dot" aria-hidden="true" />{sh}</button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="mm-amt">세기 <span className="mono dim">{amtLabel}</span></label>
        <input id="mm-amt" type="range" min={r.min} max={r.max} step={r.step} value={Math.min(r.max, Math.max(r.min, m.amt))} onChange={e => up({ amt: parseFloat(e.target.value) })} />
      </div>
      <button type="button" className="btn sm danger-btn" onClick={() => { onFxItems({ punches: fx.punches.filter(q => q.id !== id) }); onDeleted(); }}>삭제</button>
    </div>
  );
}
