// 프레임 렌더러 — 미리보기와 (다음 단계의) MP4 추출이 같은 함수를 쓴다.
import { CardLayout, Project, VideoXf, Caption, CaptionStyle, Ratio, sheetPos, getXf, defaultXf, normCaptionStyle, barStart, barLen, ratioOfWH, RATIOS, getFx, bpmAt } from './model';
import { SheetData } from './sheet';

export const FONT = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI Symbol", "Apple Symbols", sans-serif';
const HL_FILL = 'rgba(255,138,31,0.22)';
const HL_LINE = '#ff7a12';

export interface CardBox { x: number; y: number; w: number; h: number; pad: number; lineW: number; lineH: number; gap: number; footH: number }

/** 줄마다 오선 높이를 맞추기 위한 값: 오선 위·아래로 가장 많이 튀어나온 양 (가로 폭 대비) */
export function sheetMetrics(sheet: SheetData | null) {
  if (!sheet || !sheet.systems.length) return null;
  // 줄마다 오선 위·아래 여백 중 큰 쪽 기준 — 단, 쪽의 맨 끝 줄(아래 쪽 번호·다음 줄 조각)과 맨 첫 줄(제목)이
  // 유난히 길면 그 줄 때문에 모든 카드가 길어지지 않게 뺌 (그 줄의 넘치는 부분은 카드 안에서 잘림)
  const any = sheet as any;
  if (any._metrics) return any._metrics as { above: number; below: number };
  const S = sheet.systems, n = S.length;
  const pick = (val: (s: typeof S[number]) => number, edge: (i: number) => boolean) => {
    const inner = S.filter((_, i) => !edge(i)).map(val);
    if (!inner.length) return Math.max(...S.map(val));
    const base = Math.max(...inner);
    return Math.max(base, ...S.filter((_, i) => edge(i)).map(val).filter(v => v <= base * 1.3));
  };
  const firstOfPage = (i: number) => i === 0 || S[i - 1].page !== S[i].page;
  const lastOfPage = (i: number) => i === n - 1 || S[i + 1].page !== S[i].page;
  any._metrics = {
    above: pick(s => (s.staffY ?? 0) / s.canvas.width, firstOfPage),
    below: pick(s => (s.canvas.height - (s.staffY ?? 0)) / s.canvas.width, lastOfPage),
  };
  return any._metrics;
}
/** 이 줄을 칸 안에 그릴 때 위쪽 여백 (오선이 모든 줄에서 같은 높이에 오게) */
/** 마디 안에서 잉크(음표·기호)가 있는 세로 범위 (줄 그림 좌표) — 한 번 계산해서 저장 */
const alphaCache = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
function barInk(sys: SheetData['systems'][number], b: SheetData['bars'][number]): { t: number; b: number } {
  const anyB = b as any;
  if (anyB._ink) return anyB._ink;
  const cv = sys.canvas, W = cv.width, H = cv.height;
  let a = alphaCache.get(cv);
  if (!a) { a = cv.getContext('2d')!.getImageData(0, 0, W, H).data; alphaCache.set(cv, a); }
  const xa = Math.max(0, Math.round(b.x0) + 3), xb = Math.min(W, Math.round(b.x1) - 3);
  const rowInk = (y: number) => { let c = 0; for (let x = xa; x < xb; x++) if (a![(y * W + x) * 4 + 3] > 60) { if (++c > 1) return true; } return false; };
  let t = 0, bo = H - 1;
  while (t < H - 1 && !rowInk(t)) t++;
  while (bo > t && !rowInk(bo)) bo--;
  // 최소한 오선은 덮게
  if (sys.staffY !== undefined && sys.staffH) { t = Math.min(t, sys.staffY); bo = Math.max(bo, sys.staffY + sys.staffH); }
  anyB._ink = { t, b: bo };
  return anyB._ink;
}
const sysOffset = (sheet: SheetData, s: SheetData['systems'][number], lineW: number) => {
  const m = sheetMetrics(sheet)!;
  return (m.above - (s.staffY ?? 0) / s.canvas.width) * lineW;
};

