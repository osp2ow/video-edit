// 오디오 분석: 타격음(onset) 엔벨로프, BPM 추정, 녹음본 자동 싱크, 파형
import { makeFFT } from './fft';

export const SR = 22050;
export const HOP = 256;
export const NFFT = 1024;
export const HOP_SEC = HOP / SR;
export const PEAKS_RATE = 200; // 파형 표시용: 초당 200칸

export interface Onset { t: number; s: number }
export interface Track {
  mono: Float32Array;
  env: Float32Array;
  low: Float32Array; // 저음(킥) 대역 타격 세기 — 강박 찾기용
  mid: Float32Array; // 중음(스네어) 대역 타격 세기 — 2·4박 백비트로 템포 2배·절반 가리기용
  peaks: Float32Array;
  onsets: Onset[];
  duration: number;
  bias: number; // 엔벨로프 기준 시간이 실제 타격보다 이른 정도(초) — 그리드 보정용
}

export async function decodeMono(ab: ArrayBuffer, sr = SR): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, sr);
  const buf = await ctx.decodeAudioData(ab);
  const n = buf.length, out = new Float32Array(n), ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / ch;
  }
  return out;
}

export function analyzeTrack(mono: Float32Array): Track {
  const { env, low, mid } = onsetEnvelopes(mono);
  const rough = pickOnsets(env);
  const onsets = rough.map(o => ({ t: refineAttack(mono, o.t), s: o.s }));
  const d = onsets.map((o, i) => o.t - rough[i].t).sort((a, b) => a - b);
  const bias = d.length ? d[Math.floor(d.length / 2)] : 0;
  return { mono, env, low, mid, peaks: computePeaks(mono), onsets, duration: mono.length / SR, bias };
}

/** 원본 파형에서 소리가 가장 가파르게 커지는 지점(1ms 단위)을 찾아 타격 시각을 다듬는다 */
export function refineAttack(x: Float32Array, t: number): number {
  const fr = 22; // 약 1ms
  const a = Math.floor((t - 0.035) * SR), n = Math.floor(0.07 * SR / fr);
  if (a < 0 || a + n * fr >= x.length) return t;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < fr; k++) { const v = x[a + i * fr + k]; s += v * v; }
    e[i] = Math.sqrt(s / fr);
  }
  let best = -1, bi = -1;
  for (let i = 3; i < n; i++) {
    const d = e[i] - e[i - 3];
    if (d > best) { best = d; bi = i; }
  }
  if (bi < 0) return t;
  // 가파른 구간의 시작점: 상승 폭의 20%를 처음 넘는 프레임
  const base = e[bi - 3], thr = base + best * 0.2;
  let j = bi - 3;
  while (j < bi && e[j] < thr) j++;
  return (a + j * fr) / SR;
}

/** 스펙트럼 플럭스 기반 타격음 세기. 프레임 i의 중심 = i*HOP 샘플. */
export function onsetEnvelope(x: Float32Array): Float32Array { return onsetEnvelopes(x).env; }

export function onsetEnvelopes(x: Float32Array): { env: Float32Array; low: Float32Array; mid: Float32Array } {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const g = peak > 0 ? 1 / peak : 1;
  const half = NFFT / 2, nFrames = Math.floor(x.length / HOP) + 1;
  const win = new Float32Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT);
  const fft = makeFFT(NFFT);
  const re = new Float32Array(NFFT), im = new Float32Array(NFFT), prev = new Float32Array(half);
  const env = new Float32Array(nFrames), low = new Float32Array(nFrames), mid = new Float32Array(nFrames);
  const midA = Math.round(150 / (SR / NFFT)), midB = Math.round(2500 / (SR / NFFT));   // 스네어 몸통·울림 대역 (하이햇 위쪽은 뺌)
  const lowBins = Math.max(2, Math.round(95 / (SR / NFFT)));   // 킥 대역 (스네어 기본음 180Hz~ 은 빼고)
  for (let f = 0; f < nFrames; f++) {
    const start = f * HOP - half;
    for (let i = 0; i < NFFT; i++) {
      const idx = start + i;
      re[i] = idx >= 0 && idx < x.length ? x[idx] * g * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0, lf = 0, mf = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = m - prev[k];
      if (d > 0) { flux += d; if (k <= lowBins) lf += d; else if (k >= midA && k <= midB) mf += d; }
      prev[k] = m;
    }
    env[f] = f === 0 ? 0 : flux;
    low[f] = f === 0 ? 0 : lf;
    mid[f] = f === 0 ? 0 : mf;
  }
  return { env, low, mid };
}

