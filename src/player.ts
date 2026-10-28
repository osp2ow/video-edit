// 소리 엔진: 녹음본(WebAudio)과 미리듣기 메트로놈을 "타임라인 시계"에 맞춰 예약한다.
// 녹음본이 기준(메인)이라 영상과 상관없이 타임라인 시간에 붙어 있고, 영상들은 이 시계를 따라간다 (transport).
// 영상 자체 소리는 각 <video>가 내고(싱크 맞출 때 들으려고), 켜고 끄기·볼륨만 여기서 맞춘다.
import { Project, barAt, barStart, recAtOf, recKeyOf, MAIN_REC, fadeOf, scheduleFade } from './model';

export class Player {
  ctx: AudioContext | null = null;
  recBuf: AudioBuffer | null = null;
  recGain: GainNode | null = null;
  clickGain: GainNode | null = null;
  extraBufs = new Map<string, AudioBuffer>();   // 추가 녹음본들 (파일 이름 → 소리)
  private srcs: AudioBufferSourceNode[] = [];
  silent = false;          // 추출 중: 녹음본·메트로놈을 스피커로 내보내지 않음
  running = false;
  private T0 = 0;          // 시작한 타임라인 시간
  private c0 = 0;          // 그때의 소리 시계(초)
  private scheduledTo = 0; // 메트로놈을 예약해 둔 타임라인 시간
  private timer: number | null = null;