/** 따라가기 모드 확대 배율: 한 화면에 보이는 마디 수에 맞춤 */
export function sheetZoom(sheet: SheetData | null, p?: Project | null) {
  const fx = p ? getFx(p) : null;
  if (!fx?.sheetFollow || !sheet || !sheet.bars.length) return 1;
  const ws = sheet.bars.map(b => b.x1 - b.x0).sort((a, b) => a - b);
  const bw = ws[Math.floor(ws.length / 2)] || 1;
  const sysW = Math.max(...sheet.systems.map(s => s.canvas.width));
  return Math.max(1, Math.min(4, sysW / (bw * Math.max(1, fx.sheetFollowBars))));
}
// 음표 진하게: 음표·기둥·빔만 1px 번지게 (오선은 그대로)
// 오선 줄(가로로 길게 꽉 찬 행)과 그 바로 위아래 행은 세로로 번지지 않게 해서 오선이 굵어지지 않음
// 오선에 닿지 않고 따로 떨어진 글씨(가사·손 순서·Ride 같은 글자)는 진하게 하지 않음 — 번져서 글자가 뭉개지지 않게
const boldCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function boldOf(src: HTMLCanvasElement, staffY?: number, staffH?: number) {
  let c = boldCache.get(src);
  if (!c) {
    const W = src.width, H = src.height;
    const sd = src.getContext('2d')!.getImageData(0, 0, W, H), a = sd.data;
    // 오선(과 오선에 붙은 음표·기둥·빔)에 이어진 잉크만 진하게: 이어진 덩어리를 찾아 오선 높이에 걸치는지 봄
    const keep = new Uint8Array(W * H);
    if (staffY !== undefined && staffH) {
      const sp = staffH / 4, y0 = staffY - sp * 0.5, y1 = staffY + staffH + sp * 0.5;
      const lab = new Int32Array(W * H), st: number[] = [];
      let id = 0;
      const bandOf: boolean[] = [false];
      for (let i = 0; i < W * H; i++) {
        if (lab[i] || a[i * 4 + 3] <= 40) continue;
        id++; lab[i] = id; st.push(i);
        let top = H, bot = -1;
        while (st.length) {
          const k = st.pop()!, ky = (k / W) | 0, kx = k - ky * W;
          if (ky < top) top = ky; if (ky > bot) bot = ky;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const ny = ky + dy, nx = kx + dx;
            if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
            const j = ny * W + nx;
            if (!lab[j] && a[j * 4 + 3] > 40) { lab[j] = id; st.push(j); }
          }
        }
        bandOf.push(bot >= y0 && top <= y1);
      }
      for (let i = 0; i < W * H; i++) if (lab[i] && bandOf[lab[i]]) keep[i] = 1;
    } else keep.fill(1);
    const A = (x: number, y: number) => (x < W && y < H && keep[y * W + x]) ? a[(y * W + x) * 4 + 3] : 0;
    // 오선 행 찾기: 진한 픽셀이 가로 폭의 50% 넘게 이어진 행
    const line = new Uint8Array(H);
    for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 120) n++; if (n > W * 0.5) line[y] = 1; }
    const near = (y: number) => line[y] || (y > 0 && line[y - 1]) || (y + 1 < H && line[y + 1]);
    const out = new ImageData(W, H), o = out.data;
    for (let y = 0; y < H; y++) {
      const nl = near(y);
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        let v = Math.max(a[k + 3], A(x + 1, y));
        if (!nl) v = Math.max(v, A(x, y + 1), A(x + 1, y + 1));
        if (!line[y] && keep[y * W + x]) v = Math.min(255, v * 1.2);    // 오선이 아닌 곳은 살짝 더 진하게 (따로 떨어진 글씨는 그대로)
        o[k] = a[k]; o[k + 1] = a[k + 1]; o[k + 2] = a[k + 2]; o[k + 3] = v;
        if (!a[k + 3] && v) { o[k] = 20; o[k + 1] = 18; o[k + 2] = 16; }
      }
    }
    c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d')!.putImageData(out, 0, 0);
    boldCache.set(src, c);
  }
  return c;
}

