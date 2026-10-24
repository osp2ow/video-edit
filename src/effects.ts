// 결과물 한 프레임을 그리는 곳 — 미리보기와 MP4 추출이 같이 쓴다.
// 순서: 영상(전환·분할·박자 효과) → 비네트 → 악보 카드 → 자막 → 로고 → 플래시 → 인트로/엔딩 카드 → 페이드
import { colorFilterFor, joinFilter } from './colormatch';
import { retouchFaces } from './face';
import { CardLayout, Project, Fx, ColorFilter, TransType, MAIN, getFx, getXf, angleAt, barLen, beatLen, LAYOUT_LABEL, cardSpan, ratioOfWH, cardAlpha, srcAt, CardStyle, cardStyleOf, NEUTRAL_FILTER, sheetClipAt, cardPageAt, FIRST_PAGE } from './model';
import { SheetData } from './sheet';
import { Angle } from './angles';
import { drawVideo, drawCard, drawCaptions, FONT, safeZones } from './render';

export interface Env {
  master: HTMLVideoElement;
  angles: Angle[];
  project: Project;
  sheet: SheetData | null;
  layout: CardLayout;
  range: [number, number]; // 시작·끝 효과의 기준 구간
  frames?: Map<string, HTMLVideoElement | null>;   // 추출용: 파일에서 직접 풀어낸 장면 (있으면 <video> 대신). 추가 영상은 'src:'+id
  sources?: Map<string, HTMLVideoElement>;         // 추가로 올린 영상들 (조각의 src → <video>)
  sheets?: Map<string, SheetData>;                 // 두 번째부터 넣은 악보들 (악보 조각의 sheet 이름 → 악보)
}

/** t에 보여줄 악보 파일 (악보 조각마다 다른 악보일 수 있음) */
export function sheetAt(p: Project, sheet: SheetData | null, sheets: Map<string, SheetData> | undefined, t: number): SheetData | null {
  if (!sheets?.size) return sheet;
  const c = sheetClipAt(p, t, sheet?.bars.length || 0);
  if (c?.sheet && c.sheet !== sheet?.name) return sheets.get(c.sheet) ?? sheet;
  return sheet;
}

/** 지금 조각이 추가 영상이면 그 영상 id (첫 영상이면 null) */
export function clipSrcAt(env: Env, t: number): string | null {
  const m = srcAt(env.project, t, env.master.duration || 0);
  return m && m.clip.src ? m.clip.src : null;
}

const ratioOf = ratioOfWH;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

export const FILTER_PRESETS: Record<string, { label: string; f: ColorFilter }> = {
  none: { label: '기본', f: { brightness: 1, contrast: 1, saturate: 1, sepia: 0, hue: 0 } },
  mono: { label: '흑백', f: { brightness: 1.02, contrast: 1.12, saturate: 0, sepia: 0, hue: 0 } },
  warm: { label: '따뜻하게', f: { brightness: 1.03, contrast: 1.02, saturate: 1.12, sepia: 0.22, hue: 0 } },
  cool: { label: '시원하게', f: { brightness: 1.02, contrast: 1.05, saturate: 0.95, sepia: 0, hue: 12 } },
  vivid: { label: '선명하게', f: { brightness: 1.02, contrast: 1.15, saturate: 1.3, sepia: 0, hue: 0 } },
  vintage: { label: '빈티지', f: { brightness: 1.05, contrast: 0.9, saturate: 0.8, sepia: 0.45, hue: 0 } },
};

