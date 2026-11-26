// 손 따라가기 (자동 짐벌): 멀리서 찍은 영상에서 손을 찾아 확대한 화면이 손을 부드럽게 따라가게
// 분석(handtrack.ts)으로 얻은 손 위치 기록 → 카메라 길(가만히 있다가 손이 화면 가장자리로 가면 부드럽게 옮겨감) → 영상 화면 변환
import { Project, VideoXf, Ratio } from './model';

/** 영상 하나(기준 영상·추가 영상·앵글)의 손 따라가기 설정과 분석 기록 */
export interface Follow {
  on: boolean;
  zoom: number;        // 화면을 꽉 채운 상태에서 몇 배 더 확대 (1 ~ 3)
  smooth: number;      // 카메라가 옮겨가는 데 걸리는 정도(초) — 작을수록 빠릿하게
  hand: -1 | 0 | 1;    // 따라갈 손: -1 자동(지판 위에서 많이 움직이는 손) · 0 화면 왼쪽 손 · 1 화면 오른쪽 손
  step: number;        // 분석 간격(초)
  tr: [number[], number[]];   // 손 위치 기록: [x, y, x, y, …] (영상 기준 0~1, 못 찾으면 -1) — 0 = 화면 왼쪽 손, 1 = 오른쪽 손
  dz?: number;         // 가만히 있는 범위 (보이는 화면 폭에 대한 비율, 기본 0.22)
}
export const defaultFollow = (): Omit<Follow, 'tr' | 'step'> => ({ on: true, zoom: 1.6, smooth: 0.45, hand: -1 });

export const followOf = (p: Project, id: string): Follow | null => (p as any).follow?.[id] || null;

/** 자동일 때 어느 손을 따라갈지: 좌우로 더 많이 움직이는 손 (지판을 오르내리는 손) */
export function pickHand(f: Follow): 0 | 1 {
  if (f.hand === 0 || f.hand === 1) return f.hand;
  const spread = (a: number[]) => {
    const xs: number[] = []; for (let i = 0; i < a.length; i += 2) if (a[i] >= 0) xs.push(a[i]);
    if (xs.length < 3) return -1;
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length) * Math.min(1, xs.length / (a.length / 2) * 2);
  };
  return spread(f.tr[0]) > spread(f.tr[1]) ? 0 : 1;
}

/** 보이는 화면이 영상의 몇 분의 몇인지 (가로, 세로) — 화면을 꽉 채운 뒤 zoom배 */
function visible(va: number, ca: number, zoom: number) {
  return { w: Math.min(1, Math.min(1, ca / va) / zoom), h: Math.min(1, Math.min(1, va / ca) / zoom) };
}

const cache = new Map<string, { x: Float32Array; y: Float32Array; step: number }>();

/** 카메라 길: 손이 '가만히 있는 범위' 안에서 움직이면 그대로, 벗어나면 손 쪽으로 옮겨가되 부드럽게 (앞뒤로 두 번씩 매끄럽게 → 늦지 않고 자연스러운 팬) */
export function followPath(f: Follow, va: number, ca: number) {
  const hand = pickHand(f), tr = f.tr[hand], n = tr.length >> 1;
  const key = [hand, f.zoom, f.smooth, f.dz ?? '', va.toFixed(3), ca.toFixed(3), f.step, n, tr.slice(0, 8).join(','), tr.slice(-8).join(',')].join('|');
  const hit = cache.get(key); if (hit) return hit;
  // 1) 못 찾은 칸 채우기 (앞뒤 아는 값 유지) — 아예 없으면 가운데
  const xs = new Float32Array(n), ys = new Float32Array(n);
  let last = -1;
  for (let i = 0; i < n; i++) if (tr[i * 2] >= 0) { last = i; break; }
  for (let i = 0; i < n; i++) {
    if (tr[i * 2] >= 0) last = i;
    xs[i] = last >= 0 ? tr[last * 2] : 0.5; ys[i] = last >= 0 ? tr[last * 2 + 1] : 0.5;
  }
  // 2) 튀는 값 없애기 (가운데 값 5칸)
  const med = (a: Float32Array) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { const w: number[] = []; for (let k = -2; k <= 2; k++) w.push(a[Math.max(0, Math.min(a.length - 1, i + k))]); w.sort((p, q) => p - q); o[i] = w[2]; } return o; };
  const mx = med(xs), my = med(ys);
  // 3) 가만히 있는 범위: 손이 범위를 벗어날 때만 목표를 손 위치로 옮김
  const vis = visible(va, ca, f.zoom), dz = f.dz ?? 0.22;
  const tx = new Float32Array(n), ty = new Float32Array(n);
  let cx = mx[0] ?? 0.5, cy = my[0] ?? 0.5;
  for (let i = 0; i < n; i++) {
    if (Math.abs(mx[i] - cx) > vis.w * dz) cx = mx[i];
    if (Math.abs(my[i] - cy) > vis.h * dz) cy = my[i];
    tx[i] = cx; ty[i] = cy;
  }
  // 4) 부드럽게: 앞으로·뒤로 지수 평활을 두 번 (늦게 따라가지 않고 S자로 스르르)
  const a = 1 - Math.exp(-f.step / Math.max(0.05, f.smooth));
  const sm = (v: Float32Array) => {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) v[i] = v[i - 1] + a * (v[i] - v[i - 1]);
      for (let i = n - 2; i >= 0; i--) v[i] = v[i + 1] + a * (v[i] - v[i + 1]);
    }
    return v;
  };
  const out = { x: sm(tx), y: sm(ty), step: f.step };
  if (cache.size > 20) cache.clear();
  cache.set(key, out);
  return out;
}

