// 멀티 앵글: 앵글별 영상 요소를 기준 영상 시계에 묶어둔다
import { Track } from './analysis';
import { Project, MAIN, angleAt, srcAt } from './model';

export interface Angle {
  id: string;          // 기준 영상은 'main', 나머지는 파일 이름
  name: string;
  video: HTMLVideoElement;
  track: Track | null;
  confidence: number | null;
  ready: boolean;
}

export const ANGLE_COLORS = ['#ff8a1f', '#56c2b4', '#a98bff', '#ff6fa5', '#f0d060', '#6fb6ff', '#f5d76e', '#ff9e7a', '#9fd8ff'];

let holder: HTMLDivElement | null = null;
export function makeAngleVideo(): HTMLVideoElement {
  if (!holder) {
    holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:0;top:0';
    document.body.appendChild(holder);
  }
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  holder.appendChild(v);
  return v;
}

/** 기준 영상의 재생·정지·탐색을 다른 앵글에 그대로 따라가게 한다 */
export function followMaster(master: HTMLVideoElement, getAngles: () => Angle[], getProject: () => Project) {
  const target = (a: Angle) => master.currentTime + (getProject().angleOffsets[a.id] || 0);
  const inRange = (a: Angle, t: number) => t >= 0 && (!a.video.duration || t < a.video.duration - 0.05);
  const others = () => getAngles().filter(a => a.id !== MAIN && a.ready);
  const place = (a: Angle) => {
    const t = target(a);
    if (inRange(a, t) && Math.abs(a.video.currentTime - t) > 0.02) a.video.currentTime = t;
  };
  const onPlay = () => others().forEach(a => { place(a); a.video.playbackRate = master.playbackRate; if (inRange(a, target(a))) a.video.play().catch(() => {}); });
  const onPause = () => others().forEach(a => { a.video.pause(); place(a); });
  const onSeek = () => others().forEach(place);
  master.addEventListener('play', onPlay);
  master.addEventListener('pause', onPause);
  master.addEventListener('seeking', onSeek);
  master.addEventListener('seeked', onSeek);
  // 재생 중 어긋남 보정: 크게 벗어나면 탐색, 조금이면 재생 속도를 살짝 바꿔서 맞춤 (탐색 중엔 화면이 비기 때문)
  const timer = window.setInterval(() => {
    if (master.paused) return;
    for (const a of others()) {
      const t = target(a);
      if (!inRange(a, t)) { if (!a.video.paused) a.video.pause(); continue; }
      if (a.video.paused) { a.video.currentTime = t; a.video.play().catch(() => {}); continue; }
      const diff = t - a.video.currentTime;
      if (Math.abs(diff) > 0.5) { a.video.currentTime = t; a.video.playbackRate = master.playbackRate; }
      else if (Math.abs(diff) > 0.02) a.video.playbackRate = master.playbackRate * (1 + Math.max(-0.08, Math.min(0.08, diff * 1.5)));
      else a.video.playbackRate = master.playbackRate;
    }
  }, 120);
  return () => {
    master.removeEventListener('play', onPlay); master.removeEventListener('pause', onPause);
    master.removeEventListener('seeking', onSeek); master.removeEventListener('seeked', onSeek);
    clearInterval(timer);
  };
}

/** 지금 화면에 그릴 영상과 앵글 id — 해당 앵글이 그 시점에 영상이 없으면 기준 영상 */
export function activeSource(master: HTMLVideoElement, angles: Angle[], p: Project, t: number, sources?: Map<string, HTMLVideoElement>): { video: HTMLVideoElement; id: string } {
  const cur = srcAt(p, t, master.duration || 0);
  if (cur?.clip.src) { const el = sources?.get(cur.clip.src); if (el) return { video: el, id: cur.clip.src }; }
  const id = angleAt(p.cuts, t);
  if (id === MAIN) return { video: master, id: MAIN };
  const a = angles.find(x => x.id === id);
  if (!a || !a.ready || a.video.readyState < 2) return { video: master, id: MAIN };
  const m = srcAt(p, t, master.duration || 0);
  const at = (m ? m.s : t) + (p.angleOffsets[a.id] || 0);
  if (at < 0 || (a.video.duration && at > a.video.duration)) return { video: master, id: MAIN };
  return { video: a.video, id: a.id };
}
