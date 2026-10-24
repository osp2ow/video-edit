// 악보 불러오기 + 줄(시스템)·마디선 자동 검출
declare const pdfjsLib: any;
export const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export interface SheetSystem {
  canvas: HTMLCanvasElement; // 투명 배경 + 어두운 음표 (영상 위에 얹기용)
  barXs: number[];           // 마디 경계 x (crop 좌표), 길이 = 마디 수 + 1
  firstBar: number;          // 이 줄 첫 마디 번호 (1부터)
  page: number;
  staffY?: number;           // 오선 맨 윗줄 위치 (crop 좌표) — 줄마다 오선 높이를 맞추는 데 씀
  staffH?: number;
}
export interface SheetBar { sys: number; x0: number; x1: number; rest: boolean }
export interface SheetData { name: string; systems: SheetSystem[]; bars: SheetBar[] }

const TARGET_W = 1650;

/** 캡처 이미지 여러 장을 위아래로 이어 붙여 한 장으로 (순서대로 한 악보로 읽기 · 클라우드에도 한 파일로 저장) */
export async function stitchImages(files: File[]): Promise<File> {
  const bmps = await Promise.all(files.map(f => createImageBitmap(f)));
  let w = Math.max(...bmps.map(b => b.width));
  const gap = () => Math.round(w * 0.04);
  let total = bmps.reduce((a, b) => a + b.height * (w / b.width), 0) + gap() * (bmps.length - 1);
  if (total > 30000) { const s = 30000 / total; w = Math.round(w * s); total = bmps.reduce((a, b) => a + b.height * (w / b.width), 0) + gap() * (bmps.length - 1); }
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.ceil(total);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const b of bmps) { const h = b.height * (w / b.width); ctx.drawImage(b, 0, y, w, h); y += h + gap(); }
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('이미지를 합치지 못했어요.');
  const base = files[0].name.replace(/\.[^.]+$/, '');
  return new File([blob], `${base} 외 ${files.length - 1}장.png`, { type: 'image/png' });
}

export async function fileToPages(file: File): Promise<HTMLCanvasElement[]> {
  const pages: HTMLCanvasElement[] = [];
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF 엔진을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: TARGET_W / vp0.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push(c);
    }
  } else {
    const bmp = await createImageBitmap(file);
    const s = bmp.width < 1200 ? TARGET_W / bmp.width : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    pages.push(c);
  }
  return pages;
}

interface Staff { top: number; bot: number; sp: number; x0: number; x1: number; bars: number[]; parts?: { top: number; bot: number }[] }

/** 캡처한 악보는 선이 연하거나(흐린 회색) 종이가 회색이거나 다크 모드(검은 바탕)일 수 있어서
 *  종이 → 흰색, 가장 진한 잉크 → 검정으로 밝기를 늘려 맞춤 (PDF처럼 깨끗한 악보는 거의 그대로) */
export function normalizeInk(gray: Uint8Array) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const pct = (q: number) => { let acc = 0; const n = gray.length * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n) return v; } return 255; };
  let paper = pct(0.6);
  if (paper < 110) {   // 다크 모드: 뒤집기
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    hist.fill(0); for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    paper = pct(0.6);
  }
  const ink = pct(0.003);
  if (paper - ink < 40) return;   // 대비가 거의 없으면 손대지 않음
  const k = 255 / (paper - ink);
  for (let i = 0; i < gray.length; i++) { const v = (gray[i] - ink) * k; gray[i] = v <= 0 ? 0 : v >= 255 ? 255 : v; }
}

