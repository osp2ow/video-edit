// 영상에서 손 위치 찾기 (구글 MediaPipe Hands — 브라우저 안에서만 돌아감, 영상이 밖으로 나가지 않음)
// 영상을 일정 간격으로 넘기며 장면마다 손(최대 2개)을 찾아 → 화면 왼쪽 손 / 오른쪽 손 위치 기록
const MP_VER = '0.4.1675469240';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VER}/`;

type Pt = { x: number; y: number; s?: number };   // s: 손 크기 (영상 폭 기준)
/** 테스트용: window.__pveHandStub(t) 가 있으면 그것으로 손 위치를 받음 */
type Detector = { detect(img: HTMLCanvasElement, t: number, last: (Pt | null)[]): Promise<Pt[]>; close(): void };

let scriptP: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if ((window as any).Hands) return Promise.resolve();
  if (scriptP) return scriptP;
  scriptP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = MP_BASE + 'hands.js'; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => { scriptP = null; rej(new Error('손 인식 프로그램을 불러오지 못했어요 (인터넷 연결 확인)')); };
    document.head.appendChild(s);
  });
  return scriptP;
}

async function mediapipe(): Promise<Detector> {
  const stub = (window as any).__pveHandStub;
  if (stub) return { detect: async (_c, t) => stub(t), close() {} };
  await loadScript();
  const H = (window as any).Hands;
  const hands = new H({ locateFile: (f: string) => MP_BASE + f });
  hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.45, minTrackingConfidence: 0.4, selfieMode: false });
  let resolve: ((r: any) => void) | null = null;
  hands.onResults((r: any) => { const f = resolve; resolve = null; f?.(r); });
  await hands.initialize();
  // 한 영역(sx, sy, side×side 정사각형)만 잘라서 손 찾기 → 전체 화면 좌표로
  const crop = document.createElement('canvas'); crop.width = crop.height = 384;
  const cctx = crop.getContext('2d')!;
  const run = async (img: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number): Promise<Pt[]> => {
    const full = sx === 0 && sy === 0 && sw === img.width && sh === img.height;
    let src: HTMLCanvasElement = img;
    if (!full) { cctx.fillStyle = '#000'; cctx.fillRect(0, 0, 384, 384); cctx.drawImage(img, sx, sy, sw, sh, 0, 0, 384, 384 * sh / sw); src = crop; }
    hands.reset();   // 영역마다 새로 찾게 (이전 영역의 손을 이어서 찾지 않게)
    const r: any = await new Promise(res => { resolve = res; hands.send({ image: src }).catch(() => res({})); });
    const out: Pt[] = [];
    for (const lm of r?.multiHandLandmarks || []) {
      // 손 전체(21점) 가운데 — 손가락까지 같이 화면에 담기게
      let x = 0, y = 0, x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of lm) { x += p.x; y += p.y; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      x /= lm.length; y /= lm.length;
      // 잘라낸 칸(정사각형 sw×sh)의 0~1 → 전체 화면 0~1 · 크기는 전체 화면 폭 기준
      const fx = (sx + x * sw) / img.width, fy = (sy + y * sh) / img.height;
      out.push({ x: fx, y: fy, s: Math.max((x1 - x0) * sw, (y1 - y0) * sh) / img.width });
    }
    return out;
  };
  const merge = (all: Pt[]) => {
    const out: Pt[] = [];
    for (const h of all) if (!out.some(o => Math.hypot(o.x - h.x, o.y - h.y) < Math.max(0.03, (o.s || 0.1) * 0.5))) out.push(h);
    return out;
  };
  let sinceTiles = 99;
  return {
    async detect(img, _t, last) {
      const W = img.width, H = img.height;
      // 1) 화면 전체 (손이 크게 나온 영상) — 직전에 작은 손 둘을 이미 알고 있으면 건너뜀
      const small = last[0] && last[1] && (last[0].s || 1) < 0.15 && (last[1].s || 1) < 0.15;
      let found = small ? [] : await run(img, 0, 0, W, H);
      if (found.length >= 2) return found.slice(0, 2);
      // 2) 직전 손 자리 둘레를 확대해서 (멀리서 찍어 손이 작은 영상)
      for (const l of last) {
        if (!l || found.some(f => Math.hypot(f.x - l.x, f.y - l.y) < 0.05)) continue;
        const side = Math.min(W, H, Math.max(H * 0.3, (l.s || 0.1) * W * 3.2));
        const sx = Math.max(0, Math.min(W - side, l.x * W - side / 2)), sy = Math.max(0, Math.min(H - side, l.y * H - side / 2));
        found = merge([...found, ...await run(img, sx, sy, side, side)]);
      }
      if (found.length >= 2) return found.slice(0, 2);
      // 3) 아직 모자라면 화면을 겹치는 칸으로 나눠 훑기 (손을 놓쳤을 때 · 자주는 안 함)
      if (sinceTiles >= 4 || !found.length) {
        sinceTiles = 0;
        const side = Math.round(Math.min(W, H) * 0.62), stride = side * 0.7;
        const nx = Math.max(1, Math.ceil((W - side) / stride) + 1), ny = Math.max(1, Math.ceil((H - side) / stride) + 1);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const sx = nx === 1 ? 0 : Math.round((W - side) * i / (nx - 1)), sy = ny === 1 ? 0 : Math.round((H - side) * j / (ny - 1));
          found = merge([...found, ...await run(img, sx, sy, side, side)]);
        }
      } else sinceTiles++;
      return found.sort((a, b) => (b.s || 0) - (a.s || 0)).slice(0, 2);
    },
    close() { try { hands.close(); } catch { /* 이미 닫힘 */ } },
  };
}

/** 영상 src 전체를 step초 간격으로 훑어서 두 손 위치 기록 */
export async function trackHands(src: string, opts: { step?: number; from?: number; to?: number; onProgress?: (k: number) => void; signal?: { stop: boolean } }) {
  const step = opts.step ?? 0.2;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('영상을 열지 못했어요')); setTimeout(() => res(), 15000); });
  if (!v.videoWidth) throw new Error('영상을 열지 못했어요');
  const det = await mediapipe();
  const W = Math.min(1280, v.videoWidth), Hh = Math.round(W * v.videoHeight / v.videoWidth);   // 손이 작아도 확대해서 찾을 수 있게 넉넉히
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const dur = v.duration || 0, n = Math.max(1, Math.floor(dur / step) + 1);
  const tr: [number[], number[]] = [new Array(n * 2).fill(-1), new Array(n * 2).fill(-1)];
  const last: (Pt | null)[] = [null, null];
  try {
    for (let i = 0; i < n; i++) {
      if (opts.signal?.stop) throw new Error('멈춤');
      const t = Math.min(dur - 0.01, i * step);
      await new Promise<void>(res => { const f = () => { v.removeEventListener('seeked', f); res(); }; v.addEventListener('seeked', f); v.currentTime = t; setTimeout(f, 3000); });
      ctx.drawImage(v, 0, 0, W, Hh);
      const hs = (await det.detect(c, t, last)).filter(h => h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1).slice(0, 2);
      // 손 두 개: 처음엔 화면 왼쪽 → 0, 오른쪽 → 1, 그다음부터는 직전 위치와 이어지게 (손이 좌우로 엇갈려도 안 바뀌게) · 하나면 직전 위치와 더 가까운 쪽
      let as: [Pt | null, Pt | null] = [null, null];
      const dist = (a: Pt | null, b: Pt) => a ? Math.hypot(a.x - b.x, a.y - b.y) : 0.5;
      if (hs.length === 2) {
        hs.sort((a, b) => a.x - b.x);
        as = last[0] && last[1] && dist(last[0], hs[1]) + dist(last[1], hs[0]) < dist(last[0], hs[0]) + dist(last[1], hs[1]) ? [hs[1], hs[0]] : [hs[0], hs[1]];
      }
      else if (hs.length === 1) {
        const h = hs[0], d = (p: Pt | null) => p ? Math.hypot(p.x - h.x, p.y - h.y) : Infinity;
        const k = last[0] || last[1] ? (d(last[0]) <= d(last[1]) ? 0 : 1) : (h.x < 0.5 ? 0 : 1);
        as[k] = h;
      }
      for (const k of [0, 1] as const) { const h = as[k]; if (h) { tr[k][i * 2] = +h.x.toFixed(4); tr[k][i * 2 + 1] = +h.y.toFixed(4); last[k] = h; } }
      opts.onProgress?.((i + 1) / n);
    }
  } finally { det.close(); v.removeAttribute('src'); v.load(); }
  const found = [0, 1].map(k => { let m = 0; for (let i = 0; i < n; i++) if (tr[k][i * 2] >= 0) m++; return m / n; });
  return { tr, step, found: Math.max(found[0], found[1]) };
}