export function cardBox(l: CardLayout, W: number, H: number, sheet: SheetData | null, p?: Project | null): CardBox {
  const z = sheetZoom(sheet, p);
  if (z > 1) l = { ...l, lines: 1 };   // 따라가기는 한 줄만 크게
  const w = l.w * W;
  const pad = w * 0.025;
  const lineW = w - pad * 2;
  const m = sheetMetrics(sheet);
  const lineH = lineW * (m ? m.above + m.below : 0.155) * z;
  const gap = w * 0.008;
  const footH = w * 0.085;
  const h = pad + l.lines * lineH + (l.lines - 1) * gap + footH + pad * 0.4;
  return { x: l.x * W, y: l.y * H, w, h, pad, lineW, lineH, gap, footH };
}

/** 영상이 놓이는 전체 사각형(자르기 전) — 기본은 비율이 비슷하면 꽉 채우기, 다르면 전체 보이기 */
export function videoRect(W: number, H: number, vw: number, vh: number, xf: VideoXf) {
  const va = vw / vh, ca = W / H;
  // 비율이 거의 같으면 꽉 채움 · 4:5 피드는 세로 영상이면 꽉 채움(위아래만 잘림) · 그 외엔 전체가 보이게
  const cover = Math.abs(va - ca) / ca < 0.08 || (ca > 0.7 && ca < 0.9 && va < 1);
  const base = cover ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
  const s = base * xf.scale;
  const w = vw * s, h = vh * s;
  return { x: (W - w) / 2 + xf.x * W, y: (H - h) / 2 + xf.y * H, w, h, s };
}

/** 자른 뒤 실제로 보이는 사각형 */
export function croppedRect(W: number, H: number, vw: number, vh: number, xf: VideoXf) {
  const r = videoRect(W, H, vw, vh, xf), c = xf.crop;
  return { x: r.x + c.l * r.w, y: r.y + c.t * r.h, w: r.w * (1 - c.l - c.r), h: r.h * (1 - c.t - c.b), full: r };
}

export function drawVideo(ctx: CanvasRenderingContext2D, W: number, H: number, video: HTMLVideoElement | null, xf: VideoXf = defaultXf()) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!video || !video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight, c = xf.crop;
  const d = croppedRect(W, H, vw, vh, xf);
  if (d.w <= 1 || d.h <= 1) return;
  ctx.drawImage(video, c.l * vw, c.t * vh, vw * (1 - c.l - c.r), vh * (1 - c.t - c.b), d.x, d.y, d.w, d.h);
}

