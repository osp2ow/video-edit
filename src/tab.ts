// 기타 타브 악보(PDF)에서 줄·프렛 숫자를 읽어 → 시간에 맞춰 기타 지판(코드표 모양)으로 보여주기
// PDF 안의 글자를 그대로 읽음 (글자가 '텍스트'인 PDF, 또는 주니퍼 기타 타브처럼 글자를 모양으로 그린 PDF).
// 캡처 그림(사진)은 아직 못 읽음.
declare const pdfjsLib: any;

/** 페이지 위 글자 하나 (페이지 그림 px 좌표) */
export interface Glyph { x0: number; y0: number; x1: number; y1: number; ch: string }
/** 타브 음 하나: bar = 악보 마디 순번(0부터), pos = 마디 안 위치(0~1), str = 줄(0 = 6번줄 … 5 = 1번줄), fret = 프렛 */
export interface TabNote { bar: number; pos: number; str: number; fret: number }

type M = number[];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 글자 모양 하나 (같은 모양은 한 번만 알아봄) */
interface Shape { ops: number[]; xy: number[] }

/** 한 페이지의 글자들 (vp = 페이지를 그릴 때 쓴 화면 변환) */
export async function pageGlyphs(page: any, vp: any): Promise<Glyph[]> {
  const out: Glyph[] = [];
  // 1) 글자가 텍스트로 들어 있는 PDF (기타 프로·뮤즈스코어 등)
  try {
    const tc = await page.getTextContent();
    for (const it of tc.items || []) {
      const s: string = it.str || '';
      if (!s.trim() || !/^[\d()xX\s]+$/.test(s)) continue;
      const m = mul(vp.transform, it.transform);
      const h = Math.hypot(m[2], m[3]), w = (it.width || 0) * Math.hypot(vp.transform[0], vp.transform[1]);
      const cw = w / s.length;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === ' ') continue;
        const x = m[4] + i * cw, y = m[5];
        out.push({ x0: x, x1: x + cw, y0: y - h * 0.72, y1: y, ch: s[i].toUpperCase() });
      }
    }
  } catch { /* 텍스트 없음 */ }
  if (out.length) return out;
  // 2) 글자를 모양(폼)으로 그린 PDF: 그리기 명령을 따라가며 글자 모양과 자리를 모음
  const ol = await page.getOperatorList();
  const O = pdfjsLib.OPS;
  const inst: { m: M; sh: Shape; key: string }[] = [];
  let ctm: M = vp.transform.slice();
  const stack: M[] = [];
  const forms: { m: M; ops: number[]; xy: number[] }[] = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save) stack.push(ctm);
    else if (f === O.restore) ctm = stack.pop() || ctm;
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.paintFormXObjectBegin) {
      stack.push(ctm);
      if (a && a[0]) ctm = mul(ctm, a[0]);
      forms.push({ m: ctm, ops: [], xy: [] });
    } else if (f === O.paintFormXObjectEnd) {
      const fm = forms.pop(); ctm = stack.pop() || ctm;
      if (fm && fm.ops.length && fm.ops.length < 400) {
        const key = fm.ops.length + ':' + fm.xy.slice(0, 40).map(v => Math.round(v)).join(',') + ':' + fm.xy.length;
        inst.push({ m: fm.m, sh: { ops: fm.ops, xy: fm.xy }, key });
      }
    } else if (f === O.constructPath && forms.length) {
      const fm = forms[forms.length - 1];
      // 폼 안에서 바뀐 변환은 폼 기준으로 다시 맞춤 (대부분 없음)
      const rel = ctm === fm.m ? null : ctm;
      const ops: number[] = a[0], xy: number[] = a[1];
      let k = 0;
      for (const op of ops) {
        const n = op === O.moveTo || op === O.lineTo ? 2 : op === O.curveTo ? 6 : op === O.curveTo2 || op === O.curveTo3 ? 4 : op === O.rectangle ? 4 : 0;
        if (op === O.rectangle) {   // 네모는 네 점으로
          const [x, y, w, h] = xy.slice(k, k + 4);
          const pts = [x, y, x + w, y, x + w, y + h, x, y + h];
          fm.ops.push(O.moveTo, O.lineTo, O.lineTo, O.lineTo, O.closePath);
          for (let j = 0; j < 8; j += 2) { const [px, py] = rel ? relPt(rel, fm.m, pts[j], pts[j + 1]) : [pts[j], pts[j + 1]]; fm.xy.push(px, py); }
        } else {
          fm.ops.push(op);
          for (let j = 0; j < n; j += 2) { const [px, py] = rel ? relPt(rel, fm.m, xy[k + j], xy[k + j + 1]) : [xy[k + j], xy[k + j + 1]]; fm.xy.push(px, py); }
        }
        k += n;
      }
    }
  }
  if (!inst.length) return out;
  // 같은 모양끼리 묶어서 한 번씩 알아봄
  const kinds = new Map<string, { sh: Shape; ch: string | null }>();
  for (const g of inst) if (!kinds.has(g.key)) kinds.set(g.key, { sh: g.sh, ch: null });
  const ref = refGlyphs();
  for (const k of kinds.values()) k.ch = classify(k.sh, ref);
  for (const g of inst) {
    const ch = kinds.get(g.key)!.ch;
    if (!ch) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < g.sh.xy.length; j += 2) {
      const [x, y] = ap(g.m, g.sh.xy[j], g.sh.xy[j + 1]);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (isFinite(x0)) out.push({ x0, y0, x1, y1, ch });
  }
  return out;
}
/** 폼 안에서 따로 변환된 점을 폼 좌표로 */
function relPt(cur: M, form: M, x: number, y: number) {
  const [px, py] = ap(cur, x, y);
  const d = form[0] * form[3] - form[1] * form[2] || 1;
  const ux = px - form[4], uy = py - form[5];
  return [(form[3] * ux - form[2] * uy) / d, (-form[1] * ux + form[0] * uy) / d];
}

