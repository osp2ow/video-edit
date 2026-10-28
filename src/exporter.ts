// MP4 추출: 미리보기와 같은 렌더러로 프레임을 그려 WebCodecs로 인코딩한다.
// 영상 프레임은 실제 재생하면서 받아온다(영상 길이만큼 걸림) — HEVC 영상을 프레임마다 탐색하면 훨씬 느리기 때문.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { CardLayout, Project, Ratio } from './model';
import { SheetData } from './sheet';
import { Angle, activeSource } from './angles';
import { renderComposite } from './effects';
import { openFrameSource, FrameSource } from './decoder';
import { MAIN } from './model';
import { preloadCaptionFonts } from './render';
import { getFx, trimOf, clipsOf, clipEnd, Clip, recAtOf, recKeyOf, MAIN_REC, fadeOf, scheduleFade } from './model';

// TS 기본 타입에 아직 없는 WebCodecs 오디오 API
declare const AudioEncoder: any;
declare const AudioData: any;

export interface ExportOptions {
  ratio: Ratio;
  quality: 1080 | 720;
  fps: 30 | 60;
  start: number;
  end: number;
}

export interface ExportInput {
  master: HTMLVideoElement;
  angles: Angle[];
  project: Project;
  sheet: SheetData | null;
  layout: CardLayout;
  masterAudio: AudioBuffer | null; // 영상 소리 (48kHz로 디코딩)
  recAudio: AudioBuffer | null;    // 녹음본
  sources?: Map<string, HTMLVideoElement>;          // 추가로 올린 영상들
  sheets?: Map<string, SheetData>;                  // 두 번째부터 넣은 악보들
  extraRecs?: Map<string, AudioBuffer>;             // 두 번째부터 넣은 녹음본들
  sourceAudio?: Map<string, AudioBuffer | null>;    // 그 영상들의 소리
}

export interface CodecPlan { video: string; muxVideo: 'avc' | 'vp9'; audio: string; muxAudio: 'aac' | 'opus'; standard: boolean }

export const outSize = (o: Pick<ExportOptions, 'ratio' | 'quality'>): [number, number] => {
  const long = o.quality === 1080 ? 1920 : 1280, short = o.quality === 1080 ? 1080 : 720;
  if (o.ratio === '4:5') return [short, Math.round(short * 1.25)];   // 1080×1350 · 720×900
  return o.ratio === '9:16' ? [short, long] : [long, short];
};

export function exportSupported() {
  return typeof (window as any).VideoEncoder === 'function' && typeof (window as any).AudioEncoder === 'function'
    && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

/** 인스타·유튜브 표준(H.264 + AAC)을 먼저 시도하고, 안 되면 VP9 + Opus */
export async function pickCodecs(o: ExportOptions): Promise<CodecPlan | null> {
  const [W, H] = outSize(o);
  const bitrate = videoBitrate(o);
  const avc = o.fps === 60 ? ['avc1.64002A', 'avc1.4d002A', 'avc1.42002A'] : ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
  let video = '', muxVideo: 'avc' | 'vp9' = 'avc';
  for (const c of avc) {
    try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: o.fps, avc: { format: 'avc' } } as any)).supported) { video = c; break; } } catch { /* 다음 후보 */ }
  }
  if (!video) {
    try { if ((await VideoEncoder.isConfigSupported({ codec: 'vp09.00.40.08', width: W, height: H, bitrate, framerate: o.fps })).supported) { video = 'vp09.00.40.08'; muxVideo = 'vp9'; } } catch { /* 없음 */ }
  }
  if (!video) return null;
  let audio = '', muxAudio: 'aac' | 'opus' = 'aac';
  try { if ((await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) audio = 'mp4a.40.2'; } catch { /* 다음 */ }
  if (!audio) {
    try { if ((await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) { audio = 'opus'; muxAudio = 'opus'; } } catch { /* 없음 */ }
  }
  if (!audio) return null;
  return { video, muxVideo, audio, muxAudio, standard: muxVideo === 'avc' && muxAudio === 'aac' };
}

const videoBitrate = (o: Pick<ExportOptions, 'quality' | 'fps'>) =>
  (o.quality === 1080 ? 12_000_000 : 6_000_000) * (o.fps === 60 ? 1.4 : 1);

/** 추출용 소리: 현재 켜짐/꺼짐·볼륨 그대로, 메트로놈은 넣지 않는다 */
/** 타임라인 [a,b]를 조각 경계로 나눈 토막들 (clip이 없으면 빈자리) */
export function piecesOf(p: Parameters<typeof clipsOf>[0], dur: number, a: number, b: number): { a: number; b: number; clip: Clip | null }[] {
  const cs = clipsOf(p, dur);
  const cuts = new Set<number>([a, b]);
  for (const c of cs) { if (c.start > a && c.start < b) cuts.add(c.start); const e = clipEnd(c); if (e > a && e < b) cuts.add(e); }
  const xs = [...cuts].sort((x, y) => x - y), out: { a: number; b: number; clip: Clip | null }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x = xs[i], y = xs[i + 1]; if (y - x < 1e-3) continue;
    const m = (x + y) / 2; let hit: Clip | null = null;
    for (const c of cs) if (m >= c.start && m < clipEnd(c)) hit = c;
    out.push({ a: x, b: y, clip: hit });
  }
  return out;
}