export const filterCss = (f: ColorFilter) => {
  const parts: string[] = [];
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
  if (f.sepia) parts.push(`sepia(${f.sepia})`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  return parts.length ? parts.join(' ') : 'none';
};

// 영상이 잠깐 준비 안 된 순간(탐색·버퍼링)에는 마지막으로 그린 장면을 대신 씀
const lastFrame = new WeakMap<HTMLVideoElement, { c: HTMLCanvasElement; t: number }>();
function frameOf(v: HTMLVideoElement): HTMLVideoElement | null {
  let rec = lastFrame.get(v);
  // 위치를 찾는 중(seeking)이거나 다시 불러오는 중이면 화면에 아직 엉뚱한 장면(예: 첫 장면)이 있을 수 있어서 마지막 장면을 씀
  const busy = v.seeking || (v as any).__hold || (v as any).__seekHold;
  if (v.readyState >= 2 && v.videoWidth && !(busy && rec && rec.t >= 0)) {
    if (!rec) { rec = { c: document.createElement('canvas'), t: -1 }; lastFrame.set(v, rec); }
    if (rec.t !== v.currentTime) {
      if (rec.c.width !== v.videoWidth) { rec.c.width = v.videoWidth; rec.c.height = v.videoHeight; }
      rec.c.getContext('2d')!.drawImage(v, 0, 0);
      rec.t = v.currentTime;
    }
    return v;
  }
  if (rec && rec.t >= 0) {
    // 캔버스를 영상처럼 쓰기 위해 videoWidth/videoHeight를 붙여서 돌려줌
    const c: any = rec.c; c.videoWidth = c.width; c.videoHeight = c.height;
    return c as HTMLVideoElement;
  }
  return null;
}

/** 앵글 id → 그 시점에 쓸 수 있는 영상 (없거나 범위 밖이면 null) */
function videoFor(env: Env, id: string, t: number): HTMLVideoElement | null {
  // 타임라인 시간 → 기준 영상 시간 (조각 사이 빈자리면 검은 화면)
  const m = srcAt(env.project, t, env.master.duration || 0);
  if (!m) return null;
  if (m.clip.src) {
    // 추가 영상 조각: 앵글 없이 그 영상만
    if (id !== m.clip.src) return null;
    if (env.frames) return env.frames.get('src:' + id) ?? null;
    const el = env.sources?.get(id);
    return el && el.videoWidth ? frameOf(el) : null;
  }
  if (id === MAIN) return env.frames ? env.frames.get(MAIN) ?? null : env.master.videoWidth ? frameOf(env.master) : null;
  const a = env.angles.find(x => x.id === id);
  if (!a || !a.ready) return null;
  const at = m.s + (env.project.angleOffsets[a.id] || 0);
  if (at < 0 || (a.video.duration && at > a.video.duration)) return null;
  const tr = env.project.trims?.[a.id];
  if (tr && (at < tr.in || at > tr.out)) return null;   // 줄여서 안 쓰는 부분
  if (env.frames) return env.frames.get(a.id) ?? null;
  return frameOf(a.video);
}

/** 칸 안을 꽉 채우게 영상 그리기 (분할 화면용) */
function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement | null, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
  if (!v || !v.videoWidth) return;
  const s = Math.max(w / v.videoWidth, h / v.videoHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, x, y, w, h);
}

/** PIP 작은 화면 자리 (픽셀). 저장된 위치가 없으면 기본 자리(오른쪽 위) */
export function pipBox(W: number, H: number, p: Project) {
  const ratio = ratioOf(W, H);
  const ar = ratio === '16:9' ? 9 / 16 : 1.25;   // 높이/폭
  const pos = p.pip?.[ratio];
  const w = W * (pos?.w ?? (ratio === '9:16' ? 0.4 : ratio === '4:5' ? 0.36 : 0.3)), h = w * ar;
  const x = pos ? pos.x * W : W - w - W * 0.04, y = pos ? pos.y * H : ratio === '9:16' ? H * 0.16 : H * 0.05;
  return { x, y, w, h, ar };
}