/** 첫 소리(t0, 이 트랙의 시간축)부터 몇 박 뒤가 마디 첫 박(강박)인지 — 킥·크래시가 몰리는 박을 고른다 */
export function downbeatShift(tr: Track, t0: number, bpm: number, bpb: number): number {
  const beat = 60 / bpm;
  const at = (e: Float32Array, t: number) => {
    const f = Math.round(t / HOP_SEC);
    return Math.max(e[f - 1] || 0, e[f] || 0, e[f + 1] || 0);
  };
  let maxL = 0, maxE = 0;
  for (let i = 0; i < tr.low.length; i++) { if (tr.low[i] > maxL) maxL = tr.low[i]; if (tr.env[i] > maxE) maxE = tr.env[i]; }
  // 드럼 그루브는 싱코페이션이 많아 소리만으로는 강박이 흔들린다 →
  // 기본은 "첫 소리 = 강박", 다른 박의 킥이 1.5배 이상 확실히 셀 때만 옮긴다
  const scores: number[] = [];
  for (let j = 0; j < bpb; j++) {
    let s = 0, c = 0;
    for (let t = t0 + j * beat; t < tr.duration; t += bpb * beat) { s += at(tr.low, t) / (maxL || 1) + 0.25 * at(tr.env, t) / (maxE || 1); c++; }
    scores.push(c ? s / c : 0);
  }
  let best = 0;
  for (let j = 1; j < bpb; j++) if (scores[j] > scores[best]) best = j;
  if (best !== 0 && scores[best] < scores[0] * 1.5) best = 0;
  return best;
}

export function computePeaks(x: Float32Array): Float32Array {
  const bucket = SR / PEAKS_RATE;
  const n = Math.ceil(x.length / bucket), out = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const s = Math.floor(b * bucket), e = Math.min(x.length, Math.floor((b + 1) * bucket));
    let m = 0;
    for (let i = s; i < e; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
    out[b] = m;
  }
  let mx = 0;
  for (let i = 0; i < n; i++) if (out[i] > mx) mx = out[i];
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}

export function pickOnsets(env: Float32Array): Onset[] {
  const n = env.length, w = 10;
  let mx = 0;
  for (let i = 0; i < n; i++) if (env[i] > mx) mx = env[i];
  const out: Onset[] = [];
  let last = -1e9;
  for (let i = 3; i < n - 3; i++) {
    const v = env[i];
    if (v < env[i - 1] || v < env[i + 1] || v < env[i - 2] || v < env[i + 2] || v < env[i - 3] || v < env[i + 3]) continue;
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { sum += env[j]; c++; }
    if (v < (sum / c) * 1.3 + 0.06 * mx) continue;
    const t = i * HOP_SEC;
    if (t - last < 0.05) continue;
    out.push({ t, s: v / mx });
    last = t;
  }
  return out;
}

function interp(env: Float32Array, f: number) {
  const i = Math.floor(f);
  if (i < 0 || i >= env.length - 1) return 0;
  const a = f - i;
  return env[i] * (1 - a) + env[i + 1] * a;
}

export interface TempoResult { bpm: number; suggested: number; beatPhase: number; confidence: number }

/** BPM 추정
 *  1) 자기상관으로 대략값 → 16분 격자 맞춤으로 0.01 단위까지 정밀화
 *  2) 4:3 · 3:2 착각 바로잡기: 타격들이 16분 격자에 더 잘 들어맞는 템포로 (예: 77을 105로 잘못 잡는 경우)
 *  3) 악보가 있으면 "악보 마디 수 × 한 마디 길이 ≈ 연주 길이"로 한 번 더 확인 */