// ---------- 글자 모양 알아보기: 작은 격자에 그려서 숫자·X·괄호 본보기와 비교 ----------
const GW = 14, GH = 20;
const CHARS = '0123456789X()';
let refCache: { ch: string; v: Float32Array; asp: number }[] | null = null;

function normGrid(draw: (ctx: CanvasRenderingContext2D) => void, size = 96): { v: Float32Array; asp: number } | null {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#000';
  draw(ctx);
  const d = ctx.getImageData(0, 0, size, size).data;
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (d[(y * size + x) * 4] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  // 가로세로 비율을 지키며 격자 가운데에
  const s = Math.max(w / GW, h / GH), ox = x0 + w / 2 - (GW * s) / 2, oy = y0 + h / 2 - (GH * s) / 2;
  const v = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let sum = 0, n = 0;
    for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
      const px = Math.floor(ox + (gx + (xx + 0.5) / 3) * s), py = Math.floor(oy + (gy + (yy + 0.5) / 3) * s);
      n++; if (px >= 0 && py >= 0 && px < size && py < size && d[(py * size + px) * 4] < 128) sum++;
    }
    v[gy * GW + gx] = sum / n;
  }
  return { v, asp: w / h };
}

function refGlyphs() {
  if (refCache) return refCache;
  const out: { ch: string; v: Float32Array; asp: number }[] = [];
  const fonts = ['Pretendard', 'Inter', 'Arial', 'Helvetica', 'DejaVu Sans', 'Roboto', 'sans-serif'];
  for (const f of fonts) for (const wgt of ['700', '500']) for (const ch of CHARS) {
    const g = normGrid(ctx => { ctx.font = `${wgt} 64px "${f}", sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(ch, 48, 50); });
    if (g) out.push({ ch, ...g });
  }
  return (refCache = out);
}

function classify(sh: Shape, ref: { ch: string; v: Float32Array; asp: number }[]): string | null {
  // 모양을 그려서 격자로
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < sh.xy.length; j += 2) { const x = sh.xy[j], y = sh.xy[j + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!isFinite(x0) || x1 - x0 <= 0 && y1 - y0 <= 0) return null;
  const O = pdfjsLib.OPS;
  const tryDraw = (flip: boolean) => normGrid(ctx => {
    const s = 80 / Math.max(x1 - x0, y1 - y0, 1e-6);
    ctx.save();
    ctx.translate(48 - ((x0 + x1) / 2) * s, 48 + (flip ? ((y0 + y1) / 2) * s : -((y0 + y1) / 2) * s));
    ctx.scale(s, flip ? -s : s);
    ctx.beginPath();
    let k = 0;
    for (const op of sh.ops) {
      if (op === O.moveTo) { ctx.moveTo(sh.xy[k], sh.xy[k + 1]); k += 2; }
      else if (op === O.lineTo) { ctx.lineTo(sh.xy[k], sh.xy[k + 1]); k += 2; }
      else if (op === O.curveTo) { ctx.bezierCurveTo(sh.xy[k], sh.xy[k + 1], sh.xy[k + 2], sh.xy[k + 3], sh.xy[k + 4], sh.xy[k + 5]); k += 6; }
      else if (op === O.curveTo2 || op === O.curveTo3) { ctx.quadraticCurveTo(sh.xy[k], sh.xy[k + 1], sh.xy[k + 2], sh.xy[k + 3]); k += 4; }
      else if (op === O.closePath) ctx.closePath();
    }
    ctx.fill('nonzero');
    ctx.restore();
  });
  // 글자 좌표는 위아래가 뒤집혀 있을 수 있어서 둘 다 해 보고 더 잘 맞는 쪽
  let best: string | null = null, bestD = Infinity;
  for (const flip of [false, true]) {
    const g = tryDraw(flip);
    if (!g) continue;
    for (const r of ref) {
      let d = 0;
      for (let i = 0; i < r.v.length; i++) { const e = r.v[i] - g.v[i]; d += e * e; }
      d = d / r.v.length + 0.6 * Math.abs(Math.log((r.asp + 0.05) / (g.asp + 0.05)));
      if (d < bestD) { bestD = d; best = r.ch; }
    }
  }
  return bestD < 0.09 ? best : null;
}

// ---------- 줄·마디에 맞춰 음으로 ----------
export interface TabSys { page: number; ox: number; oy: number; staffY: number; staffH: number; lines: number; barXs: number[]; firstBar: number; left: number }

/** 타브 줄(6줄) 위에 놓인 숫자들 → 마디 안 위치·줄·프렛 */
export function tabNotes(glyphsByPage: Glyph[][], systems: TabSys[]): TabNote[] {
  const notes: TabNote[] = [];
  for (const s of systems) {
    if (s.lines !== 6 || s.barXs.length < 2) continue;
    const gs = glyphsByPage[s.page] || [];
    const sp = s.staffH / 5, top = s.oy + s.staffY;
    // 줄 위 글자: 가운데가 줄에서 0.35칸 안 · 키는 1.3칸 이하 · 첫 마디 시작 뒤
    const on: (Glyph & { str: number; cx: number })[] = [];
    for (const g of gs) {
      const cy = (g.y0 + g.y1) / 2, cx = (g.x0 + g.x1) / 2, h = g.y1 - g.y0;
      if (h > sp * 1.3 || h < sp * 0.3) continue;
      const li = Math.round((cy - top) / sp);
      if (li < 0 || li > 5 || Math.abs(cy - (top + li * sp)) > sp * 0.35) continue;
      if (cx - s.ox < s.barXs[0] || cx - s.ox > s.barXs[s.barXs.length - 1]) continue;
      on.push({ ...g, str: 5 - li, cx });
    }
    // 같은 줄에서 붙어 있는 숫자 = 두 자리 프렛 · 괄호 안 숫자 = 붙임줄로 이어지는 음(새로 치지 않음) · X = 뮤트
    const raw: { x: number; str: number; fret: number }[] = [];
    for (let str = 0; str < 6; str++) {
      const row = on.filter(g => g.str === str).sort((a, b) => a.x0 - b.x0);
      let i = 0;
      while (i < row.length) {
        const g = row[i];
        if (g.ch === '(') {   // 괄호 끝까지 건너뜀
          let j = i + 1; while (j < row.length && row[j].ch !== ')' && j - i < 4) j++;
          i = j + 1; continue;
        }
        if (!/\d/.test(g.ch)) { i++; continue; }
        let txt = g.ch, x0 = g.x0, x1 = g.x1, j = i + 1;
        while (j < row.length && /\d/.test(row[j].ch) && row[j].x0 - x1 < (g.y1 - g.y0) * 0.35 && txt.length < 2) { txt += row[j].ch; x1 = row[j].x1; j++; }
        const fret = parseInt(txt, 10);
        if (fret <= 24) raw.push({ x: x0 - s.ox, str, fret });   // 글자 왼쪽 끝 기준 (두 자리 숫자도 같은 자리에서 시작)
        i = j;
      }
    }
    // 마디마다: 첫 음까지 여백(줄마다 가운데 값)을 빼고 비례로 위치
    const byBar: { b: number; xs: typeof raw }[] = [];
    for (let b = 0; b + 1 < s.barXs.length; b++) {
      const xa = s.barXs[b], xb = s.barXs[b + 1];
      byBar.push({ b, xs: raw.filter(n => n.x >= xa && n.x < xb) });
    }
    // 여백은 괄호·X까지 포함한 첫 글자 기준 (붙임줄 음으로 시작하는 마디도 있어서)
    const allX = on.map(g => g.x0 - s.ox);
    const pads = byBar.map(m => { const xs = allX.filter(x => x >= s.barXs[m.b] && x < s.barXs[m.b + 1]); return xs.length ? Math.min(...xs) - s.barXs[m.b] : NaN; })
      .filter(v => isFinite(v)).sort((a, b) => a - b);
    const pad = pads.length ? pads[Math.floor(pads.length / 2)] : sp;
    for (const m of byBar) {
      const xa = s.barXs[m.b] + pad, xb = s.barXs[m.b + 1] - pad * 0.35;
      for (const n of m.xs) notes.push({ bar: s.firstBar - 1 + m.b, pos: Math.max(0, Math.min(0.999, (n.x - xa) / Math.max(1, xb - xa))), str: n.str, fret: n.fret });
    }
  }
  return notes.sort((a, b) => a.bar - b.bar || a.pos - b.pos || a.str - b.str);
}

// ---------- 지금 시간의 지판 ----------
export interface TabDot { s: number; f: number; on: boolean }
export interface TabView { base: number; span: number; dots: TabDot[]; start: number; end: number }

/** 마디 안 같은 자리 음끼리 묶음 */
function groupsOf(ns: TabNote[]) {
  const gs: { pos: number; ns: TabNote[] }[] = [];
  for (const n of ns) { const g = gs[gs.length - 1]; if (g && Math.abs(g.pos - n.pos) < 0.012) g.ns.push(n); else gs.push({ pos: n.pos, ns: [n] }); }
  return gs;
}

/** bar 마디의 frac 위치에서 보여줄 지판: 그 마디 음들(흐리게 = 스케일 모양) + 지금 치는 음(밝게) */
export function tabViewAt(notes: TabNote[], bar: number, frac: number): Omit<TabView, 'start' | 'end'> & { win: [number, number] } | null {
  const inBar = notes.filter(n => n.bar === bar);
  if (!inBar.length) return null;
  const gs = groupsOf(inBar);
  let cur = -1;
  for (let i = 0; i < gs.length; i++) if (gs[i].pos <= frac + 1e-6) cur = i;
  let curNs = cur >= 0 ? gs[cur].ns : [];
  if (cur < 0) { const prev = notes.filter(n => n.bar === bar - 1); const pg = groupsOf(prev); if (pg.length && gs[0].pos > 0.02) curNs = pg[pg.length - 1].ns; }
  // 지판 범위: 마디 전체 → 너무 넓으면 반 마디 → 4분의 1 마디
  let win: [number, number] = [0, 1], pick = inBar;
  const span = (ns: TabNote[]) => { const f = ns.map(n => n.fret).filter(x => x > 0); return f.length ? Math.max(...f) - Math.min(...f) + 1 : 1; };
  for (const parts of [1, 2, 4]) {
    const k = Math.min(parts - 1, Math.floor(frac * parts));
    win = [k / parts, (k + 1) / parts];
    pick = inBar.filter(n => n.pos >= win[0] - 1e-6 && n.pos < win[1]);
    if (!pick.length) pick = curNs.length ? curNs : inBar;
    if (span(pick) <= 7) break;
  }
  const shown = [...pick, ...curNs];
  const fr = shown.map(n => n.fret).filter(x => x > 0);
  const lo = fr.length ? Math.min(...fr) : 1, hi = fr.length ? Math.max(...fr) : 4;
  const base = lo <= 2 ? 1 : lo, sp = Math.max(4, hi - base + 1);
  const dots: TabDot[] = [];
  const seen = new Set<string>();
  for (const n of shown) {
    const key = n.str + ':' + n.fret;
    if (seen.has(key)) continue; seen.add(key);
    dots.push({ s: n.str, f: n.fret, on: curNs.some(c => c.str === n.str && c.fret === n.fret) });
  }
  return { base, span: sp, dots, win };
}