/** 기준 영상·앵글 파일을 직접 풀 준비 (하나라도 안 되면 예전 방식으로) */
async function openDecoded(master: HTMLVideoElement, angles: Angle[], sources: Map<string, HTMLVideoElement>, used: Set<string>):
  Promise<{ main: FrameSource | null; angles: Map<string, FrameSource>; sources: Map<string, FrameSource> } | null> {
  const am = new Map<string, FrameSource>(), sm = new Map<string, FrameSource>();
  let main: FrameSource | null = null;
  const closeAll = () => { main?.close(); for (const d of am.values()) d.close(); for (const d of sm.values()) d.close(); };
  try {
    const blobOf = async (v: HTMLVideoElement) => (await fetch(v.currentSrc || v.src)).blob();
    if (used.has(MAIN) && (master.currentSrc || master.src)) {
      main = await openFrameSource(await blobOf(master));
      if (!main) return null;
      for (const a of angles) {
        if (!a.ready) continue;
        const src = await openFrameSource(await blobOf(a.video));
        if (!src) { closeAll(); return null; }
        am.set(a.id, src);
      }
    }
    for (const [id, el] of sources) {
      if (!used.has(id)) continue;
      const src = await openFrameSource(await blobOf(el));
      if (!src) { closeAll(); return null; }
      sm.set(id, src);
    }
    return { main, angles: am, sources: sm };
  } catch (e) {
    console.warn('[추출] 파일에서 직접 풀기 실패 → 재생하며 받기', e);
    closeAll();
    return null;
  }
}

/** 추출 중에는 미리보기 화면 그리기를 멈춰서(같은 그림을 두 번 그리지 않게) 추출에 힘을 몰아줌 */
let exportingNow = false;
export const isExporting = () => exportingNow;
function setExporting(v: boolean) { exportingNow = v; }