export interface TempoOpts { onsets?: Onset[]; low?: Float32Array; mid?: Float32Array; sheetBars?: number; bpb?: number; debug?: (...a: any[]) => void }

/** 백비트 점수: 이 템포의 박을 번갈아 볼 때 "킥은 1·3박, 스네어는 2·4박"에 몰리는 정도
 *  드럼 그루브 대부분이 이 모양이라, 2배·절반(·3:4) 템포 중 진짜 박을 가리는 데 씀. low·mid는 localPeaks 거친 값
 *  a = 킥·스네어 둘 다 맞는 정도(작은 쪽), b = 스네어 + 킥 절반 (베이스가 킥 대역을 덮는 곡에서도 버티는 값) */
export function backbeatScore(low: Float32Array, mid: Float32Array, bpm: number): { a: number; b: number } {
  const beat = 60 / bpm, n = Math.min(low.length, mid.length), dur = n * HOP_SEC - 0.1;
  // ±35ms 안의 가장 센 값: 사람 연주의 흔들림·템포 소수점 오차가 곡 끝까지 쌓여도 박을 놓치지 않게
  const at = (e: Float32Array, t: number) => { const f = Math.round(t / HOP_SEC); if (f + 3 >= e.length) return 0; let m = 0; for (let i = Math.max(0, f - 3); i <= f + 3; i++) if (e[i] > m) m = e[i]; return m; };
  // 기준: 센 타격(상위 5%) 크기 — 비율이 아니라 "센 타격 대비 얼마나 차이 나는지"로 봐야 조용한 자리끼리 비교해서 생기는 착각이 없음
  const ref = (e: Float32Array) => { const a: number[] = []; for (let i = 0; i < n; i++) if (e[i] > 0) a.push(e[i]); a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.95)] : 1; };
  const rK = ref(low) || 1, rS = ref(mid) || 1;
  let A = -9, B = -9;
  for (let j = 0; j < 32; j++) {                // 박 위치 후보: 64분 단위로 2박 범위를 밀어보기
    const ph = j * beat / 16;
    const K = [0, 0], S = [0, 0], C = [0, 0];
    let k = 0;
    for (let t = ph; t < dur; t += beat, k++) { const q = k & 1; K[q] += at(low, t); S[q] += at(mid, t); C[q]++; }
    if (C[0] < 8 || C[1] < 8) continue;
    for (const a of [0, 1]) {
      const cK = (K[a] / C[a] - K[1 - a] / C[1 - a]) / rK, cS = (S[1 - a] / C[1 - a] - S[a] / C[a]) / rS;
      A = Math.max(A, Math.min(cK, cS)); B = Math.max(B, cS + 0.5 * cK);
    }
  }
  return { a: A, b: B };
}
/** 타격 세기에서 주변 0.5초 평균을 뺀 값 (계속 울리는 소리·잡음을 빼고 "때린 순간"만 남김) */
export function localPeaks(e: Float32Array): Float32Array {
  const n = e.length, w = Math.round(0.5 / HOP_SEC), h = w >> 1, out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < Math.min(n, h); i++) s += e[i];
  for (let i = 0; i < n; i++) {
    if (i + h < n) s += e[i + h];
    if (i - h - 1 >= 0) s -= e[i - h - 1];
    out[i] = Math.max(0, e[i] - s / w);
  }
  return out;
}
export function estimateTempo(env: Float32Array, opt: TempoOpts = {}): TempoResult {
  const n = env.length, dur = n * HOP_SEC;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = env[i] - mean;
  const lagMin = Math.floor(60 / (200 * HOP_SEC)), lagMax = Math.ceil(60 / (55 * HOP_SEC));
  const ac = new Float32Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += e[i] * e[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = -Infinity, bl = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 / (lag * HOP_SEC);
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    if (ac[lag] * w > best) { best = ac[lag] * w; bl = lag; }
  }
  const d = ac[bl - 1] - 2 * ac[bl] + ac[bl + 1];
  const lagF = bl + (d !== 0 ? 0.5 * (ac[bl - 1] - ac[bl + 1]) / d : 0);
  const bpm0 = 60 / (lagF * HOP_SEC);

  /** b 근처(±range)에서 16분 격자에 가장 잘 맞는 템포·위상 */
  const fit = (center: number, range: number, step: number) => {
    let bestS = -Infinity, bpm = center, phase = 0;
    for (let b = center - range; b <= center + range; b += step) {
      const six = 60 / b / 4;
      for (let ph = 0; ph < six; ph += HOP_SEC / 2) {
        let s = 0, c = 0;
        for (let t = ph; t < dur; t += six) { s += interp(env, t / HOP_SEC); c++; }
        if (s / c > bestS) { bestS = s / c; bpm = b; phase = ph; }
      }
    }
    return { bpm, phase, s: bestS };
  };
  let cur = fit(bpm0, 3, 0.01);
  const dbg = opt.debug || (() => {});
  dbg('acf', bpm0.toFixed(2), 'fit', cur.bpm.toFixed(2));

  const ons = (opt.onsets || []).filter(o => o.s > 0.08);
  if (ons.length >= 12) {
    // 2) 타격이 16분 격자(±30ms)에 들어맞는 비율 (세기 가중)
    const recall = (b: number) => Math.max(recallDiv(b, 4), recallDiv(b, 3));   // 16분 또는 셋잇단 격자
    const recallDiv = (b: number, div: number) => {
      const slot = 60 / b / div, tol = Math.min(0.03, slot * 0.22);
      let tot = 0; for (const o of ons) tot += o.s;
      let bestR = 0;
      for (let ph = 0; ph < slot; ph += 0.004) {
        let a = 0;
        for (const o of ons) { const f = (((o.t - ph) / slot) % 1 + 1) % 1; if (Math.min(f, 1 - f) * slot < tol) a += o.s; }
        if (a / tot > bestR) bestR = a / tot;
      }
      return bestR;
    };
    const r0 = recall(cur.bpm);
    let alt = cur, rAlt = r0;
    for (const k of [3 / 4, 4 / 3, 2 / 3, 3 / 2]) {
      const c = cur.bpm * k;
      if (c < 50 || c > 210) continue;
      const f = fit(c, c * 0.012, 0.02), r = recall(f.bpm);
      if (r > rAlt + 0.12 && r > 0.7) { alt = f; rAlt = r; }
    }
    if (alt !== cur) cur = fit(alt.bpm, 0.3, 0.01);
    dbg('after 3:4 check', cur.bpm.toFixed(2));

    // 2-1) 2배·절반 가리기: 킥(1·3박)·스네어(2·4박) 백비트가 뚜렷한 쪽이 진짜 박
    if (opt.low && opt.mid) {
      const L = localPeaks(opt.low), M = localPeaks(opt.mid);
      const sc = (b: number) => backbeatScore(L, M, b);
      const s0 = sc(cur.bpm);
      let pickB = cur.bpm, octB = 0, octA = -9, othB = 0, othA = -9;
      for (const k of [0.5, 2, 3 / 4, 4 / 3, 2 / 3, 3 / 2]) {
        const c0 = cur.bpm * k;
        if (c0 < 55 || c0 > 200) continue;
        const octave = k === 0.5 || k === 2;
        const c = octave ? c0 : fit(c0, c0 * 0.01, 0.02).bpm;
        const v = sc(c);
        dbg('backbeat', k.toFixed(2), c.toFixed(2), v.a.toFixed(3), v.b.toFixed(3));
        // 바꾸는 조건: 킥·스네어 모양이 확실히 더 뚜렷하고(a) 스네어 쪽(b)도 더 나을 때만. 3:4·2:3 착각은 더 엄격하게
        const clearA = v.a > (octave ? 0.08 : 0.22) && v.a > s0.a + (octave ? 0.06 : 0.12) && v.a > Math.max(0, s0.a) * 2 && v.b > s0.b * 1.1;
        // 베이스가 킥을 덮는 곡: 킥 모양(a)은 비슷해도 스네어 2·4박(b)이 훨씬 뚜렷하면 (2배·절반만)
        const clearB = octave && v.a >= Math.max(s0.a, 0.05) && v.b > s0.b * 1.5 && v.b > 0.3;
        if (!(clearA || clearB)) continue;
        if (octave) { if (v.a > octA) { octB = c; octA = v.a; } }
        else if (v.a > othA) { othB = c; othA = v.a; }
      }
      // 2배·절반을 먼저: 4/4 그루브는 1/3 템포로 봐도 킥·스네어가 번갈아 나와서 3:2 쪽이 헷갈리기 쉬움 → 3:4·2:3은 훨씬 뚜렷할 때만
      if (othB && (!octB || othA > octA * 1.2)) pickB = othB;
      else if (octB) pickB = octB;
      dbg('backbeat cur', cur.bpm.toFixed(2), s0.a.toFixed(3), s0.b.toFixed(3));
      if (pickB !== cur.bpm) cur = fit(pickB, 0.3, 0.01);
    }

    // 3) 악보 마디 수로 확인 (2배·절반 착각은 소리만으로는 구분이 어려워서 악보 길이로) (카운트인 한 마디 정도는 허용)
    if (opt.sheetBars && opt.sheetBars > 1) {
      const st = ons.filter(o => o.s > 0.25);
      const span = st.length > 1 ? st[st.length - 1].t - st[0].t : 0;
      const bpb = opt.bpb || 4;
      const err = (b: number) => { const bars = span / (bpb * 60 / b); return Math.min(Math.abs(bars - opt.sheetBars!), Math.abs(bars - opt.sheetBars! - 1)) / opt.sheetBars!; };
      if (span > 4 && err(cur.bpm) > 0.2) {
        let pick = cur;
        for (const k of [0.5, 2, 3 / 4, 4 / 3, 2 / 3, 3 / 2]) {
          const c = cur.bpm * k;
          if (c < 45 || c > 220 || err(c) > 0.12 || err(c) >= err(pick.bpm)) continue;
          const f = fit(c, c * 0.01, 0.02);
          if (recall(f.bpm) > 0.6) pick = f;
        }
        if (pick !== cur) cur = fit(pick.bpm, 0.3, 0.01);
      }
    }
  }

  // 16분 격자 중 어느 위치가 "박"인지: 박 위치의 타격음이 가장 센 쪽
  const bpm = cur.bpm, beat = 60 / bpm, six = beat / 4;
  let bestB = -Infinity, beatPhase = cur.phase;
  for (let k = 0; k < 4; k++) {
    const ph = cur.phase + k * six;
    let s = 0, c = 0;
    for (let t = ph; t < dur; t += beat) {
      const f = Math.round(t / HOP_SEC);
      s += Math.max(env[f - 1] || 0, env[f] || 0, env[f + 1] || 0); c++;
    }
    if (s / c > bestB) { bestB = s / c; beatPhase = ph; }
  }
  const r = Math.round(bpm);
  const suggested = Math.abs(bpm - r) <= 0.08 ? r : Math.round(bpm * 10) / 10;
  return { bpm, suggested, beatPhase, confidence: cur.s / (mean || 1) };
}