/** 앵글 하나(또는 분할·PIP 구성)를 화면 전체에 그리기 */
export function drawSource(ctx: CanvasRenderingContext2D, W: number, H: number, id: string, t: number, env: Env) {
  const fx = getFx(env.project);
  const ratio = ratioOf(W, H);
  const prevFilter = ctx.filter;
  const base = filterCss(fx.filterOn === false ? NEUTRAL_FILTER : fx.filter);
  const fil = (aid: string) => joinFilter(colorFilterFor(fx.colorMatch.on, fx.colorMatch.m, aid), base);   // 앵글 색 맞춤 + 화면 필터
  ctx.filter = base;
  const ids = [MAIN, ...env.angles.map(a => a.id)];
  const cs = clipSrcAt(env, t);
  if (cs) {
    // 추가 영상: 분할·앵글 없이 그 영상 하나를 화면 가득
    ctx.filter = base;
    drawVideo(ctx, W, H, videoFor(env, cs, t), getXf(env.project, ratio, cs));
    ctx.filter = prevFilter;
    return;
  }
  if (id === 'split2' || id === 'quad') {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const g = W * 0.006;
    if (id === 'split2') {
      const cells = ratio !== '16:9'
        ? [[0, 0, W, H / 2 - g / 2], [0, H / 2 + g / 2, W, H / 2 - g / 2]]
        : [[0, 0, W / 2 - g / 2, H], [W / 2 + g / 2, 0, W / 2 - g / 2, H]];
      cells.forEach((c, i) => { ctx.filter = ids[i] ? fil(ids[i]) : base; drawCover(ctx, ids[i] ? videoFor(env, ids[i], t) : null, c[0], c[1], c[2], c[3]); });
    } else {
      const cw = (W - g) / 2, ch = (H - g) / 2;
      [[0, 0], [cw + g, 0], [0, ch + g], [cw + g, ch + g]].forEach((c, i) => {
        ctx.filter = ids[i] ? fil(ids[i]) : base; drawCover(ctx, ids[i] ? videoFor(env, ids[i], t) : null, c[0], c[1], cw, ch); });
    }
  } else if (id === 'pip') {
    drawVideo(ctx, W, H, videoFor(env, MAIN, t), getXf(env.project, ratio, MAIN));
    const small = ids[1] ? videoFor(env, ids[1], t) : null;
    const { x, y, w, h } = pipBox(W, H, env.project);
    ctx.save();
    if (ids[1]) ctx.filter = fil(ids[1]);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, w * 0.06); ctx.clip();
    drawCover(ctx, small, x, y, w, h);
    ctx.restore();
    ctx.filter = 'none';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = W * 0.005;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, w * 0.06); ctx.stroke();
  } else {
    // 앵글이 줄여져서 없는 부분이면 기준 영상으로 대신
    const v = videoFor(env, id, t);
    const use = v || id === MAIN ? id : MAIN;
    ctx.filter = fil(use);
    drawVideo(ctx, W, H, v || (id === MAIN ? null : videoFor(env, MAIN, t)), getXf(env.project, ratio, use));
  }
  ctx.filter = prevFilter;
}

// 전환 그릴 때 쓰는 보조 캔버스
const bufs: HTMLCanvasElement[] = [];
function buf(i: number, W: number, H: number) {
  if (!bufs[i]) bufs[i] = document.createElement('canvas');
  const c = bufs[i];
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c.getContext('2d')!;
}

/** 지금 시점의 전환 (없으면 null) */
export function transitionAt(p: Project, t: number) {
  const fx = getFx(p);
  for (const c of p.cuts) {
    const type: TransType = c.tr?.type || fx.trType;
    if (type === 'cut') continue;
    const d = c.tr?.dur || fx.trDur;
    if (t >= c.t - d / 2 && t < c.t + d / 2) {
      return { type, k: (t - (c.t - d / 2)) / d, from: angleAt(p.cuts, c.t - 1e-4), to: c.angle };
    }
  }
  return null;
}