export function detectPage(gray: Uint8Array, W: number, H: number): Staff[] {
  const dark = (x: number, y: number) => gray[y * W + x] < 150;
  // 1) 오선: 어두운 픽셀이 가로로 길게 이어진 행
  // 긴 빔(16분음표 묶음)도 가로로 길어서, 가장 긴 행 대비 70% 이상만 오선 후보로 본다
  const ratio = new Float32Array(H);
  let maxR = 0;
  // 작은 캡처를 키우면 선이 두 행에 걸쳐 흐려지므로 바로 아래 행까지 같이 봄
  for (let y = 0; y < H; y++) {
    let c = 0;
    const nx = y + 1 < H ? (y + 1) * W : y * W;
    for (let x = 0; x < W; x++) if (gray[y * W + x] < 150 || gray[nx + x] < 150) c++;
    ratio[y] = c / W;
    if (ratio[y] > maxR) maxR = ratio[y];
  }
  // 오선 후보: 가로로 긴 행. 기타 타브는 줄 위에 숫자가 얹혀 선이 많이 끊기므로 낮은 기준까지 후보로 보고,
  // 대신 "간격이 고른 묶음"과 "선 굵기가 비슷함"(빔은 두꺼움)으로 걸러냄
  const thrLo = Math.max(0.15, maxR * 0.3);
  const lines: { y: number; th: number; r: number }[] = [];
  let grp: number[] = [];
  // 선 위치 = 가장 진한 행들의 가운데 (타브 숫자 몸통이 선에 붙어 있어도 선 자리를 잡게), 굵기도 진한 행만 셈
  const flush = () => {
    if (grp.length) {
      const r = Math.max(...grp.map(y => ratio[y])), core = grp.filter(y => ratio[y] >= r * 0.8);
      lines.push({ y: core.reduce((a, b) => a + b) / core.length, th: core.length, r });
    }
    grp = [];
  };
  for (let y = 0; y < H; y++) {
    if (ratio[y] <= thrLo) continue;
    if (grp.length && y - grp[grp.length - 1] > 2) flush();
    grp.push(y);
  }
  flush();
  // 2) 간격이 고른 5줄(오선) 또는 6줄(기타 타브) 묶음 = 한 줄 악보. 사이에 낀 빔·글자 줄은 건너뜀
  const staves: Staff[] = [];
  const used = new Set<number>();
  const extCache = new Map<number, [number, number]>();
  const extent = (yf: number): [number, number] => {
    const y = Math.round(yf);
    let e = extCache.get(y);
    if (!e) {
      let a = W, b = -1;
      for (let x = 0; x < W; x++) if (dark(x, y) || (y > 0 && dark(x, y - 1)) || (y + 1 < H && dark(x, y + 1))) { if (x < a) a = x; b = x; }
      e = [a, b]; extCache.set(y, e);
    }
    return e;
  };
  const find = (y: number, tol: number, from: number) => {
    let bi = -1, bd = tol;
    for (let k = from; k < lines.length && lines[k].y <= y + tol; k++) { const d = Math.abs(lines[k].y - y); if (!used.has(k) && d <= bd) { bd = d; bi = k; } }
    return bi;
  };
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    let best: number[] | null = null, bestScore = -1;
    for (let jm = 0; jm < 10; jm++) {
      // 간격 후보: 바로 다음 줄들, 또는 두 칸 떨어진 줄의 절반 (가운데 줄이 숫자·글자에 묻혀 어긋난 경우)
      const j = i + 1 + (jm >> 1), m = (jm & 1) + 1;
      if (j >= lines.length) break;
      const sp = (lines[j].y - lines[i].y) / m;
      if (sp <= 4 || sp >= W / 30 || sp * 4 >= H * 0.9) continue;
      const tol = Math.max(2.5, 0.15 * sp);
      const idx = [i];
      for (let k = 1; k <= 5; k++) {
        const m = find(lines[i].y + k * sp, tol, idx[idx.length - 1] + 1);
        if (m < 0) break;
        idx.push(m);
      }
      if (idx.length < 5) continue;
      // 선 굵기·진하기가 고른지 (빔·글자 줄 섞임 방지). 6번째 줄은 나머지와 비슷할 때만 (타브)
      const five = idx.slice(0, 5).map(k => lines[k]);
      const thMin = Math.min(...five.map(l => l.th)), thMed = five.map(l => l.th).sort((a, b) => a - b)[2];
      if (five.some(l => l.th > thMin * 2 + 1)) continue;
      const strong = five.filter(l => l.r >= Math.max(0.3, maxR * 0.7)).length;
      const meanR = five.reduce((a, l) => a + l.r, 0) / 5;
      if (strong < 2 && meanR < maxR * 0.5) continue;
      let use = idx.slice(0, 5);
      if (idx.length === 6) { const l6 = lines[idx[5]]; if (l6.th <= thMed + 1 && l6.r >= meanR * 0.6) use = idx; }
      // 오선은 모두 같은 자리에서 시작해서 같은 자리에서 끝남 (빔·음표 머리 줄은 아님)
      const ex = use.map(k => extent(lines[k].y));
      const mx0 = ex.map(e => e[0]).sort((a, b) => a - b)[ex.length >> 1], mx1 = ex.map(e => e[1]).sort((a, b) => a - b)[ex.length >> 1];
      if (mx1 - mx0 < W * 0.25 || ex.some(e => e[0] > mx0 + 2 * sp || e[1] < mx1 - 2 * sp)) continue;
      // 실제 간격 고르기 확인
      const ys = use.map(k => lines[k].y), d = ys.slice(1).map((v, k) => v - ys[k]);
      const mean = d.reduce((a, b) => a + b) / d.length;
      if (Math.max(...d) - Math.min(...d) > Math.max(3, 0.25 * mean)) continue;
      const score = use.length * 10 + strong + meanR;
      if (score > bestScore) { bestScore = score; best = use; }
    }
    if (!best) continue;
    best.forEach(k => used.add(k));
    const ys = best.map(k => lines[k].y);
    const top = Math.round(ys[0]), bot = Math.round(ys[ys.length - 1]);
    const mean = (ys[ys.length - 1] - ys[0]) / (ys.length - 1);
    let x0 = W, x1 = 0;
    // 줄 시작·끝: 맨 윗줄은 타브 숫자로 끊겨 있을 수 있어서 여러 줄 중 가장 넓게
    for (const yy of ys.map(Math.round)) for (let x = 0; x < W; x++) if (dark(x, yy) || dark(x, yy + 1) || dark(x, yy - 1)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    staves.push({ top, bot, sp: mean, x0, x1, bars: [] });
  }
  staves.sort((a, b) => a.top - b.top);
  // 2-1) 오선 + 타브(또는 피아노 두 단)처럼 왼쪽 세로선으로 이어진 줄들은 한 줄(시스템)로 묶음
  for (let i = 0; i + 1 < staves.length; i++) {
    const a = staves[i], b = staves[i + 1], sp = Math.max(a.sp, b.sp);
    if (b.top - a.bot > 14 * sp || Math.abs(a.x0 - b.x0) > 2 * sp) continue;
    let linked = false;
    for (let x = Math.max(0, Math.min(a.x0, b.x0) - 2); x <= Math.max(a.x0, b.x0) + 3 && !linked; x++) {
      let c = 0;
      for (let y = a.bot; y <= b.top; y++) if (dark(x, y)) c++;
      if (c >= 0.9 * (b.top - a.bot + 1)) linked = true;
    }
    if (!linked) continue;
    const parts = [...(a.parts || [{ top: a.top, bot: a.bot }]), ...(b.parts || [{ top: b.top, bot: b.bot }])];
    staves.splice(i, 2, { top: a.top, bot: b.bot, sp: Math.min(a.sp, b.sp), x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), bars: [], parts });
    i--;
  }
  // 3) 마디선: 오선 위~아래를 정확히 꽉 채우고, 오선 밖으로는 나가지 않는 세로선 (묶인 줄은 각 단마다 꽉 채우면 됨)
  for (const s of staves) {
    const parts = s.parts || [{ top: s.top, bot: s.bot }];
    const aTop = Math.round(s.top - s.sp * 0.6), aBot = s.top - 3;
    const bTop = s.bot + 3, bBot = Math.round(s.bot + s.sp * 0.6);
    const cols: number[] = [];
    for (let x = s.x0; x <= s.x1; x++) {
      let full = true;
      for (const pt of parts) {
        let c = 0;
        for (let y = pt.top; y <= pt.bot; y++) if (dark(x, y)) c++;
        if (c < 0.95 * (pt.bot - pt.top + 1)) { full = false; break; }
      }
      if (!full) continue;
      let ca = 0, cb = 0;
      for (let y = aTop; y <= aBot; y++) if (y >= 0 && dark(x, y)) ca++;
      for (let y = bTop; y <= bBot; y++) if (y < H && dark(x, y)) cb++;
      if (ca / Math.max(1, aBot - aTop + 1) < 0.2 && cb / Math.max(1, bBot - bTop + 1) < 0.2) cols.push(x);
    }
    const xs: number[] = [];
    let cg: number[] = [];
    for (const x of cols) {
      if (cg.length && x - cg[cg.length - 1] > 2) { xs.push(cg.reduce((a, b) => a + b) / cg.length); cg = []; }
      cg.push(x);
    }
    if (cg.length) xs.push(cg.reduce((a, b) => a + b) / cg.length);
    const merged: number[] = [];
    for (const x of xs) {
      if (merged.length && x - merged[merged.length - 1] < s.sp * 1.2) merged[merged.length - 1] = x;
      else merged.push(x);
    }
    // 줄 맨 앞 세로선(시작 괄호)은 마디 경계가 아님
    while (merged.length && merged[0] - s.x0 < s.sp * 1.5) merged.shift();
    if (!merged.length || s.x1 - merged[merged.length - 1] > s.sp * 1.5) merged.push(s.x1);
    s.bars = merged;
  }
  return staves;
}