export interface SyncResult { offset: number; confidence: number }

/** 녹음본 자동 싱크: 녹음본 시간 = 영상 시간 + offset */
export function syncOffset(a: Track, b: Track, maxLagSec = 30): SyncResult {
  const norm = (x: Float32Array) => {
    let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length;
    let v = 0; for (let i = 0; i < x.length; i++) v += (x[i] - m) ** 2;
    const sd = Math.sqrt(v / x.length) || 1;
    const o = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) o[i] = (x[i] - m) / sd;
    return o;
  };
  const A = norm(a.env), B = norm(b.env);
  const maxLag = Math.round(maxLagSec / HOP_SEC);
  const lo = Math.max(-(A.length - 1), -maxLag), hi = Math.min(B.length - 1, maxLag);
  const corr = new Float32Array(hi - lo + 1);
  for (let L = lo; L <= hi; L++) {
    let s = 0;
    const i0 = Math.max(0, -L), i1 = Math.min(A.length, B.length - L);
    for (let i = i0; i < i1; i++) s += A[i] * B[i + L];
    corr[L - lo] = s;
  }
  let bi = 0;
  for (let i = 1; i < corr.length; i++) if (corr[i] > corr[bi]) bi = i;
  let second = 0;
  for (let i = 0; i < corr.length; i++) if (Math.abs(i - bi) > 15 && corr[i] > second) second = corr[i];
  const confidence = second > 0 ? corr[bi] / second : 10;
  const c0 = corr[bi - 1] ?? corr[bi], c2 = corr[bi + 1] ?? corr[bi];
  const dd = c0 - 2 * corr[bi] + c2;
  const Lf = bi + lo + (dd !== 0 ? 0.5 * (c0 - c2) / dd : 0);
  let offS = Math.round(Lf * HOP);

  // 샘플 단위 정밀화: 소리가 가장 큰 4초 구간에서 원본 파형끼리 비교
  const xa = a.mono, xb = b.mono, win = 4 * SR, step = Math.floor(SR / 2);
  let bestStart = -1, bestE = 0;
  for (let s = 0; s + win < xa.length; s += step) {
    if (s + offS - HOP < 0 || s + win + offS + HOP >= xb.length) continue;
    let en = 0;
    for (let i = s; i < s + win; i += 8) en += xa[i] * xa[i];
    if (en > bestE) { bestE = en; bestStart = s; }
  }
  if (bestStart >= 0) {
    let bv = 0, bd = 0, sumAbs = 0, cnt = 0;
    for (let dl = -HOP; dl <= HOP; dl++) {
      let s = 0;
      const o = offS + dl;
      for (let i = bestStart; i < bestStart + win; i++) s += xa[i] * xb[i + o];
      const av = Math.abs(s);
      sumAbs += av; cnt++;
      if (av > bv) { bv = av; bd = dl; }
    }
    if (bv > 2.5 * (sumAbs / cnt)) offS += bd;
  }
  return { offset: offS / SR, confidence };
}

