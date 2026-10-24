var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/fft.ts
function makeFFT(n) {
  const levels = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b2 = 0; b2 < levels; b2++) r |= (i >> b2 & 1) << levels - 1 - b2;
    rev[i] = r;
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = Math.sin(2 * Math.PI * i / n);
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, l = a + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[a] - tre;
          im[l] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  };
}

// src/analysis.ts
var SR = 22050;
var HOP = 256;
var NFFT = 1024;
var HOP_SEC = HOP / SR;
var PEAKS_RATE = 200;
function analyzeTrack(mono) {
  const env = onsetEnvelope(mono);
  const rough = pickOnsets(env);
  const onsets = rough.map((o) => ({ t: refineAttack(mono, o.t), s: o.s }));
  const d = onsets.map((o, i) => o.t - rough[i].t).sort((a, b2) => a - b2);
  const bias = d.length ? d[Math.floor(d.length / 2)] : 0;
  return { mono, env, peaks: computePeaks(mono), onsets, duration: mono.length / SR, bias };
}
function refineAttack(x2, t) {
  const fr = 22;
  const a = Math.floor((t - 0.035) * SR), n = Math.floor(0.07 * SR / fr);
  if (a < 0 || a + n * fr >= x2.length) return t;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < fr; k++) {
      const v = x2[a + i * fr + k];
      s += v * v;
    }
    e[i] = Math.sqrt(s / fr);
  }
  let best = -1, bi = -1;
  for (let i = 3; i < n; i++) {
    const d = e[i] - e[i - 3];
    if (d > best) {
      best = d;
      bi = i;
    }
  }
  if (bi < 0) return t;
  const base = e[bi - 3], thr = base + best * 0.2;
  let j = bi - 3;
  while (j < bi && e[j] < thr) j++;
  return (a + j * fr) / SR;
}
function onsetEnvelope(x2) {
  let peak = 0;
  for (let i = 0; i < x2.length; i++) {
    const a = Math.abs(x2[i]);
    if (a > peak) peak = a;
  }
  const g = peak > 0 ? 1 / peak : 1;
  const half = NFFT / 2, nFrames = Math.floor(x2.length / HOP) + 1;
  const win = new Float32Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT);
  const fft = makeFFT(NFFT);
  const re = new Float32Array(NFFT), im = new Float32Array(NFFT), prev = new Float32Array(half);
  const env = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const start = f * HOP - half;
    for (let i = 0; i < NFFT; i++) {
      const idx = start + i;
      re[i] = idx >= 0 && idx < x2.length ? x2[idx] * g * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = m - prev[k];
      if (d > 0) flux += d;
      prev[k] = m;
    }
    env[f] = f === 0 ? 0 : flux;
  }
  return env;
}
function computePeaks(x2) {
  const bucket = SR / PEAKS_RATE;
  const n = Math.ceil(x2.length / bucket), out = new Float32Array(n);
  for (let b2 = 0; b2 < n; b2++) {
    const s = Math.floor(b2 * bucket), e = Math.min(x2.length, Math.floor((b2 + 1) * bucket));
    let m = 0;
    for (let i = s; i < e; i++) {
      const a = Math.abs(x2[i]);
      if (a > m) m = a;
    }
    out[b2] = m;
  }
  let mx = 0;
  for (let i = 0; i < n; i++) if (out[i] > mx) mx = out[i];
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}
function pickOnsets(env) {
  const n = env.length, w = 10;
  let mx = 0;
  for (let i = 0; i < n; i++) if (env[i] > mx) mx = env[i];
  const out = [];
  let last = -1e9;
  for (let i = 3; i < n - 3; i++) {
    const v = env[i];
    if (v < env[i - 1] || v < env[i + 1] || v < env[i - 2] || v < env[i + 2] || v < env[i - 3] || v < env[i + 3]) continue;
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
      sum += env[j];
      c++;
    }
    if (v < sum / c * 1.3 + 0.06 * mx) continue;
    const t = i * HOP_SEC;
    if (t - last < 0.05) continue;
    out.push({ t, s: v / mx });
    last = t;
  }
  return out;
}
function interp(env, f) {
  const i = Math.floor(f);
  if (i < 0 || i >= env.length - 1) return 0;
  const a = f - i;
  return env[i] * (1 - a) + env[i + 1] * a;
}
function estimateTempo(env) {
  const n = env.length, dur = n * HOP_SEC;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
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
    const bpm2 = 60 / (lag * HOP_SEC);
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm2 / 110) / 0.9, 2));
    if (ac[lag] * w > best) {
      best = ac[lag] * w;
      bl = lag;
    }
  }
  const d = ac[bl - 1] - 2 * ac[bl] + ac[bl + 1];
  const lagF = bl + (d !== 0 ? 0.5 * (ac[bl - 1] - ac[bl + 1]) / d : 0);
  const bpm0 = 60 / (lagF * HOP_SEC);
  let bestS = -Infinity, bpm = bpm0, phase = 0;
  for (let b2 = bpm0 - 3; b2 <= bpm0 + 3; b2 += 0.01) {
    const six2 = 60 / b2 / 4;
    for (let ph = 0; ph < six2; ph += HOP_SEC / 2) {
      let s = 0, c = 0;
      for (let t = ph; t < dur; t += six2) {
        s += interp(env, t / HOP_SEC);
        c++;
      }
      if (s / c > bestS) {
        bestS = s / c;
        bpm = b2;
        phase = ph;
      }
    }
  }
  const beat = 60 / bpm, six = beat / 4;
  let bestB = -Infinity, beatPhase = phase;
  for (let k = 0; k < 4; k++) {
    const ph = phase + k * six;
    let s = 0, c = 0;
    for (let t = ph; t < dur; t += beat) {
      const f = Math.round(t / HOP_SEC);
      s += Math.max(env[f - 1] || 0, env[f] || 0, env[f + 1] || 0);
      c++;
    }
    if (s / c > bestB) {
      bestB = s / c;
      beatPhase = ph;
    }
  }
  const r = Math.round(bpm);
  const suggested = Math.abs(bpm - r) <= 0.08 ? r : Math.round(bpm * 10) / 10;
  return { bpm, suggested, beatPhase, confidence: bestS / (mean || 1) };
}
function firstStrongBeat(onsets, bpm, beatPhase) {
  const strong = onsets.find((o) => o.s > 0.3);
  if (!strong) return null;
  const beat = 60 / bpm;
  const k = Math.round((strong.t - beatPhase) / beat);
  const snapped = beatPhase + k * beat;
  return Math.abs(snapped - strong.t) < beat / 4 ? snapped : strong.t;
}

// test/ons.ts
var import_fs = __toESM(require("fs"));
var b = import_fs.default.readFileSync("test/rec.f32");
var x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
var tr = analyzeTrack(new Float32Array(x));
console.log(tr.onsets.filter((o) => o.t < 8).map((o) => o.t.toFixed(3) + "(" + o.s.toFixed(2) + ")").join(" "));
var te = estimateTempo(tr.env);
console.log(te);
console.log("first", firstStrongBeat(tr.onsets, te.bpm, te.beatPhase));
