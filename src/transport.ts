// 재생 시계 (로직 프로처럼): 타임라인 시간 T가 기준이고, 녹음본(소리 시계)이 메인.
// 영상들은 이 시계를 따라감 — 지금 T에 놓인 조각의 영상 파일(<video>)을 그 조각의 영상 시간으로 맞추고,
// 조금 어긋나면 재생 속도를 살짝 바꿔서, 많이 어긋나면 위치를 옮겨서 맞춘다. 조각 사이 빈자리는 검은 화면.
// 앵글은 첫 영상(MAIN)에 붙어 있어서 그 영상이 움직이면 같이 따라감 (followMaster).
import { Project, Clip, clipsOf, clipEnd, MAIN } from './model';
import { Player } from './player';

export class Transport {
  playing = false;
  private T = 0;                 // 멈춰 있을 때의 시간
  private raf = 0;
  private lastT = 0;             // 구간 반복: 끝을 '지나갈 때만' 처음으로 (끝 뒤에서 시작하면 그대로 재생)
  private cur: Clip | null = null;
  private starting = 0;          // 재생 시작 준비 중 (영상 위치 잡는 동안)
  onState: () => void = () => {};

  constructor(public els: () => Map<string, HTMLVideoElement>, public getProject: () => Project, public getDur: () => number,
    public getEnd: () => number, public player: Player) {
    const loop = () => { this.tick(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  dispose() { cancelAnimationFrame(this.raf); }

  clips() { return clipsOf(this.getProject(), this.getDur()); }
  end() { const cs = this.clips(); return Math.max(this.getEnd() || 0, cs.length ? Math.max(...cs.map(clipEnd)) : 0); }
  clipAt(T: number) {
    let hit: Clip | null = null;
    for (const c of this.clips()) if (T >= c.start - 1e-6 && T < clipEnd(c) - 1e-6) hit = c;
    return hit;
  }
  elOf(c: Clip | null) { return c ? this.els().get(c.src || MAIN) || null : null; }
  /** 지금 조각에서 타임라인 시간 − 영상 시간 */
  shift() { const c = this.cur || this.clipAt(this.time()); return c ? c.start - c.srcIn : 0; }

  time(): number { return this.playing && !this.starting ? this.player.time() : this.T; }

  seek(T: number) {
    T = Math.max(0, T);
    this.lastT = T;
    if (this.playing && !this.starting) {
      this.player.start(T);
      this.place(T, true);
    } else {
      this.T = T;
      this.place(T, false);
    }
    this.onState();
  }

  /** T에 맞게 영상 위치 잡기 (재생 중이면 장면이 나올 때까지 마지막 장면 유지) */
  private place(T: number, hold: boolean) {
    const c = this.clipAt(T), el = this.elOf(c);
    this.cur = c;
    for (const v of this.els().values()) if (v !== el && !v.paused) v.pause();
    if (!c || !el) return;
    const s = c.srcIn + (T - c.start);
    if (Math.abs(el.currentTime - s) > 0.002) this.jump(el, s, hold);
  }

  /** 영상 위치 옮기기: 새 위치의 장면이 실제로 나올 때까지 미리보기는 마지막 장면을 유지
   *  (키프레임이 드문 영상은 위치를 찾는 동안 맨 앞 장면이 잠깐 보일 수 있어서) */
  private jump(el: HTMLVideoElement, s: number, hold = true) {
    const v: any = el;
    if (!hold) { v.__seekHold = false; v.__seekTok = (v.__seekTok || 0) + 1; el.currentTime = s; return; }   // 멈춰서 훑어볼 때는 바로바로 보이게
    v.__seekHold = true;
    const tok = (v.__seekTok = (v.__seekTok || 0) + 1);
    const release = () => { if (v.__seekTok === tok) v.__seekHold = false; };
    const check = (_n: number, meta: any) => {
      if (v.__seekTok !== tok) return;
      if (Math.abs((meta?.mediaTime ?? v.currentTime) - s) < 0.08) release();
      else if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(check);
    };
    el.currentTime = s;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(check);
    else el.addEventListener('seeked', release, { once: true });
    setTimeout(release, 1500);
  }

  /** from을 주면 그 지점부터, 아니면 구간 반복 중엔 항상 구간 처음부터 */
  async play(from?: number) {
    if (this.playing) { if (from === undefined) return; this.seek(from); return; }
    const p = this.getProject(), end = this.end();
    let T = this.T;
    if (from !== undefined) T = from;
    else if (p.cycle?.on && p.cycle.end - p.cycle.start > 0.05) T = p.cycle.start;
    if (T >= end - 0.02) T = Math.min(this.clips()[0]?.start ?? 0, 0);
    T = Math.max(0, T);
    this.playing = true;
    const tok = ++this.starting;
    this.T = T; this.lastT = T;
    this.onState();
    await this.player.ready();
    // 첫 장면 준비: 영상 위치를 잡고 재생이 실제로 시작된 순간에 시계를 출발시킴 (영상과 녹음본이 처음부터 맞게)
    const c = this.clipAt(T), el = this.elOf(c);
    this.cur = c;
    if (c && el && el.readyState >= 1) {
      const s = c.srcIn + (T - c.start);
      if (Math.abs(el.currentTime - s) > 0.03) {
        el.currentTime = s;
        await new Promise<void>(r => { const f = () => { el.removeEventListener('seeked', f); r(); }; el.addEventListener('seeked', f); setTimeout(f, 500); });
      }
      el.playbackRate = 1;
      await Promise.race([el.play().catch(() => {}), new Promise(r => setTimeout(r, 700))]);
    }
    if (tok !== this.starting || !this.playing) return;   // 그 사이에 멈춤
    this.starting = 0;
    this.player.start(T);
    this.onState();
  }
  pause() {
    if (!this.playing) return;
    this.T = this.time();
    this.playing = false;
    this.starting = 0;
    this.player.stop();
    for (const v of this.els().values()) { if (!v.paused) v.pause(); v.playbackRate = 1; }
    this.onState();
  }
  toggle() { if (this.playing) this.pause(); else this.play(); }

  private tick() {
    if (!this.playing || this.starting) return;
    const p = this.getProject();
    const t = this.time();
    // 구간 반복
    const prev = this.lastT; this.lastT = t;
    if (p.cycle?.on && p.cycle.end - p.cycle.start > 0.05 && t >= p.cycle.end && prev < p.cycle.end) { this.seek(p.cycle.start); return; }
    if (t >= this.end() - 0.01 && !(p.cycle?.on)) { this.pause(); this.T = this.end(); this.onState(); return; }
    const c = this.clipAt(t), el = this.elOf(c);
    for (const v of this.els().values()) if (v !== el && !v.paused) v.pause();
    this.cur = c;
    if (c && el) {
      const s = c.srcIn + (t - c.start);
      if (el.paused || el.ended) {
        if (Math.abs(el.currentTime - s) > 0.04) this.jump(el, s);
        el.playbackRate = 1;
        if (el.readyState >= 2 && !el.seeking) el.play().catch(() => {});
      } else if (!el.seeking && !(el as any).__seekHold) {
        // 영상이 시계보다 앞서거나 늦으면: 조금이면 재생 속도로, 많이면 위치를 옮겨서 맞춤
        const drift = s - el.currentTime;
        if (Math.abs(drift) > 0.25) { el.playbackRate = 1; this.jump(el, s); }
        else if (Math.abs(drift) > 0.02) el.playbackRate = 1 + Math.max(-0.1, Math.min(0.1, drift * 1.5));
        else if (el.playbackRate !== 1) el.playbackRate = 1;
      }
    }
    // 다음 조각이 다른 영상이면 미리 위치를 잡아 둠 (넘어가는 순간 멈칫하지 않게)
    const next = this.clips().find(x => x.start > t + 1e-3 && x.start < t + 1.2);
    if (next) {
      const ne = this.elOf(next);
      if (ne && ne !== el && ne.paused && Math.abs(ne.currentTime - next.srcIn) > 0.05 && !ne.seeking) ne.currentTime = next.srcIn;
    }
  }
}
