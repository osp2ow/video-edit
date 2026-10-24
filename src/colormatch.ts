// 앵글 간 색 맞추기: 기준 영상의 밝기·색 분포에 다른 앵글을 맞춤 (채널별 배율 + 더하기)
// 그릴 때는 SVG feColorMatrix 필터를 캔버스 filter로 씀

const ids = new Map<string, string>();
let defs: SVGSVGElement | null = null;
const NS = 'http://www.w3.org/2000/svg';

function filterId(angleId: string) {
  let id = ids.get(angleId);
  if (!id) { id = 'cmf' + (ids.size + 1); ids.set(angleId, id); }
  return id;
}

/** 캔버스 filter 문자열 앞에 붙일 색 맞춤 필터 ('' 이면 없음) */
export function colorFilterFor(on: boolean, m: Record<string, number[]>, angleId: string): string {
  if (!on || !m[angleId]) return '';
  const v = m[angleId];
  const id = filterId(angleId);
  if (!defs) {
    defs = document.createElementNS(NS, 'svg') as SVGSVGElement;
    defs.setAttribute('width', '0'); defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(defs);
  }
  let f = defs.querySelector('#' + id) as SVGFilterElement | null;
  const values = `${v[0]} 0 0 0 ${v[3]}  0 ${v[1]} 0 0 ${v[4]}  0 0 ${v[2]} 0 ${v[5]}  0 0 0 1 0`;
  if (!f) {
    f = document.createElementNS(NS, 'filter') as SVGFilterElement;
    f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB');
    const cm = document.createElementNS(NS, 'feColorMatrix');
    cm.setAttribute('type', 'matrix');
    f.appendChild(cm); defs.appendChild(f);
  }
  const cm = f.firstChild as SVGElement;
  if (cm.getAttribute('values') !== values) cm.setAttribute('values', values);
  return `url(#${id})`;
}

/** 두 필터 문자열 합치기 ('none' 처리) */
export function joinFilter(a: string, b: string) {
  const x = a && a !== 'none' ? a : '', y = b && b !== 'none' ? b : '';
  return (x + ' ' + y).trim() || 'none';
}

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>(res => {
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05));
    setTimeout(done, 3000);
  });
}
function openVideo(src: string) {
  return new Promise<HTMLVideoElement>((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = src;
    v.onloadeddata = () => res(v); v.onerror = () => rej(new Error('video'));
    setTimeout(() => rej(new Error('timeout')), 15000);
  });
}

/** 채널별 평균·표준편차 (너무 어둡거나 밝은 곳은 빼고) */
function stats(list: Uint8ClampedArray[]) {
  const s = [0, 0, 0], q = [0, 0, 0]; let n = 0;
  for (const d of list) for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], l = (r + g + b) / 3;
    if (l < 10 || l > 245) continue;
    s[0] += r; s[1] += g; s[2] += b; q[0] += r * r; q[1] += g * g; q[2] += b * b; n++;
  }
  if (n < 500) return null;
  const mean = s.map(x => x / n), sd = q.map((x, k) => Math.sqrt(Math.max(1, x / n - mean[k] * mean[k])));
  return { mean, sd };
}

/** 기준 영상에 맞춘 [r,g,b 배율, r,g,b 더하기] 계산 */
export async function computeColorMatch(mainSrc: string, angleSrc: string, offset: number, duration: number): Promise<number[] | null> {
  const [a, b] = await Promise.all([openVideo(mainSrc), openVideo(angleSrc)]);
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  const grab = (v: HTMLVideoElement) => { cx.drawImage(v, 0, 0, 96, 96); return cx.getImageData(0, 0, 96, 96).data.slice(); };
  const A: Uint8ClampedArray[] = [], B: Uint8ClampedArray[] = [];
  const lo = Math.max(0, -offset) + 0.5, hi = Math.min(duration, (b.duration || duration) - offset) - 0.5;
  const N = 8;
  for (let i = 0; i < N; i++) {
    const t = lo + (hi - lo) * (i + 0.5) / N;
    if (!(t >= 0)) continue;
    await seek(a, t); await seek(b, t + offset);
    A.push(grab(a)); B.push(grab(b));
  }
  a.removeAttribute('src'); b.removeAttribute('src'); a.load(); b.load();
  const sa = stats(A), sb = stats(B);
  if (!sa || !sb) return null;
  const out = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const g = Math.max(0.75, Math.min(1.35, sa.sd[k] / sb.sd[k]));
    const off = (sa.mean[k] - g * sb.mean[k]) / 255;
    out[k] = Math.round(g * 1000) / 1000;
    out[k + 3] = Math.round(Math.max(-0.2, Math.min(0.2, off)) * 1000) / 1000;
  }
  return out;
}