export function drawCard(ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  p: Project, sheet: SheetData | null, l: CardLayout) {
  const g = cardBox(l, W, H, sheet, p);
  const z = sheetZoom(sheet, p), fxs = getFx(p);
  if (z > 1) l = { ...l, lines: 1 };
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${l.opacity})`;
  ctx.beginPath(); ctx.roundRect(g.x, g.y, g.w, g.h, g.w * 0.028); ctx.fill();
  const fs = g.w * 0.036;
  const footY = g.y + g.pad + l.lines * g.lineH + (l.lines - 1) * g.gap + g.footH * 0.5;

  if (!sheet || !sheet.bars.length) {
    ctx.fillStyle = 'rgba(40,36,30,0.55)';
    ctx.font = `500 ${fs}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('악보를 불러오면 여기에 표시돼요', g.x + g.w / 2, g.y + (g.h - g.footH) / 2 + g.pad / 2);
    ctx.restore();
    return;
  }

  const N = sheet.bars.length;
  // 악보 위치 (악보 이동·박 단위 이동 포함)
  const sp = sheetPos(p, t, sheet.bars.length), idx = sp.idx, beat = sp.beat;
  let sysIdx = 0, hl = -1, activeBeat = -1;
  if (idx < 0) { sysIdx = 0; activeBeat = beat; }
  else if (idx >= N) { sysIdx = sheet.systems.length - 1; }
  else { sysIdx = sheet.bars[idx].sys; hl = idx; activeBeat = beat; }
  const bv = sp.clip?.bpm ?? bpmAt(p, t);
  const bpm = Math.abs(bv - Math.round(bv)) < 0.05 ? String(Math.round(bv)) : bv.toFixed(1);
  const label = `= ${bpm}`;

  const lx = g.x + g.pad, ly = g.y + g.pad;
  const sys = sheet.systems[sysIdx];
  const img = (c: HTMLCanvasElement) => { if (!fxs.sheetBold) return c; const sy = sheet.systems.find(x => x.canvas === c); return boldOf(c, sy?.staffY, sy?.staffH); };
  // 따라가기: 연주 위치가 창의 40% 지점에 오도록 가로로 흘러감
  const winW = sys.canvas.width / z;
  let winX = 0;
  if (z > 1) {
    let xNow = sys.barXs[0];
    if (hl >= 0) { const b = sheet.bars[hl]; xNow = b.x0 + (b.x1 - b.x0) * Math.max(0, Math.min(1, sp.frac)); }
    else if (idx >= N) xNow = sys.canvas.width;
    winX = Math.max(0, Math.min(sys.canvas.width - winW, xNow - winW * 0.4));
  }
  const sc = g.lineW / winW;
  const oy = sysOffset(sheet, sys, g.lineW) * z;
  ctx.save();
  // 악보는 악보 칸 안에만 (유난히 긴 줄이 아래 템포·박 표시를 덮지 않게)
  ctx.beginPath(); ctx.rect(lx - 1, g.y, g.lineW + 2, (ly - g.y) + l.lines * g.lineH + (l.lines - 1) * g.gap + g.pad * 0.3); ctx.clip();
  ctx.drawImage(img(sys.canvas), winX, 0, winW, sys.canvas.height, lx, ly + oy, g.lineW, sys.canvas.height * sc);
  if (l.lines === 2 && sysIdx + 1 < sheet.systems.length) {
    const nx = sheet.systems[sysIdx + 1];
    ctx.globalAlpha = 0.35;
    ctx.drawImage(img(nx.canvas), lx, ly + g.lineH + g.gap + sysOffset(sheet, nx, g.lineW), g.lineW, nx.canvas.height * (g.lineW / nx.canvas.width));
    ctx.globalAlpha = 1;
  }
  if (hl >= 0) {
    const b = sheet.bars[hl];
    const x0 = lx + (b.x0 - winX) * sc, x1 = lx + (b.x1 - winX) * sc;
    // 네모 칸: 그 마디의 음표·기호가 실제로 그려진 높이 전체 + 여유 (음표를 가로지르지 않게)
    const ink = barInk(sys, b), pad = g.lineH * 0.07;
    const y0 = Math.max(g.y + 2, ly + oy + ink.t * sc - pad), y1 = Math.min(g.y + g.h - g.footH * 0.4, ly + oy + ink.b * sc + pad);
    ctx.fillStyle = HL_FILL; ctx.strokeStyle = HL_LINE; ctx.lineWidth = g.w * 0.0045;
    ctx.beginPath(); ctx.roundRect(x0, y0, x1 - x0, y1 - y0, g.w * 0.012); ctx.fill(); ctx.stroke();
    // 진행 커서: 마디 안에서 박자에 맞춰 흐르는 세로선
    if ((p as any).fx?.sheetCursor) {
      const k = Math.max(0, Math.min(1, sp.frac));
      const pad = (x1 - x0) * 0.04, cx = x0 + pad + (x1 - x0 - pad * 2) * k;
      ctx.save();
      ctx.strokeStyle = 'rgba(232,72,48,0.95)'; ctx.lineWidth = Math.max(2, g.w * 0.006); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, y0 + (y1 - y0) * 0.06); ctx.lineTo(cx, y1 - (y1 - y0) * 0.06); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
  // 템포 표시는 작고 가늘게 (악보를 방해하지 않게)
  const tf = fs * 0.78;
  ctx.fillStyle = 'rgba(30,27,23,0.78)';
  ctx.font = `500 ${tf}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  // 4분음표 모양을 직접 그리고 옆에 "= 템포"
  {
    const hx = lx + g.pad * 0.5 + tf * 0.32, hy = footY + tf * 0.28;
    ctx.save();
    ctx.translate(hx, hy); ctx.rotate(-0.35);
    ctx.beginPath(); ctx.ellipse(0, 0, tf * 0.27, tf * 0.19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillRect(hx + tf * 0.22, hy - tf * 0.92, tf * 0.06, tf * 0.9);
  }
  ctx.fillText(label, lx + g.pad * 0.5 + tf * 0.95, footY);
  ctx.fillStyle = '#1e1b17';
  const r = g.w * 0.0105, stepX = r * 3.3;
  for (let k = 0; k < p.beatsPerBar; k++) {
    const cx = g.x + g.w - g.pad * 1.5 - (p.beatsPerBar - 1 - k) * stepX;
    ctx.fillStyle = k === activeBeat ? HL_LINE : 'rgba(30,27,23,0.18)';
    ctx.beginPath(); ctx.arc(cx, footY, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, video: HTMLVideoElement | null,
  t: number, p: Project, sheet: SheetData | null, l: CardLayout, angleId = 'main') {
  drawVideo(ctx, W, H, video, getXf(p, ratioOfWH(W, H), angleId));
  drawCard(ctx, W, H, t, p, sheet, l);
  drawCaptions(ctx, W, H, t, p);
}

export const captionStyleOf = (p: Project, ratio: Ratio): CaptionStyle => normCaptionStyle(p.captionStyles?.[ratio] ?? (ratio === '4:5' ? p.captionStyles?.['9:16'] : undefined), ratio);
/** 자막 하나에 실제로 쓰이는 스타일 (자막별 설정이 있으면 덮어씀) */
/** 글꼴(폰트·굵기·크기·자간·줄 간격·정렬)과 위치는 모든 자막 공통 */
export const CAP_SHARED: (keyof CaptionStyle)[] = ['font', 'weight', 'size', 'letter', 'lineH', 'align', 'x', 'y'];
/** 이 자막만의 꾸미기 (글꼴 항목은 빼고) — 없으면 null */
export function ownLook(c: Caption): Partial<CaptionStyle> | null {
  if (!c.style) return null;
  const o: any = { ...c.style };
  for (const k of CAP_SHARED) delete o[k];
  return Object.keys(o).length ? o : null;
}
/** 이 자막만의 위치 (4:5는 따로 정하지 않았으면 9:16 것을 따름) */
export const ownPos = (c: Caption, ratio: Ratio) => c.pos?.[ratio] || (ratio === '4:5' ? c.pos?.['9:16'] : undefined) || null;
export const styleFor = (p: Project, ratio: Ratio, c: Caption): CaptionStyle => ({ ...captionStyleOf(p, ratio), ...(ownLook(c) || {}), ...(ownPos(c, ratio) || {}) });

export const capFont = (st: CaptionStyle, px: number) => `${st.weight} ${px}px "${st.font}", ${FONT}`;

function setLetter(ctx: CanvasRenderingContext2D, px: number) {
  try { (ctx as any).letterSpacing = `${px}px`; } catch { /* 지원 안 하는 브라우저 */ }
}

/** 자막 줄바꿈: 직접 넣은 줄바꿈 + 폭을 넘으면 띄어쓰기(없으면 글자)에서 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        const sp = line.lastIndexOf(' ');
        if (sp > 0 && sp > line.length * 0.5) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
        else { out.push(line); line = ch; }
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

/** 자막 하나가 차지하는 상자 (미리보기에서 끌기용) */
export function captionBox(ctx: CanvasRenderingContext2D, W: number, H: number, c: Caption, st: CaptionStyle) {
  const fs = st.size * W;
  ctx.font = capFont(st, fs);
  setLetter(ctx, st.letter * fs);
  const lines = wrapLines(ctx, c.text || ' ', W * 0.86);
  const lh = fs * st.lineH;
  const pad = fs * st.boxPad;
  const textW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const w = textW + pad * 2;
  const h = lines.length * lh + pad * 0.9;
  setLetter(ctx, 0);
  return { x: st.x * W - w / 2, y: st.y * H - h / 2, w, h, lines, fs, lh, pad, textW };
}

export function activeCaptions(p: Project, t: number) {
  return (p.captions || []).filter(c => t >= c.start && t < c.end && c.text.trim());
}

const hexA = (hex: string, a: number) => {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** 자막 한 줄 묶음을 (cx, cy) 가운데에 그리기 — 상자 · 테두리 · 그림자 · 글자 */
function paintCaption(ctx: CanvasRenderingContext2D, cx: number, cy: number, b: ReturnType<typeof captionBox>, st: CaptionStyle, lines: string[]) {
  const bx = cx - b.w / 2, by = cy - b.h / 2;
  if (st.box) {
    ctx.fillStyle = hexA(st.boxColor, st.boxOpacity);
    ctx.beginPath(); ctx.roundRect(bx, by, b.w, b.h, b.fs * st.boxRadius); ctx.fill();
  }
  ctx.font = capFont(st, b.fs);
  setLetter(ctx, st.letter * b.fs);
  ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.textAlign = st.align;
  const tx = st.align === 'left' ? bx + b.pad : st.align === 'right' ? bx + b.w - b.pad : cx;
  lines.forEach((ln, i) => {
    const y = by + b.pad * 0.45 + b.lh * (i + 0.5);
    if (st.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = b.fs * st.shadowBlur; ctx.shadowOffsetY = b.fs * 0.04; }
    if (st.outline && st.outlineW > 0) {
      ctx.strokeStyle = st.outlineColor; ctx.lineWidth = b.fs * st.outlineW;
      ctx.strokeText(ln, tx, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = st.color;
    ctx.fillText(ln, tx, y);
    ctx.shadowColor = 'transparent';
  });
  setLetter(ctx, 0);
}

/** 자막 그림 캐시: 그림자·테두리가 들어간 글자는 매 프레임 새로 그리면 아주 느려서(추출 때 영상이 뚝뚝 끊기는 원인)
 *  한 번 그린 그림을 저장해두고 프레임마다 붙여넣기만 함. 글꼴이 아직 안 받아졌으면 저장하지 않음 */
const capSprites = new Map<string, { cv: HTMLCanvasElement; m: number; b: ReturnType<typeof captionBox>; lines: string[] }>();
const capBoxes = new Map<string, ReturnType<typeof captionBox>>();
function capKey(W: number, H: number, text: string, st: CaptionStyle) { return `${W}x${H}|${text}|${JSON.stringify(st)}`; }
function fontReady(font: string) { try { return (document as any).fonts?.check ? (document as any).fonts.check(font, '가A') : true; } catch { return true; } }
function cachedBox(ctx: CanvasRenderingContext2D, W: number, H: number, c: Caption, st: CaptionStyle) {
  const key = capKey(W, H, c.text, st);
  let b = capBoxes.get(key);
  if (!b) {
    b = captionBox(ctx, W, H, c, st);
    if (fontReady(capFont(st, b.fs))) { capBoxes.set(key, b); if (capBoxes.size > 400) capBoxes.delete(capBoxes.keys().next().value as string); }
  }
  return b;
}
function captionSprite(ctx: CanvasRenderingContext2D, W: number, H: number, c: Caption, st: CaptionStyle, text: string, b: ReturnType<typeof captionBox>) {
  const key = capKey(W, H, c.text, st) + '|' + text;
  const hit = capSprites.get(key);
  if (hit) { capSprites.delete(key); capSprites.set(key, hit); return hit; }   // 최근 쓴 것으로
  if (!fontReady(capFont(st, b.fs))) return null;
  const lines = text === c.text ? b.lines : wrapLines((ctx.font = capFont(st, b.fs), setLetter(ctx, st.letter * b.fs), ctx), text, W * 0.86);
  setLetter(ctx, 0);
  const m = Math.ceil(b.fs * (st.outlineW + st.shadowBlur * 1.6 + 0.3)) + 4;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(b.w + m * 2); cv.height = Math.ceil(b.h + m * 2);
  const g = cv.getContext('2d')!;
  paintCaption(g, m + b.w / 2, m + b.h / 2, b, st, lines);
  const sp = { cv, m, b, lines };
  capSprites.set(key, sp);
  if (capSprites.size > 120) capSprites.delete(capSprites.keys().next().value as string);
  return sp;
}

export function drawCaption(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Caption, st: CaptionStyle) {
  const b = cachedBox(ctx, W, H, c, st);
  const dt = t - c.start, left = c.end - t;
  let alpha = 1, scale = 1, dy = 0, text = c.text;
  if (st.anim === 'fade') alpha = Math.max(0, Math.min(1, dt / 0.2, left / 0.2));
  else if (st.anim === 'pop') {
    const k = Math.min(1, dt / 0.28), c1 = 1.70158, c3 = c1 + 1;
    scale = 0.6 + 0.4 * (1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2)); // 살짝 튀어나왔다 자리잡기
    alpha = Math.min(1, dt / 0.08, left / 0.15);
  }
  else if (st.anim === 'up') { const k = Math.min(1, dt / 0.3); dy = (1 - (1 - Math.pow(1 - k, 3))) * H * 0.03; alpha = Math.min(1, dt / 0.25, left / 0.2); }
  else if (st.anim === 'type') {
    const chars = Array.from(c.text), dur = Math.min(1.2, chars.length * 0.05);
    text = chars.slice(0, Math.max(1, Math.ceil(chars.length * Math.min(1, dt / dur)))).join('');
  }
  if (alpha <= 0) return;
  const cx = st.x * W, cy = st.y * H + dy;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (scale !== 1) { ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
  const sp = captionSprite(ctx, W, H, c, st, text, b);
  if (sp) ctx.drawImage(sp.cv, cx - b.w / 2 - sp.m, cy - b.h / 2 - sp.m);
  else {
    const lines = text === c.text ? b.lines : wrapLines((ctx.font = capFont(st, b.fs), ctx), text, W * 0.86);
    paintCaption(ctx, cx, cy, b, st, lines);
  }
  ctx.restore();
}

export function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: Project) {
  const ratio: Ratio = ratioOfWH(W, H);
  for (const c of activeCaptions(p, t)) drawCaption(ctx, W, H, t, c, styleFor(p, ratio, c));
}

/** 추출 전에 자막 폰트를 미리 받아두기 */
export async function preloadCaptionFonts(p: Project) {
  const fonts = (document as any).fonts;
  if (!fonts?.load) return;
  const set = new Set<string>();
  for (const r of RATIOS) { const g = captionStyleOf(p, r); set.add(`${g.weight}|${g.font}`); }
  for (const c of p.captions || []) if (c.style?.font || c.style?.weight) { const g = { ...captionStyleOf(p, '9:16'), ...c.style }; set.add(`${g.weight}|${g.font}`); }
  await Promise.all(Array.from(set).map(k => { const [w, f] = k.split('|'); return fonts.load(`${w} 40px "${f}"`, '가나다ABC').catch(() => null); }));
}

export interface Zone { x: number; y: number; w: number; h: number; label: string; soft?: boolean }
/** 인스타 릴스 기준(1080×1920): 상단 14%, 하단 최소 20% · 권장 35%, 오른쪽 버튼 줄, 좌우 6% */
export function safeZones(ratio: Ratio, W: number, H: number) {
  if (ratio === '9:16') {
    return {
      top: H * 0.14, bottom: H * 0.80, bottomSoft: H * 0.65, side: W * 0.06,
      zones: [
        { x: 0, y: 0, w: W, h: H * 0.14, label: '인스타 상단 UI' },
        { x: 0, y: H * 0.80, w: W, h: H * 0.20, label: '계정명 · 캡션 (최소 여백 20%)' },
        { x: 0, y: H * 0.65, w: W * 0.85, h: H * 0.15, label: '긴 캡션 · 음악 정보 (권장 여백 35%)', soft: true },
        { x: W * 0.85, y: H * 0.50, w: W * 0.15, h: H * 0.30, label: '좋아요 · 댓글 버튼' },
      ] as Zone[],
    };
  }
  if (ratio === '4:5') {
    // 프로필 격자는 3:4로 보여줘서 4:5 게시물은 좌우가 조금 잘림
    const cut = (W - H * 0.75) / 2;
    return { top: H * 0.03, bottom: H * 0.97, bottomSoft: H * 0.97, side: cut, zones: [
      { x: 0, y: 0, w: cut, h: H, label: '프로필 격자에서 잘림', soft: true },
      { x: W - cut, y: 0, w: cut, h: H, label: '프로필 격자에서 잘림', soft: true },
    ] as Zone[] };
  }
  return { top: H * 0.05, bottom: H * 0.95, bottomSoft: H * 0.95, side: W * 0.05, zones: [] as Zone[] };
}