export async function mixAudio(inp: ExportInput, start: number, end: number): Promise<AudioBuffer> {
  const sr = 48000, len = Math.max(1, Math.ceil((end - start) * sr));
  const ctx = new OfflineAudioContext(2, len, sr);
  const p = inp.project;
  // 소리 페이드 (효과의 페이드 인/아웃에 맞춤)
  const fx = getFx(p), dur = end - start;
  const master = ctx.createGain(); master.connect(ctx.destination);
  if (fx.audioFade && fx.fadeIn > 0) { master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(1, Math.min(dur, fx.fadeIn)); }
  if (fx.audioFade && fx.fadeOut > 0) { const a = Math.max(0, dur - fx.fadeOut); master.gain.setValueAtTime(1, a); master.gain.linearRampToValueAtTime(0, dur); }
  // 영상 조각마다 그 영상의 소리 (빈자리는 조용히) + 녹음본은 타임라인에 놓인 그대로 처음부터 끝까지
  const srcDur = inp.master.duration || 0;
  const placeAt = (buf: AudioBuffer, outAt: number, srcFrom: number, len: number, vol: number, tin = 0, tout = buf.duration, fade?: { key: string; at: number }) => {
    const from = Math.max(srcFrom, tin, 0), to = Math.min(srcFrom + len, tout, buf.duration);
    if (to - from <= 0.001) return;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol;
    // 조각 이음매 5ms 페이드
    const at = outAt + (from - srcFrom), d = to - from;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + Math.min(0.005, d / 2));
    g.gain.setValueAtTime(vol, at + Math.max(0, d - 0.005)); g.gain.linearRampToValueAtTime(0, at + d);
    if (fade) {
      // 녹음본 조각 페이드 (타임라인 시간 → 추출 시간 = 타임라인 − start)
      const fg = ctx.createGain(), TS = fade.at + tin, TE = fade.at + tout;
      scheduleFade(fg.gain, t => t - start, TS, TE, fadeOf(p, fade.key, TE - TS), Math.max(start, TS));
      s.connect(g); g.connect(fg); fg.connect(master);
    } else { s.connect(g); g.connect(master); }
    s.start(at, from, d);
  };
  for (const pc of piecesOf(p, srcDur, start, end)) {
    if (!pc.clip) continue;
    const s0 = pc.clip.srcIn + (pc.a - pc.clip.start), len = pc.b - pc.a, outAt = pc.a - start;
    const vbuf = pc.clip.src ? inp.sourceAudio?.get(pc.clip.src) ?? null : inp.masterAudio;
    if (vbuf && !p.videoMuted && p.videoVol > 0) placeAt(vbuf, outAt, s0, len, p.videoVol);
  }
  if (inp.recAudio && !p.recMuted && p.recVol > 0) {
    const tr = trimOf(p, 'rec', inp.recAudio.duration), recAt = recAtOf(p, srcDur);
    placeAt(inp.recAudio, 0, start - recAt, end - start, p.recVol, tr.in, tr.out, { key: 'rec', at: recAt });
  }
  if (!p.recMuted && p.recVol > 0) for (const c of p.recClips || []) {
    const b = c.src === MAIN_REC ? inp.recAudio : inp.extraRecs?.get(c.src); if (!b) continue;
    const tr = trimOf(p, recKeyOf(c), b.duration);
    placeAt(b, 0, start - c.at, end - start, p.recVol, tr.in, tr.out, { key: recKeyOf(c), at: c.at });
  }
  const out = await ctx.startRendering();
  // 시작·끝 10ms 페이드 (딸깍 소리 방지)
  const f = Math.min(480, Math.floor(len / 4));
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < f; i++) { d[i] *= i / f; d[len - 1 - i] *= i / f; }
  }
  return out;
}

const waitEvent = (el: EventTarget, name: string, ms = 5000) => new Promise<void>(res => {
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); el.removeEventListener(name, done); res(); }
  el.addEventListener(name, done);
});