function drawProgram(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, env: Env) {
  const tr = transitionAt(env.project, t);
  if (!tr) { drawSource(ctx, W, H, angleAt(env.project.cuts, t), t, env); return; }
  const a = buf(0, W, H), b = buf(1, W, H);
  drawSource(a, W, H, tr.from, t, env);
  drawSource(b, W, H, tr.to, t, env);
  const A = a.canvas, B = b.canvas, k = tr.k, e = ease(k);
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  switch (tr.type) {
    case 'dissolve':
      ctx.drawImage(A, 0, 0); ctx.globalAlpha = k; ctx.drawImage(B, 0, 0); break;
    case 'black': case 'white': {
      ctx.drawImage(k < 0.5 ? A : B, 0, 0);
      ctx.globalAlpha = k < 0.5 ? k * 2 : (1 - k) * 2;
      ctx.fillStyle = tr.type === 'black' ? '#000' : '#fff'; ctx.fillRect(0, 0, W, H); break;
    }
    case 'slide':
      ctx.drawImage(A, -e * W, 0); ctx.drawImage(B, (1 - e) * W, 0); break;
    case 'wipe':
      ctx.drawImage(A, 0, 0); ctx.beginPath(); ctx.rect(0, 0, e * W, H); ctx.clip(); ctx.drawImage(B, 0, 0); break;
    case 'zoom': {
      const s1 = 1 + 0.25 * e, s2 = 1.25 - 0.25 * e;
      ctx.globalAlpha = 1 - e; ctx.drawImage(A, W / 2 - W * s1 / 2, H / 2 - H * s1 / 2, W * s1, H * s1);
      ctx.globalAlpha = e; ctx.drawImage(B, W / 2 - W * s2 / 2, H / 2 - H * s2 / 2, W * s2, H * s2); break;
    }
    case 'blur': {
      ctx.filter = `blur(${(W * 0.025 * Math.sin(Math.PI * k)).toFixed(1)}px)`;
      ctx.drawImage(A, 0, 0); ctx.globalAlpha = k; ctx.drawImage(B, 0, 0); break;
    }
    default: ctx.drawImage(k < 0.5 ? A : B, 0, 0);
  }
  ctx.restore();
}

/** 박자 효과: 펀치 줌 · 흔들림 · 플래시의 세기 */
function beatMods(p: Project, fx: Fx, t: number) {
  let s = 1, dx = 0, dy = 0, flash = 0, shakeAmp = 0, shakeDt = 0;
  // 직접 찍은 지점
  let bp: { dt: number; amt: number } | null = null, bf: typeof bp = null, bs: typeof bp = null;
  for (const m of fx.marksOn === false ? [] : fx.punches) {
    const d = t - m.t; if (d < 0) continue;
    const k = m.kind || 'punch';
    if (k === 'punch' && d < 0.3 && (!bp || d < bp.dt)) bp = { dt: d, amt: m.amt };
    else if (k === 'flash' && d < 0.22 && (!bf || d < bf.dt)) bf = { dt: d, amt: m.amt };
    else if (k === 'shake' && d < 0.3 && (!bs || d < bs.dt)) bs = { dt: d, amt: m.amt };
  }
  if (bp) s += bp.amt * Math.pow(1 - bp.dt / 0.3, 2);
  if (bf) flash = Math.max(flash, bf.amt * (1 - bf.dt / 0.22));
  if (bs) { shakeAmp = bs.amt * (1 - bs.dt / 0.3); shakeDt = bs.dt; }
  if (shakeAmp > 0) {
    dx = shakeAmp * Math.sin(shakeDt * 95); dy = shakeAmp * Math.cos(shakeDt * 77);
    s = Math.max(s, 1 + 2.4 * shakeAmp); // 흔들려도 가장자리가 비지 않게 살짝 확대
  }
  return { s, dx, dy, flash };
}

const imgCache = new Map<string, HTMLImageElement>();
function logoImg(src: string | null) {
  if (!src) return null;
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.src = src; imgCache.set(src, im); }
  return im.complete && im.naturalWidth ? im : null;
}