/** 가장 가까운 타격음 시각 (없으면 null) */
export function nearestOnset(onsets: Onset[], t: number, maxDist = 0.15): number | null {
  let best: number | null = null, bd = maxDist;
  for (const o of onsets) {
    const d = Math.abs(o.t - t);
    if (d <= bd) { bd = d; best = o.t; }
  }
  return best;
}

/** 첫 번째 확실한 타격음 시각 (원본 파형으로 다듬은 값) */
export function firstStrongBeat(onsets: Onset[], beat = 0): number | null {
  const strong = onsets.filter(o => o.s > 0.3);
  if (!strong.length) return null;
  if (beat > 0) {
    // 스틱 카운트(딱 딱 딱 딱)처럼 한 박 간격으로 혼자 울리는 소리가 2~8번 이어지면 건너뛰고 그다음을 첫 박으로
    let k = 1;
    while (k < strong.length && k <= 8) {
      const gap = strong[k].t - strong[k - 1].t;
      if (Math.abs(gap - beat) > beat * 0.12) break;
      // 사이에 다른 소리가 끼어 있으면 카운트가 아니라 연주
      const between = onsets.some(o => o.t > strong[k - 1].t + beat * 0.15 && o.t < strong[k].t - beat * 0.15 && o.s > 0.12);
      if (between) break;
      k++;
    }
    // k개가 카운트 모양이고, 바로 다음(연주 시작)이 한 박 뒤에 오면 카운트로 봄
    if (k >= 2 && k <= 8 && k < strong.length) {
      const next = strong[k], gap = next.t - strong[k - 1].t;
      const dense = onsets.filter(o => o.t >= next.t && o.t < next.t + beat * 2 && o.s > 0.12).length;
      if (Math.abs(gap - beat) <= beat * 0.15 && dense >= 3) return next.t;
    }
  }
  return strong[0].t;
}