  constructor(public getProject: () => Project, public getMasterDur: () => number, private notify: (msg: string) => void = () => {}) {}

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.recGain = this.ctx.createGain(); this.recGain.connect(this.ctx.destination);
      this.clickGain = this.ctx.createGain(); this.clickGain.gain.value = 0.7; this.clickGain.connect(this.ctx.destination);
      this.applyRecGain();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  /** 재생 시계로 쓸 수 있는지 (소리 장치가 돌아가는 중) */
  clockReady() { return !!this.ctx && this.ctx.state === 'running'; }
  private useCtx = false;  // 지금 재생에서 쓰는 시계 (재생 도중에 바뀌면 시간이 튀므로 시작할 때 정함)
  /** 소리 시계 (초) — 소리 장치가 멈춰 있으면 컴퓨터 시계 */
  now() { const ctx = this.running ? this.useCtx : this.clockReady(); return ctx && this.ctx ? this.ctx.currentTime : performance.now() / 1000; }
  /** 소리 장치가 켜질 때까지 잠깐 기다림 (처음 재생 버튼을 누른 직후) */
  async ready(ms = 400) {
    const ctx = this.ensureCtx();
    if (ctx.state === 'running') return true;
    await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, ms))]);
    return (ctx.state as string) === 'running';
  }

  async loadRec(ab: ArrayBuffer) {
    const ctx = this.ensureCtx();
    this.recBuf = await ctx.decodeAudioData(ab);
    if (this.running) this.restart();
  }
  clearRec() { this.stopSrc(); this.recBuf = null; this.extraBufs.clear(); }
  /** 추가 녹음본 넣기 (길이를 돌려줌) */
  async addRec(id: string, ab: ArrayBuffer) {
    const ctx = this.ensureCtx();
    const b = await ctx.decodeAudioData(ab);
    this.extraBufs.set(id, b);
    if (this.running) this.restart();
    return b.duration;
  }
  removeRec(id: string) { this.extraBufs.delete(id); if (this.running) this.restart(); }

  applyRecGain() {
    const p = this.getProject();
    if (this.recGain) this.recGain.gain.value = p.recMuted ? 0 : p.recVol;
  }
  /** 영상 소리 켜기·끄기 · 볼륨 (모든 영상 같게) */
  applyVideoMix(els: HTMLVideoElement[]) {
    const p = this.getProject();
    for (const v of els) { v.muted = p.videoMuted; v.volume = Math.max(0, Math.min(1, p.videoVol)); }
  }

  /** 타임라인 시간 T부터 (소리 시계 at에) 녹음본·메트로놈 시작 */
  start(T: number, at?: number) {
    if (at === undefined) at = this.clockReady() ? this.ctx!.currentTime : performance.now() / 1000;
    this.stop();
    this.useCtx = this.clockReady();
    this.running = true;
    this.T0 = T; this.c0 = at; this.scheduledTo = T;
    this.scheduleRec();
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }
  stop() {
    this.running = false;
    this.stopSrc();
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
  /** 녹음본 위치·줄이기가 바뀌었을 때 지금 위치에서 다시 */
  restart() { if (this.running) this.start(this.time()); }
  /** 지금 타임라인 시간 (소리 시계 기준) */
  time() { return this.T0 + (this.now() - this.c0); }

  private stopSrc() {
    for (const s of this.srcs) { try { s.stop(); } catch { /* 이미 멈춤 */ } s.disconnect(); }
    this.srcs = [];
  }

  private scheduleRec() {
    const ctx = this.ctx;
    if (!ctx || !this.clockReady() || !this.recGain || this.silent) return;
    const p = this.getProject();
    const one = (buf: AudioBuffer, recAt: number, key: string) => {
      const lead = 0.02;
      const tStart = this.T0 + lead, ctStart = this.c0 + lead;
      const r0 = tStart - recAt;                                   // 녹음본 시간
      const tr = p.trims?.[key], tin = Math.max(0, tr?.in ?? 0), tout = Math.min(buf.duration, tr?.out ?? buf.duration);
      const from = Math.max(r0, tin);
      if (from >= tout) return;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      // 조각마다 페이드 인·아웃 (타임라인 시간 기준)
      const fg = ctx.createGain(), TS = recAt + tin, TE = recAt + tout;
      scheduleFade(fg.gain, t => ctStart + (t - tStart), TS, TE, fadeOf(p, key, TE - TS), recAt + from);
      s.connect(fg); fg.connect(this.recGain!);
      s.start(Math.max(ctx.currentTime, ctStart + (from - r0)), from, tout - from);
      this.srcs.push(s);
    };
    if (this.recBuf) one(this.recBuf, recAtOf(p, this.getMasterDur()), 'rec');
    for (const c of p.recClips || []) { const b = c.src === MAIN_REC ? this.recBuf : this.extraBufs.get(c.src); if (b) one(b, c.at, recKeyOf(c)); }
  }

  private tick() {
    if (!this.running) return;
    const ctx = this.ctx;
    const p = this.getProject();
    const tNow = this.time(), end = tNow + 0.15;
    if (p.clickOn && ctx && this.clickGain && !this.silent && this.clockReady()) {
      // 템포 지도(악보마다 템포가 다를 수 있음)를 따라 박마다 딸깍
      const bpb = p.beatsPerBar;
      let k = Math.ceil((barAt(p, Math.max(this.scheduledTo, tNow)) - 1e-6) * bpb);
      for (let guard = 0; guard < 64; guard++, k++) {
        const t = barStart(p, k / bpb);
        if (t > end) break;
        const ct = this.c0 + (t - this.T0);
        if (ct < ctx.currentTime) continue;
        this.click(ct, ((k % bpb) + bpb) % bpb === 0);
      }
    }
    this.scheduledTo = Math.max(this.scheduledTo, end);
  }

  private click(at: number, accent: boolean) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    o.connect(g); g.connect(this.clickGain!);
    o.start(at); o.stop(at + 0.06);
  }

  /** 영상이 재생 중 오류·멈춤이면 같은 위치에서 다시 불러오기 */
  guard(v: HTMLVideoElement) {
    let lastT = -1, stuckSince = 0, recovering = false;
    const recoveries: number[] = [];
    const recover = async (why: string) => {
      if (recovering) return;
      const now = performance.now();
      while (recoveries.length && now - recoveries[0] > 30000) recoveries.shift();
      if (recoveries.length >= 3) { this.notify('영상이 계속 멈춰요. 크롬을 최신으로 업데이트하거나, 아이폰 카메라 포맷을 "높은 호환성"으로 찍은 영상을 써주세요.'); return; }
      recoveries.push(now);
      recovering = true;
      const t = v.currentTime, wasPlaying = !v.paused;
      (v as any).__hold = true;
      try {
        v.load();
        await new Promise<void>((res) => {
          const meta = () => { v.currentTime = t; };
          const ok = () => { cleanup(); res(); };
          const cleanup = () => { v.removeEventListener('loadedmetadata', meta); v.removeEventListener('seeked', ok); v.removeEventListener('error', ok); };
          v.addEventListener('loadedmetadata', meta); v.addEventListener('seeked', ok); v.addEventListener('error', ok);
          setTimeout(ok, 5000);
        });
        if (wasPlaying) await v.play().catch(() => {});
        this.notify(`영상 재생이 끊겨서(${why}) ${t.toFixed(1)}초 위치부터 다시 불러왔어요.`);
      } finally { recovering = false; (v as any).__hold = false; }
    };
    v.addEventListener('error', () => { if (v.currentSrc) recover('오류'); });
    const iv = window.setInterval(() => {
      if (v.paused || v.ended || recovering || !v.currentSrc) { stuckSince = 0; lastT = v.currentTime; return; }
      if (v.currentTime !== lastT) { lastT = v.currentTime; stuckSince = 0; return; }
      if (!stuckSince) { stuckSince = performance.now(); return; }
      if (performance.now() - stuckSince > 2000) { stuckSince = 0; recover('멈춤'); }
    }, 500);
    return () => clearInterval(iv);
  }
}