/** 카드 글자가 들어갈 수 있는 화면 안 영역 (인스타 UI 가이드라인 안쪽) */
export function cardSafeRect(W: number, H: number) {
  const ratio = ratioOfWH(W, H), sz = safeZones(ratio, W, H);
  const side = ratio === '9:16' ? W * 0.15 : Math.max(sz.side, W * 0.05) + W * 0.02;   // 릴스는 오른쪽 버튼 줄만큼 양쪽 여백
  return { l: side, r: W - side, t: sz.top + H * 0.02, b: (ratio === '9:16' ? sz.bottomSoft : sz.bottom) - H * 0.02 };
}
/** 카드 글상자 세로 위치 제한: 가이드라인 안쪽, 단 영상 정가운데는 언제나 허용 (기본 위치) */
export function clampCardY(cy: number, h: number, H: number, S: { t: number; b: number }) {
  const lo = Math.min(S.t + h / 2, H / 2), hi = Math.max(S.b - h / 2, H / 2);
  return Math.max(lo, Math.min(hi, cy));
}
export interface CardLayoutResult {
  x: number; y: number; w: number; h: number; cx: number; cy: number;
  tl: string[]; sl: string[]; ts: number; ss: number; lw: number; lh: number; st: CardStyle;
}
/** 카드 글상자 배치: 상자 폭 안에서 줄바꿈 → 가이드라인 안에 안 들어가면 글자 크기를 줄임 */
export function layoutTitleCard(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, sub: string, st: CardStyle, logo: HTMLImageElement | null): CardLayoutResult {
  const base = Math.min(W, H), S = cardSafeRect(W, H);
  const fullW = S.r - S.l;
  const bw = st.w > 0 ? Math.max(W * 0.2, Math.min(fullW, st.w * W)) : fullW;
  const cx = Math.max(S.l + bw / 2, Math.min(S.r - bw / 2, st.x * W));
  const fam = `"${st.font}", ${FONT}`;
  const wrap = (text: string, font: string) => {
    ctx.font = font;
    const out: string[] = [];
    for (const para of text.split('\n')) {
      const words = para.split(/(\s+)/).filter(w => w.length);
      let line = '';
      for (const w of words) {
        const tryL = line + w;
        if (line.trim() && ctx.measureText(tryL.trimEnd()).width > bw) { out.push(line.trimEnd()); line = w.trimStart(); }
        else line = tryL;
      }
      out.push(line.trimEnd());
    }
    return out;
  };
  let k = 1, tl: string[] = [], sl: string[] = [], ts = 0, ss = 0, lw = 0, lh = 0, total = 0;
  for (let i = 0; i < 16; i++) {
    ts = base * 0.085 * st.size * k; ss = base * 0.042 * st.subSize * k;
    tl = title ? wrap(title, `${st.weight} ${ts}px ${fam}`) : [];
    sl = sub ? wrap(sub, `${st.subWeight} ${ss}px ${fam}`) : [];
    lw = logo ? base * 0.22 * st.size * k : 0; lh = logo ? lw * logo.naturalHeight / logo.naturalWidth : 0;
    total = (logo ? lh + (tl.length || sl.length ? ts * 0.5 : 0) : 0) + tl.length * ts * 1.18 + (tl.length && sl.length ? ts * 0.35 : 0) + sl.length * ss * 1.35;
    ctx.font = `${st.weight} ${ts}px ${fam}`; const wT = Math.max(0, ...tl.map(l => ctx.measureText(l).width));
    ctx.font = `${st.subWeight} ${ss}px ${fam}`; const wS = Math.max(0, ...sl.map(l => ctx.measureText(l).width));
    if (total <= S.b - S.t && wT <= bw + 0.5 && wS <= bw + 0.5) break;
    k *= 0.9;
  }
  const cy0 = st.y >= 0 ? st.y * H : H / 2;   // 기본: 영상 정가운데 (가이드라인 밖으로 넘치면 안쪽으로 밀어 넣음)
  const cy = clampCardY(cy0, total, H, S);
  return { x: cx - bw / 2, y: cy - total / 2, w: bw, h: total, cx, cy, tl, sl, ts, ss, lw, lh, st };
}