export function detectSheet(pages: HTMLCanvasElement[], name: string): SheetData {
  let underText: { off: number } | null = null;   // 줄 아래 글씨 자리 (앞 페이지에서 배운 것도 이어서 씀)
  let lastUnder = -1;
  const systems: SheetSystem[] = [];
  const bars: SheetBar[] = [];
  pages.forEach((page, pi) => {
    const W = page.width, H = page.height;
    const data = page.getContext('2d')!.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) | 0;
    normalizeInk(gray);
    const staves = detectPage(gray, W, H);
    // 줄과 줄 사이를 글씨·기호 덩어리 기준으로 나눔 (파트 표시 A·B, 템포, 셈여림이 잘리지 않게)
    const inkRow = (y: number, xa: number, xb: number) => { let c = 0; for (let x = Math.max(0, xa); x < Math.min(W, xb); x++) if (gray[y * W + x] < 170) c++; return c; };
    /** y0~y1 사이 잉크 덩어리(빈 줄로 나뉜 행 묶음) */
    const chunksIn = (y0: number, y1: number, xa: number, xb: number) => {
      const out: { top: number; bot: number }[] = [];
      let st = -1;
      for (let y = y0; y <= y1 + 1; y++) {
        const ink = y <= y1 && y >= 0 && y < H && inkRow(y, xa, xb) > 1;
        if (ink && st < 0) st = y;
        else if (!ink && st >= 0) { out.push({ top: st, bot: y - 1 }); st = -1; }
      }
      return out;
    };
    // 줄 아래에 떨어져 있는 글씨(스티킹 RLRL 같은 손 순서)의 자리를 페이지 마지막 줄 아래에서 배움
    // → 줄과 줄 사이에 같은 자리에 있는 글씨는 아래 줄이 아니라 위 줄 것으로 봄
    if (staves.length) {
      const L = staves[staves.length - 1], xa = Math.round(L.x0 - L.sp), xb = Math.round(L.x1 + L.sp);
      const ch = chunksIn(L.bot + 2, Math.min(H - 1, Math.round(L.bot + 12 * L.sp)), xa, xb);
      let k = 0;
      if (ch.length && ch[0].top <= L.bot + 2 + 0.8 * L.sp) k = 1;          // 줄에 붙어 있는 음표·기둥은 건너뜀
      const c = ch[k], prevBot = k ? ch[0].bot : L.bot;
      const after = ch[k + 1] ? ch[k + 1].top - (c?.bot ?? 0) : Infinity;
      if (c && c.bot - c.top <= 2.5 * L.sp && c.top - L.bot <= 5 * L.sp && c.top - prevBot >= 0.8 * L.sp && after >= 1.5 * L.sp) {   // 오선 바로 아래(5칸 이내)의 한 줄 글씨만
        underText = { off: (c.top - L.bot) / L.sp };
        lastUnder = c.bot;
      } else lastUnder = -1;
    }
    // 줄과 줄 사이의 기호·글씨를 하나하나(이어진 덩어리 단위로) 위 줄/아래 줄에 나눠 줌.
    // 손 순서 글씨(RLRL)와 아래 줄 악센트(>)가 같은 높이에 나란히 있어도, 각자 바로 위·아래 음표 중 가까운 쪽으로 감
    interface Gap { y0: number; y1: number; lab: Int32Array; owner: Int8Array; aBot: number; bTop: number }
    const gaps: Gap[] = [];
    for (let si = 0; si + 1 < staves.length; si++) {
      const a = staves[si], b = staves[si + 1];
      const y0 = a.bot + 1, y1 = b.top - 1, gh = y1 - y0 + 1;
      if (gh <= 2) { gaps.push({ y0, y1, lab: new Int32Array(0), owner: new Int8Array(1), aBot: a.bot, bTop: b.top }); continue; }
      const lab = new Int32Array(W * gh);
      const comps: { top: number; bot: number; l: number; r: number; own: number }[] = [{ top: 0, bot: 0, l: 0, r: 0, own: 2 }];
      const stack: number[] = [];
      for (let yy = 0; yy < gh; yy++) for (let x = 0; x < W; x++) {
        const i0 = yy * W + x;
        if (lab[i0] || gray[(yy + y0) * W + x] >= 170) continue;
        const id = comps.length, c = { top: yy, bot: yy, l: x, r: x, own: -1 };
        comps.push(c); lab[i0] = id; stack.push(i0);
        while (stack.length) {
          const k = stack.pop()!, ky = (k / W) | 0, kx = k - ky * W;
          if (ky < c.top) c.top = ky; if (ky > c.bot) c.bot = ky; if (kx < c.l) c.l = kx; if (kx > c.r) c.r = kx;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const ny = ky + dy, nx = kx + dx;
            if (ny < 0 || ny >= gh || nx < 0 || nx >= W) continue;
            const j = ny * W + nx;
            if (!lab[j] && gray[(ny + y0) * W + nx] < 170) { lab[j] = id; stack.push(j); }
          }
        }
      }
      // 줄에 닿아 있는 것(음표 기둥·머리)은 그 줄 것, 양쪽에 다 닿으면(줄을 잇는 세로선) 둘 다
      for (let k = 1; k < comps.length; k++) {
        const c = comps[k], tA = c.top === 0, tB = c.bot === gh - 1;
        c.own = tA && tB ? 2 : tA ? 0 : tB ? 1 : -1;
      }
      // 떠 있는 것들은 같은 줄에 나란한 글자끼리 묶어서 (단어 단위) 한꺼번에 판단
      const fl = comps.map((c, k) => k).filter(k => k > 0 && comps[k].own < 0);
      const grp = new Map<number, number>(); fl.forEach(k => grp.set(k, k));
      const root = (k: number): number => { let r = k; while (grp.get(r) !== r) r = grp.get(r)!; return r; };
      for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
        const p = comps[fl[i]], q = comps[fl[j]];
        const ov = Math.min(p.bot, q.bot) - Math.max(p.top, q.top), hmin = Math.min(p.bot - p.top, q.bot - q.top);
        const hg = Math.max(p.l, q.l) - Math.min(p.r, q.r);
        if (ov >= hmin * 0.5 && hg <= 1.5 * a.sp) grp.set(root(fl[i]), root(fl[j]));
      }
      // 열마다 위 줄 잉크의 맨 아래 / 아래 줄 잉크의 맨 위
      const aCol = new Int32Array(W).fill(-1), bCol = new Int32Array(W).fill(gh);
      for (let yy = 0; yy < gh; yy++) for (let x = 0; x < W; x++) {
        const id = lab[yy * W + x]; if (!id) continue;
        const o = comps[id].own;
        if (o === 0 || o === 2) aCol[x] = Math.max(aCol[x], yy);
        if ((o === 1 || o === 2) && yy < bCol[x]) bCol[x] = yy;
      }
      const groups = new Map<number, number[]>();
      for (const k of fl) { const r = root(k); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(k); }
      for (const ks of groups.values()) {
        const top = Math.min(...ks.map(k => comps[k].top)), bot = Math.max(...ks.map(k => comps[k].bot));
        const l = Math.min(...ks.map(k => comps[k].l)), r = Math.max(...ks.map(k => comps[k].r));
        let aB = -1, bT = gh;
        for (let x = Math.max(0, l - 2); x <= Math.min(W - 1, r + 2); x++) { if (aCol[x] > aB) aB = aCol[x]; if (bCol[x] < bT) bT = bCol[x]; }
        const dA = top - aB, dB = bT - bot;
        let own = dA <= dB ? 0 : 1;
        // 페이지 마지막 줄 아래 손 순서와 같은 자리면 위 줄 쪽으로 (거리가 엇비슷할 때)
        if (own === 1 && underText && Math.abs((top + y0 - a.bot) / a.sp - underText.off) <= 1 && dA < dB * 1.6) own = 0;
        for (const k of ks) comps[k].own = own;
      }
      const owner = new Int8Array(comps.length);
      let aBot = a.bot, bTop = b.top;
      for (let k = 1; k < comps.length; k++) {
        const c = comps[k]; owner[k] = c.own;
        if (c.own === 0 || c.own === 2) aBot = Math.max(aBot, c.bot + y0);
        if (c.own === 1 || c.own === 2) bTop = Math.min(bTop, c.top + y0);
      }
      gaps.push({ y0, y1, lab, owner, aBot, bTop });
    }
    staves.forEach((s, si) => {
      const xa = Math.round(s.x0 - 3 * s.sp), xb = Math.round(s.x1 + s.sp);
      // 위·아래 한계: 다른 줄과의 경계, 첫·마지막 줄은 제목·쪽 번호를 넘지 않게 빈 띠(2.5칸 이상)까지
      const edge = (from: number, dir: 1 | -1, limit: number) => {
        let y = from, run = 0, last = from;
        for (let k = 0; k < limit; k++, y += dir) {
          if (y < 0 || y >= H) break;
          if (inkRow(y, xa, xb) <= 1) { run++; if (run >= 2.5 * s.sp) break; } else { run = 0; last = y; }
        }
        return last;
      };
      const gUp = si > 0 ? gaps[si - 1] : null, gDn = si < staves.length - 1 ? gaps[si] : null;
      let top = gUp ? gUp.bTop : edge(s.top - 1, -1, Math.round(10 * s.sp));
      let bot = gDn ? gDn.aBot : edge(s.bot + 1, 1, Math.round(9 * s.sp));
      if (si === staves.length - 1 && lastUnder > bot) bot = lastUnder + 2;   // 마지막 줄 아래 손 순서 글씨까지
      // 경계 안에서 실제 잉크가 있는 곳까지만 (위아래 여백은 1칸)
      let ty = top; while (ty < s.top && inkRow(ty, xa, xb) <= 1) ty++;
      let by = bot; while (by > s.bot && inkRow(by, xa, xb) <= 1) by--;
      const cy0 = Math.max(0, Math.max(top, Math.round(ty - s.sp)));
      const cy1 = Math.min(H, Math.min(bot, Math.round(by + s.sp)) + 1);
      // 좌우: 오선 끝에서 바깥으로, 잉크가 이어지는 곳까지 (파트 표시 상자가 오선보다 왼쪽에 있어도 포함)
      const inkCol = (x: number) => { let c = 0; for (let y = cy0; y < cy1; y++) if (gray[y * W + x] < 170) c++; return c; };
      const side = (from: number, dir: 1 | -1) => {
        let x = from, run = 0, last = from;
        for (let k = 0; k < 6 * s.sp; k++, x += dir) {
          if (x < 0 || x >= W) break;
          if (inkCol(x) === 0) { run++; if (run >= s.sp) break; } else { run = 0; last = x; }
        }
        return last;
      };
      const cx0 = Math.max(0, Math.round(side(s.x0, -1) - s.sp * 0.5));
      const cx1 = Math.min(W, Math.round(side(s.x1, 1) + s.sp * 0.5));
      const cw = cx1 - cx0, ch = cy1 - cy0;
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const cctx = c.getContext('2d')!;
      const img = cctx.createImageData(cw, ch);
      /** 줄 사이 기호가 다른 줄 것이면 이 줄 그림에서는 지움 */
      const otherAt = (gx: number, gy: number) => {
        if (gx < 0 || gx >= W) return false;
        if (gUp && gy >= gUp.y0 && gy <= gUp.y1 && gUp.lab.length) { const id = gUp.lab[(gy - gUp.y0) * W + gx]; if (id && gUp.owner[id] === 0) return true; }
        if (gDn && gy >= gDn.y0 && gy <= gDn.y1 && gDn.lab.length) { const id = gDn.lab[(gy - gDn.y0) * W + gx]; if (id && gDn.owner[id] === 1) return true; }
        return false;
      };
      // 글자 가장자리의 옅은 픽셀까지 지우도록 바로 옆 칸도 봄
      const other = (gx: number, gy: number) => otherAt(gx, gy) || otherAt(gx - 1, gy) || otherAt(gx + 1, gy) || otherAt(gx, gy - 1) || otherAt(gx, gy + 1);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const gx = x + cx0, gy = y + cy0;
        const g = gray[gy * W + gx];
        const k = (y * cw + x) * 4;
        img.data[k] = 20; img.data[k + 1] = 18; img.data[k + 2] = 16;
        img.data[k + 3] = g >= 250 || other(gx, gy) ? 0 : Math.min(255, Math.max(0, (255 - g) * 1.15));
      }
      cctx.putImageData(img, 0, 0);
      const first = systems.length === 0;
      const left = s.x0 + (first ? 5.5 : 3.2) * s.sp;
      const xs = [left, ...s.bars.filter(x => x > left + s.sp)].map(x => x - cx0);   // 음자리표·박자표 세로획은 마디선이 아님
      const sysIdx = systems.length;
      systems.push({ canvas: c, barXs: xs, firstBar: bars.length + 1, page: pi, staffY: s.top - cy0, staffH: s.bot - s.top });
      // 마디별 잉크 양 → 쉼표만 있는 마디 찾기
      for (let b = 0; b < xs.length - 1; b++) {
        const xa = Math.round(xs[b] + cx0 + 3), xb = Math.round(xs[b + 1] + cx0 - 3);
        const ya = Math.round(s.top - 4 * s.sp), yb = Math.round(s.bot + 4 * s.sp);
        let ink = 0;
        for (let y = Math.max(0, ya); y < Math.min(H, yb); y++) for (let x = xa; x < xb; x++) ink += 255 - gray[y * W + x];
        bars.push({ sys: sysIdx, x0: xs[b], x1: xs[b + 1], rest: false, ink: ink / Math.max(1, xb - xa) } as any);
      }
    });
  });
  const inks = bars.map((b: any) => b.ink).sort((a, b) => a - b);
  const med = inks[Math.floor(inks.length / 2)] || 1;
  bars.forEach((b: any) => { b.rest = b.ink < med * 0.45; delete b.ink; });
  return { name, systems, bars };
}

/** 악보 맨 앞에 이어지는 쉼표 마디 수 */
export const leadingRests = (s: SheetData) => { let k = 0; while (k < s.bars.length && s.bars[k].rest) k++; return k; };

/** 못갖춘마디 추정: 첫 마디가 쉼표가 아니고 다른 마디보다 눈에 띄게 좁으면, 폭 비율로 박 수를 어림한다 */
export function guessPickup(s: SheetData, bpb: number): number {
  if (s.bars.length < 3 || s.bars[0].rest) return 0;
  const w = s.bars.map(b => b.x1 - b.x0);
  const others = w.slice(1).filter((_, i) => !s.bars[i + 1].rest).sort((a, b) => a - b);
  if (!others.length) return 0;
  const med = others[Math.floor(others.length / 2)];
  const r = w[0] / med;
  if (r >= 0.6) return 0;
  return Math.max(1, Math.min(bpb - 1, Math.round(r * bpb)));
}