export async function exportMp4(inp: ExportInput, o: ExportOptions, plan: CodecPlan,
  onProgress: (ratio: number, stage: string) => void, signal: AbortSignal): Promise<Blob> {
  const [W, H] = outSize(o);
  const { master } = inp;
  const start = Math.max(0, o.start), end = o.end;
  if (end - start < 0.2) throw new Error('추출할 구간이 너무 짧아요.');

  onProgress(0, '소리 합치는 중');
  await preloadCaptionFonts(inp.project);
  // 타임라인 토막: 기준 영상 조각이 있는 곳은 재생하며 녹화, 빈자리는 검은 화면
  const pieces = piecesOf(inp.project, master.duration || 0, start, end);
  const segs = pieces.map(pc => [pc.a, pc.b] as [number, number]);
  const audio = await mixAudio(inp, start, end);
  if (signal.aborted) throw new DOMException('취소', 'AbortError');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: plan.muxVideo, width: W, height: H, frameRate: o.fps },
    audio: { codec: plan.muxAudio, numberOfChannels: 2, sampleRate: 48000 },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encErr: any = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
  venc.configure({
    codec: plan.video, width: W, height: H, bitrate: videoBitrate(o), framerate: o.fps,
    hardwareAcceleration: 'no-preference', latencyMode: 'quality',
    ...(plan.muxVideo === 'avc' ? { avc: { format: 'avc' } } : {}),
  } as any);
  const aenc = new AudioEncoder({ output: (c: any, m: any) => muxer.addAudioChunk(c, m), error: (e: any) => { encErr = e; } });
  aenc.configure({ codec: plan.audio, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });

  // 소리 먼저 인코딩 (빠름)
  const CH = 1024, n = audio.length;
  const L = audio.getChannelData(0), R = audio.getChannelData(1);
  for (let i = 0; i < n; i += CH) {
    const m = Math.min(CH, n - i);
    const data = new Float32Array(m * 2);
    data.set(L.subarray(i, i + m), 0); data.set(R.subarray(i, i + m), m);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data });
    aenc.encode(ad); ad.close();
  }
  await aenc.flush();

  // 영상: 실제로 재생하면서 프레임마다 그린다
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const segFrames = segs.map(([a, b]) => Math.max(1, Math.round((b - a) * o.fps)));
  const total = segFrames.reduce((x, y) => x + y, 0);
  const srcEls = inp.sources || new Map<string, HTMLVideoElement>();
  const allEls = [master, ...srcEls.values()];
  const saved = allEls.map(v => ({ v, muted: v.muted, rate: v.playbackRate }));
  for (const v of allEls) { v.pause(); v.muted = true; v.playbackRate = 1; }
  onProgress(0, '영상 만드는 중');

  let k = 0, rate = 1, drops = 0;
  const MIN_RATE = 0.08;
  setExporting(true);
  // 1순위: 영상 파일을 직접 풀어서 장면을 하나도 빠짐없이 (재생 속도·탭 가림과 상관없음)
  onProgress(0, '영상 준비 중');
  const used = new Set(pieces.filter(pc => pc.clip).map(pc => pc.clip!.src || MAIN));
  const decoded = await openDecoded(master, inp.angles, srcEls, used);
  let frames: Map<string, HTMLVideoElement | null> | undefined;
  const emitFrame = (T: number) => {
    renderComposite(ctx, W, H, T, { master, angles: inp.angles, sources: srcEls, sheets: inp.sheets, project: inp.project, sheet: inp.sheet, layout: inp.layout, range: [start, end], frames });
    const vf = new VideoFrame(canvas, { timestamp: Math.round(k / o.fps * 1e6), duration: Math.round(1e6 / o.fps) });
    venc.encode(vf, { keyFrame: k % (o.fps * 2) === 0 });
    vf.close();
    k++;
  };
  // 인코더가 밀리면 잠깐 기다림 (메모리 폭주 방지)
  const drain = async () => {
    while (venc.encodeQueueSize > 12) await new Promise<void>(r => { const f = () => { venc.removeEventListener('dequeue', f); r(); }; venc.addEventListener('dequeue', f); setTimeout(f, 100); });
  };
  try {
   if (decoded) {
    // ---- 파일에서 직접 풀어서 만들기 ----
    console.info('[추출] 영상 파일에서 장면을 직접 풀어서 만드는 중');
    for (let si = 0; si < pieces.length; si++) {
      const pc = pieces[si], segTotal = segFrames[si];
      for (let i = 0; i < segTotal; i++) {
        if (signal.aborted) throw new DOMException('취소', 'AbortError');
        if (encErr) throw encErr;
        const T = pc.a + i / o.fps;
        if (pc.clip) {
          const s = pc.clip.srcIn + (T - pc.clip.start);
          frames = new Map();
          if (pc.clip.src) {
            const d = decoded.sources.get(pc.clip.src);
            frames.set('src:' + pc.clip.src, d ? (await d.frameAt(s)) as any : null);
          } else {
          frames.set(MAIN, decoded.main ? (await decoded.main.frameAt(s)) as any : null);
          for (const [id, src] of decoded.angles) {
            const at = s + (inp.project.angleOffsets[id] || 0);
            frames.set(id, at >= 0 && at <= src.duration + 0.1 ? (await src.frameAt(at)) as any : null);
          }
          }
        } else frames = new Map();
        emitFrame(T);
        await drain();
        if (k % 15 === 0) onProgress(k / total, '영상 만드는 중');
      }
    }
   } else
   for (let si = 0; si < pieces.length; si++) {
    const pc = pieces[si], segA = pc.a, segB = pc.b;
    const kBase = k, segTotal = segFrames[si];
    const el = pc.clip?.src ? srcEls.get(pc.clip.src) : master;
    for (const v of allEls) if (v !== el) v.pause();
    if (!pc.clip || !el) {
      // 빈자리: 영상 없이 바로 그림 (검은 화면 + 악보·자막)
      master.pause();
      while (k - kBase < segTotal) {
        if (signal.aborted) throw new DOMException('취소', 'AbortError');
        if (encErr) throw encErr;
        emitFrame(segA + (k - kBase) / o.fps);
        if ((k - kBase) % 30 === 0) { onProgress(k / total, '영상 만드는 중'); await new Promise(r => setTimeout(r, 0)); }
      }
      continue;
    }
    const s0 = pc.clip.srcIn + (segA - pc.clip.start), s1 = s0 + (segB - segA);
    el.currentTime = s0;
    await waitEvent(el, 'seeked');
    await new Promise(r => setTimeout(r, 350)); // 다른 앵글도 자리 잡을 시간
    await new Promise<void>((resolve, reject) => {
      let lastMt = -1, stuck = 0;
      // 영상 프레임을 하나도 놓치지 않기: 한 프레임 그리는 데 시간이 오래 걸려 영상이 앞서가면
      // (= 중간 장면을 못 받고 같은 장면이 반복 → 뚝뚝 끊김) 놓친 곳으로 되감고 재생 속도를 낮춰 다시 받음
      let pfPrev = -1, mtPrev = -1, okRun = 0, rewinding = false, lastRewindNeed = -1;
      const deltas: number[] = [];
      // 원본 영상 한 프레임 길이 (최근 연속 프레임 간격의 중간값 — 가변 프레임 영상에도 맞게)
      const sd = () => { if (deltas.length < 5) return 1 / 30; const a = [...deltas].sort((x, y) => x - y); return a[a.length >> 1]; };
      const need = () => s0 + (k - kBase) / o.fps;           // 다음에 만들 프레임의 영상 시간
      const emitUpTo = (mt: number) => {
        while (k - kBase < segTotal && need() <= mt + 0.5 / o.fps) emitFrame(segA + (k - kBase) / o.fps);
      };
      let onVis: () => void = () => {};
      const finish = () => { el.pause(); el.removeEventListener('ended', onEnded); document.removeEventListener('visibilitychange', onVis); resolve(); };
      const rewind = async (slower = true) => {
        rewinding = true;
        el.pause();
        if (slower) rate = Math.max(MIN_RATE, rate * 0.6);
        el.playbackRate = rate;
        el.currentTime = Math.max(s0, need() - sd() * 1.5);
        await waitEvent(el, 'seeked');
        await new Promise(r => setTimeout(r, 120));   // 앵글도 따라올 시간
        pfPrev = -1; mtPrev = -1; okRun = 0; rewinding = false;
        (el as any).requestVideoFrameCallback(onFrame);
        el.play().catch(reject);
      };
      const onFrame = (_now: number, meta: any) => {
        if (signal.aborted) { el.pause(); reject(new DOMException('취소', 'AbortError')); return; }
        if (encErr) { el.pause(); reject(encErr); return; }
        if (rewinding) return;
        const mt = meta.mediaTime as number, pf = meta.presentedFrames as number;
        // 원본 프레임 길이 재기 (연속된 두 프레임 사이)
        if (pfPrev >= 0 && pf - pfPrev === 1 && mt - mtPrev > 0.006 && mt - mtPrev < 0.2) { deltas.push(mt - mtPrev); if (deltas.length > 31) deltas.shift(); }
        const skipped = mtPrev >= 0 && (pf - pfPrev > 1 || mt - mtPrev > sd() * 1.6);
        pfPrev = pf; mtPrev = mt;
        // 같은 자리에서 두 번 되감지는 않음 (원본 자체에 빈 프레임이 있는 경우)
        if (skipped && need() < mt - sd() * 0.5 && rate > MIN_RATE + 1e-3 && Math.abs(need() - lastRewindNeed) > sd() * 0.5) {
          drops++; lastRewindNeed = need(); rewind(); return;
        }
        const tw = performance.now();
        emitUpTo(mt);
        // 그리는 데 걸린 시간이 영상 한 프레임 시간(재생 속도 반영)의 절반을 넘으면, 영상이 앞서가기 전에 미리 속도를 낮춤
        const spent = (performance.now() - tw) / 1000, budget = sd() / rate;
        if (spent > budget * 0.5 && rate > MIN_RATE + 1e-3) { rate = Math.max(MIN_RATE, rate * 0.7); el.playbackRate = rate; okRun = 0; }
        else if (!skipped && spent < budget * 0.2 && ++okRun > 150 && rate < 1) { rate = Math.min(1, rate * 1.25); el.playbackRate = rate; okRun = 0; }
        onProgress(k / total, '영상 만드는 중');
        if (k - kBase >= segTotal || mt >= s1) { emitUpTo(s1); finish(); return; }
        (el as any).requestVideoFrameCallback(onFrame);
      };
      // 영상이 먼저 끝나면 남은 프레임은 마지막 장면으로 채움
      function onEnded() { emitUpTo(s1); finish(); }
      el.addEventListener('ended', onEnded);
      // 탭이 가려지면 영상을 멈추고, 다시 보이면 받던 자리로 돌아가서 이어 받기 (멈춘 장면이 저장되지 않게)
      onVis = () => { if (document.hidden) el.pause(); else if (!rewinding) rewind(false); };
      document.addEventListener('visibilitychange', onVis);
      // 탭이 가려져 프레임이 안 오면 알려주기
      const guard = setInterval(() => {
        if (signal.aborted) { clearInterval(guard); return; }
        if (el.currentTime === lastMt) { stuck++; if (stuck > 6) onProgress(k / total, '멈춤 — 이 탭을 화면에 띄워두세요'); }
        else { stuck = 0; lastMt = el.currentTime; }
        if (k - kBase >= segTotal) clearInterval(guard);
      }, 500);
      (el as any).requestVideoFrameCallback(onFrame);
      el.play().catch(reject);
    });
   }
  } finally {
    for (const o of saved) { o.v.muted = o.muted; o.v.playbackRate = o.rate; }
    setExporting(false);
    if (decoded) { decoded.main?.close(); for (const d of decoded.angles.values()) d.close(); for (const d of decoded.sources.values()) d.close(); }
    if (drops) console.info(`[추출] 프레임 놓침 ${drops}번 → 되감아서 다시 받음 (마지막 속도 ${Math.round(rate * 100)}%)`);
  }
  onProgress(1, '마무리 중');
  await venc.flush();
  venc.close(); aenc.close();
  if (encErr) throw encErr;
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/** 파일 저장: 아티팩트 화면에서는 저장 확인창, 일반 페이지에서는 바로 다운로드 */
export async function saveBlob(blob: Blob, filename: string, asciiName: string, auto = false): Promise<'saved' | 'declined' | 'link'> {
  const cl = (window as any).claude;
  if (cl?.use) {
    const dl = await Promise.race([cl.use('downloads'), new Promise(r => setTimeout(() => r(null), 3000))]) as any;
    if (dl) {
      try { await dl.save({ filename, data: blob }); return 'saved'; }
      catch (e: any) { if (e?.code === 'declined') return 'declined'; }
    }
  }
  // 크롬 PC: 저장 위치와 이름을 고르는 창
  const picker = auto ? null : (window as any).showSaveFilePicker;   // 자동 저장은 고르는 창 없이 바로 다운로드
  if (picker) {
    try {
      const h = await picker({ suggestedName: filename, types: [{ description: 'MP4 영상', accept: { 'video/mp4': ['.mp4'] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      return 'saved';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'declined';
      // 보안상 막힌 화면이면 아래 방식으로
    }
  }
  // 일부 브라우저는 한글 다운로드 이름을 버리고 확장자 없는 "download"로 저장하므로 영문 이름 사용
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = asciiName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'link';
}