/** 인트로·엔딩 카드: 어두운 배경 + 글상자. bg=false면 글자만, textA는 글자만의 투명도 (문구가 바뀔 때) */
function drawTitleCard(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, sub: string, a: number, logo: HTMLImageElement | null, rise: number, st: CardStyle, bg = true, textA = 1) {
  if (a <= 0) return;
  ctx.save();
  if (bg) { ctx.globalAlpha = a; ctx.fillStyle = `rgba(8,7,5,${st.dim})`; ctx.fillRect(0, 0, W, H); }
  ctx.globalAlpha = a * textA;
  if (ctx.globalAlpha <= 0.001) { ctx.restore(); return; }
  const L = layoutTitleCard(ctx, W, H, title, sub, st, logo);
  const fam = `"${st.font}", ${FONT}`;
  const tx = st.align === 'left' ? L.x : st.align === 'right' ? L.x + L.w : L.cx;
  let y = L.y + rise * Math.min(W, H) * 0.03;
  if (logo) {
    const lx = st.align === 'left' ? L.x : st.align === 'right' ? L.x + L.w - L.lw : L.cx - L.lw / 2;
    ctx.drawImage(logo, lx, y, L.lw, L.lh); y += L.lh + (L.tl.length || L.sl.length ? L.ts * 0.5 : 0);
  }
  ctx.textAlign = st.align; ctx.textBaseline = 'middle';
  ctx.fillStyle = st.color; ctx.font = `${st.weight} ${L.ts}px ${fam}`;
  for (const l of L.tl) { ctx.fillText(l, tx, y + L.ts * 0.59); y += L.ts * 1.18; }
  if (L.tl.length && L.sl.length) y += L.ts * 0.35;
  ctx.fillStyle = st.subColor; ctx.font = `${st.subWeight} ${L.ss}px ${fam}`;
  for (const l of L.sl) { ctx.fillText(l, tx, y + L.ss * 0.67); y += L.ss * 1.35; }
  ctx.restore();
}

/** 지금 보이는 인트로/엔딩 카드와 글상자 (미리보기에서 끌어 옮기기용) */
export function activeTitleCard(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: Project, range: [number, number]): { kind: 'intro' | 'outro'; box: CardLayoutResult; page: string } | null {
  const fx = getFx(p), [r0, r1] = range, logo = logoImg(fx.logo);
  for (const kind of ['outro', 'intro'] as const) {
    const c = fx[kind], lg = kind === 'outro' ? logo : null;
    if (!c.on || !(c.title || c.sub || lg || (kind === 'outro' && fx.outro.pages?.length))) continue;
    const [st, en] = cardSpan(fx, kind, r0, r1);
    if (t >= st && t <= en) {
      const pg = kind === 'outro' ? cardPageAt(fx.outro, t - st).page : { id: FIRST_PAGE, title: c.title, sub: c.sub };
      return { kind, page: pg.id, box: layoutTitleCard(ctx, W, H, pg.title, pg.sub, cardStyleOf(c), lg) };
    }
  }
  return null;
}