/**
 * 마디 눈금의 미세 위치 보정: 곡 전체의 또렷한 타격이 16분음표 격자에 가장 잘 맞도록
 * (첫 타격 하나만 보면 꾸밈음·플램 때문에 조금씩 어긋날 수 있어서)
 * anchor·onsets는 같은 시간축(영상 시간). 보정 폭은 16분음표 반 칸 이내.
 */
export function refinePhase(onsets: { t: number; s: number }[], anchor: number, beat: number): number {
  const strong = onsets.filter(o => o.s > 0.2);
  if (strong.length < 12) return anchor;
  const u = beat / 4;
  let sx = 0, sy = 0;
  for (const o of strong) {
    const ph = ((o.t - anchor) / u) * Math.PI * 2;
    sx += o.s * Math.cos(ph); sy += o.s * Math.sin(ph);
  }
  const conf = Math.hypot(sx, sy) / strong.reduce((a, o) => a + o.s, 0);
  if (conf < 0.25) return anchor;          // 격자에 잘 안 맞는 연주면 손대지 않음
  return anchor + Math.atan2(sy, sx) / (Math.PI * 2) * u;
}

/** 킥 박(1·3박) 격자: 곡 전체에서 "킥은 이 박들, 스네어는 그 사이 박들"에 가장 잘 맞는 위치 (2박 간격)
 *  conf가 낮으면(백비트가 뚜렷하지 않은 연주) 쓰지 않음 */