/** 덜 확대할 수 있는 한계: 영상 전체 폭(또는 높이)이 다 보일 때의 배율 (꽉 채움 = 1 기준) */
export const minFollowZoom = (va: number, ca: number) => Math.min(1, Math.max(0.2, Math.min(ca / va, va / ca)));

/** 영상 시간 s의 카메라 가운데 (영상 기준 0~1) */
export function followCenter(f: Follow, s: number, va: number, ca: number) {
  const P = followPath(f, va, ca), n = P.x.length;
  if (!n) return { x: 0.5, y: 0.5 };
  const u = Math.max(0, Math.min(n - 1, s / P.step)), i = Math.floor(u), k = u - i, j = Math.min(n - 1, i + 1);
  return { x: P.x[i] + (P.x[j] - P.x[i]) * k, y: P.y[i] + (P.y[j] - P.y[i]) * k };
}

/** 손 따라가기가 켜진 영상이면 화면 변환을 바꿔서 돌려줌 (화면을 꽉 채우고 zoom배 확대 · 손이 가운데 오게 · 빈 곳은 안 보이게) */
export function followXf(p: Project, id: string, xf: VideoXf, s: number, vw: number, vh: number, W: number, H: number): VideoXf {
  const f = followOf(p, id);
  if (!f || !f.on || !f.tr?.[0]?.length || !vw || !vh) return xf;
  const va = vw / vh, ca = W / H;
  const c0 = followCenter(f, s, va, ca);
  const c = { x: xf.flipX ? 1 - c0.x : c0.x, y: xf.flipY ? 1 - c0.y : c0.y };   // 반전한 영상이면 손 위치도 뒤집어서
  // render.videoRect와 같은 기준 배율 → 꽉 채우는 배율 × zoom
  const cover0 = Math.abs(va - ca) / ca < 0.08 || (ca > 0.7 && ca < 0.9 && va < 1);
  const base = cover0 ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
  // zoom 1 = 화면을 꽉 채움 · 1보다 작으면 덜 확대(가로 영상을 세로 화면에 넣으면 위아래가 비어서 흐린 배경으로 채움) — 영상 전체가 다 보이는 것보다 작게는 안 함
  const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
  const k = Math.max(contain, cover * Math.max(0.2, f.zoom)) / base;
  const w = vw * base * k, h = vh * base * k;
  // 화면보다 넓으면 손을 따라 좌우로(가장자리 안 넘게), 좁으면 가운데 — 세로도 같게
  const rx = w > W ? Math.max(W - w, Math.min(0, W / 2 - c.x * w)) : (W - w) / 2;
  const ry = h > H ? Math.max(H - h, Math.min(0, H / 2 - c.y * h)) : (H - h) / 2;
  return { ...xf, scale: k, x: (rx - (W - w) / 2) / W, y: (ry - (H - h) / 2) / H, crop: { l: 0, t: 0, r: 0, b: 0 }, bg: w < W - 1 || h < H - 1 ? 'blur' : undefined };
}

/** 미리보기·추출에서 쓸 영상 시간: 기준 영상·추가 영상은 그 조각의 영상 시간, 앵글은 앵글 맞춤만큼 더함 */
export function srcTimeFor(p: Project, id: string, s: number, isAngle: boolean) {
  return isAngle ? s + (p.angleOffsets?.[id] || 0) : s;
}
export type { Ratio };