/** 결과물 한 프레임 */
export function renderComposite(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, env: Env, opts: { viewTrack?: string | null; beforeCard?: () => void; ghostCard?: boolean; preview?: boolean } = {}) {
  const p = env.project, fx = getFx(p);
  const [r0, r1] = env.range;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // 1) 영상
  if (opts.viewTrack) {
    drawSource(ctx, W, H, opts.viewTrack, t, env);
    retouchFaces(ctx, W, H, fx.face);
  } else {
    const m = beatMods(p, fx, t);
    // 서서히 확대: 구간 안에서 시작 배율 → 끝 배율 (예전 전체 설정도 지원)
    const zOn = fx.zoomOn !== false;
    let kb = zOn && fx.kenBurns > 0 && r1 > r0 && !fx.zooms.length ? 1 + fx.kenBurns * clamp01((t - r0) / (r1 - r0)) : 1;
    for (const z of zOn ? fx.zooms : []) if (t >= z.start && t < z.end) kb = z.from + (z.to - z.from) * ease(clamp01((t - z.start) / (z.end - z.start)));
    const s = m.s * kb;
    if (s !== 1 || m.dx || m.dy) {
      ctx.save();
      ctx.translate(W / 2 + m.dx * W, H / 2 + m.dy * H); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
      drawProgram(ctx, W, H, t, env);
      ctx.restore();
    } else drawProgram(ctx, W, H, t, env);
    retouchFaces(ctx, W, H, fx.face);   // 얼굴 보정 (자막·악보는 영향 없음)
    // 2) 비네트
    if (fx.vignette > 0 && fx.filterOn !== false) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.75 * fx.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (m.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${m.flash})`; ctx.fillRect(0, 0, W, H); }
  }

  // 3) 악보 카드 · 자막
  opts.beforeCard?.();
  {
    // 악보 카드: 타임라인 '악보' 줄의 구간에서만 (편집 화면에서는 숨은 구간도 흐리게 보여줌)
    // 악보 숨김이면 안 그림 · 악보가 없으면 미리보기에서만 자리 안내 (추출 영상에는 빈 카드가 들어가지 않게)
    const sh = sheetAt(p, env.sheet, env.sheets, t);
    const hidden = getFx(p).sheetHidden || (!sh?.bars.length && !opts.preview);
    const ca = hidden ? 0 : sh?.bars.length ? cardAlpha(p, t, env.sheet?.bars.length || 0) : 1;
    const a = Math.max(ca, opts.ghostCard ? 0.22 : 0);
    if (a > 0.001) { ctx.save(); ctx.globalAlpha = a; drawCard(ctx, W, H, t, p, sh, env.layout); ctx.restore(); }
  }
  drawCaptions(ctx, W, H, t, p);
  if (opts.viewTrack) return;

  // 4) 로고 워터마크
  const logo = logoImg(fx.logo);
  if (fx.watermark.on && logo) {
    const w = W * fx.watermark.size, h = w * logo.naturalHeight / logo.naturalWidth, mg = W * 0.04;
    const top = ratioOf(W, H) === '9:16' ? H * 0.15 : mg;
    const x = fx.watermark.pos.endsWith('l') ? mg : W - w - mg;
    const y = fx.watermark.pos.startsWith('t') ? top : H - h - (ratioOf(W, H) === '9:16' ? H * 0.21 : mg);
    ctx.save(); ctx.globalAlpha = fx.watermark.opacity; ctx.drawImage(logo, x, y, w, h); ctx.restore();
  }

  // 5) 인트로 · 엔딩 카드
  if (fx.intro.on && (fx.intro.title || fx.intro.sub)) {
    const [st] = cardSpan(fx, 'intro', r0, r1), dt = t - st, d = fx.intro.dur;
    if (dt >= 0 && dt < d) drawTitleCard(ctx, W, H, fx.intro.title, fx.intro.sub, Math.min(1, dt / 0.3, (d - dt) / 0.5), null, Math.max(0, 1 - dt / 0.6), cardStyleOf(fx.intro));
  }
  if (fx.outro.on && (fx.outro.title || fx.outro.sub || logo || fx.outro.pages?.length)) {
    const [st] = cardSpan(fx, 'outro', r0, r1), d = fx.outro.dur, dt = t - st;
    // 엔딩 카드는 끝까지 같은 밝기 그대로 (중간에 서서히 밝아지지 않게)
    if (dt >= 0 && dt <= d) {
      const a = Math.max(0, Math.min(1, dt / 0.5)), cs = cardStyleOf(fx.outro);
      const { page, prev, since } = cardPageAt(fx.outro, dt);
      if (!prev) drawTitleCard(ctx, W, H, page.title, page.sub, a, logo, Math.max(0, 1 - dt / 0.6), cs);
      else {
        // 다음 문구로: 배경은 그대로, 앞 문구는 빠르게 사라지고 새 문구가 살짝 올라오며 나타남
        drawTitleCard(ctx, W, H, '', '', a, null, 0, cs, true, 0);
        const out = 1 - clamp01(since / 0.25), inn = clamp01((since - 0.1) / 0.35);
        if (out > 0) drawTitleCard(ctx, W, H, prev.title, prev.sub, a, logo, 0, cs, false, out);
        drawTitleCard(ctx, W, H, page.title, page.sub, a, logo, Math.max(0, 1 - since / 0.6), cs, false, inn);
      }
    }
  }

  // 6) 페이드 인 · 아웃
  let fade = 0;
  if (fx.fadeIn > 0 && t < r0 + fx.fadeIn) fade = Math.max(fade, 1 - clamp01((t - r0) / fx.fadeIn));
  if (fx.fadeOut > 0 && t > r1 - fx.fadeOut) fade = Math.max(fade, clamp01((t - (r1 - fx.fadeOut)) / fx.fadeOut));
  if (fade > 0) { ctx.fillStyle = fx.fadeColor === 'white' ? `rgba(255,255,255,${fade})` : `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
}

export const layoutLabel = (id: string) => LAYOUT_LABEL[id];