export function kickGrid(tr: Track, bpm: number): { phase: number; conf: number } {
  const beat = 60 / bpm, L = localPeaks(tr.low), M = localPeaks(tr.mid), n = Math.min(L.length, M.length);
  const at = (e: Float32Array, t: number) => { const f = Math.round(t / HOP_SEC); if (f + 3 >= n) return 0; let m = 0; for (let i = Math.max(0, f - 3); i <= f + 3; i++) if (e[i] > m) m = e[i]; return m; };
  const ref = (e: Float32Array) => { const a: number[] = []; for (let i = 0; i < n; i++) if (e[i] > 0) a.push(e[i]); a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.95)] || 1 : 1; };
  const rK = ref(L), rS = ref(M), dur = n * HOP_SEC - 0.1;
  let best = { phase: 0, conf: -9 };
  for (let j = 0; j < 64; j++) {
    const ph = j * beat / 32;
    const K = [0, 0], S = [0, 0], C = [0, 0];
    let k = 0;
    for (let t = ph; t < dur; t += beat, k++) { const q = k & 1; K[q] += at(L, t); S[q] += at(M, t); C[q]++; }
    if (C[0] < 8 || C[1] < 8) continue;
    const dk = (K[0] / C[0] - K[1] / C[1]) / rK, ds = (S[1] / C[1] - S[0] / C[0]) / rS;
    const sc = Math.min(dk, ds) + 0.25 * (dk + ds);
    if (ds > 0 && sc > best.conf) best = { phase: ph, conf: sc };
  }
  // 2·4박 스네어인지 확인: 4박 단위로 봤을 때 스네어 박 두 자리가 둘 다 킥 박 두 자리보다 뚜렷해야 함
  // (하프타임 그루브처럼 3박에만 스네어가 있으면 짝이 틀어지므로 쓰지 않음)
  const S4 = [0, 0, 0, 0], C4 = [0, 0, 0, 0];
  let k = 0;
  for (let t = best.phase; t < dur; t += beat, k++) { S4[k & 3] += at(M, t); C4[k & 3]++; }
  const s4 = S4.map((v, i) => v / (C4[i] || 1));
  const ok = Math.min(s4[1], s4[3]) > Math.max(s4[0], s4[2]) * 1.15;
  return ok ? best : { phase: best.phase, conf: -1 };
}
