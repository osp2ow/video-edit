// 프로젝트 데이터 모델 — 앱 전체의 기준축은 "마디"다.
export type Ratio = '9:16' | '4:5' | '16:9';
export const RATIOS: Ratio[] = ['9:16', '4:5', '16:9'];
export const RATIO_LABEL: Record<Ratio, string> = { '9:16': '릴스', '4:5': '피드', '16:9': '유튜브' };
export const RATIO_ASCII: Record<Ratio, string> = { '9:16': 'reels', '4:5': 'feed', '16:9': 'youtube' };
/** 캔버스 크기로 비율 알아내기 */
export const ratioOfWH = (W: number, H: number): Ratio => W >= H ? '16:9' : W / H > 0.7 ? '4:5' : '9:16';

export interface CardLayout {
  x: number;       // 카드 왼쪽 위 (캔버스 너비 대비 0~1)
  y: number;       // 카드 왼쪽 위 (캔버스 높이 대비 0~1)
  w: number;       // 카드 너비 (캔버스 너비 대비 0~1)
  opacity: number; // 카드 배경 불투명도 0.2~1
  lines: 1 | 2;    // 현재 줄만 / 현재 줄 + 다음 줄
}

export const MAIN = 'main'; // 기준 영상(앵글 1)의 id
export type TransType = 'cut' | 'dissolve' | 'black' | 'white' | 'slide' | 'wipe' | 'zoom' | 'blur';
export interface Cut { t: number; angle: string; tr?: { type: TransType; dur: number } } // t(영상 시간)부터 angle 앵글
/** 앵글 대신 넣을 수 있는 화면 구성 */
export const LAYOUT_IDS = ['split2', 'quad', 'pip'] as const;
export const LAYOUT_LABEL: Record<string, string> = { split2: '2분할', quad: '4분할', pip: 'PIP' };

export interface ColorFilter { brightness: number; contrast: number; saturate: number; sepia: number; hue: number }
export interface ZoomSeg { id: string; start: number; end: number; from: number; to: number }
export type MarkKind = 'punch' | 'flash' | 'shake';
export interface Punch { id: string; t: number; amt: number; kind?: MarkKind }   // kind 없으면 펀치 줌
export const MARK_KINDS: [MarkKind, string, string, string][] = [['punch', '펀치 줌', 'P', '펀치'], ['flash', '크래시 플래시', 'F', '플래시'], ['shake', '화면 흔들림', 'H', '흔들림']];
export const MARK_AMT: Record<MarkKind, { def: number; min: number; max: number; step: number }> = {
  punch: { def: 0.06, min: 0.02, max: 0.25, step: 0.005 },
  flash: { def: 0.5, min: 0.1, max: 1, step: 0.05 },
  shake: { def: 0.012, min: 0.004, max: 0.035, step: 0.001 },
};
/** 인트로·엔딩 카드의 타임라인 위치 */
export function cardSpan(fx: Fx, kind: 'intro' | 'outro', r0: number, r1: number): [number, number] {
  const c = fx[kind];
  const st = typeof c.at === 'number' ? c.at : kind === 'intro' ? r0 : Math.max(r0, r1 - c.dur);
  return [st, st + c.dur];
}
export interface Skip { id: string; start: number; end: number }
/** 기준 영상 조각: 타임라인 start부터, 영상 파일의 [srcIn, srcOut] 부분을 재생 */
export interface Clip { id: string; start: number; srcIn: number; srcOut: number; src?: string }   // src: 어느 영상 파일인지 (없으면 첫 영상)
export const clipEnd = (c: Clip) => c.start + (c.srcOut - c.srcIn);
/** 조각 목록 (손대지 않았으면 영상 전체 한 조각 · 예전 '잘라낸 구간'은 빈자리로 바꿈) */
export function clipsOf(p: Project, dur: number): Clip[] {
  if (p.clips && p.clips.length) return [...p.clips].sort((a, b) => a.start - b.start);
  if (!(dur > 0)) return [];
  const a = Math.max(0, p.trims?.main?.in ?? 0), b = Math.min(dur, p.trims?.main?.out ?? dur);
  const sk = [...(p.skips || [])].sort((x, y) => x.start - y.start);
  const out: Clip[] = [];
  let cur = a;
  for (const k of sk) {
    if (k.end <= cur || k.start >= b) continue;
    if (k.start > cur) out.push({ id: 'v' + out.length, start: cur, srcIn: cur, srcOut: Math.min(k.start, b) });
    cur = Math.max(cur, k.end);
  }
  if (cur < b) out.push({ id: 'v' + out.length, start: cur, srcIn: cur, srcOut: b });
  return out;
}
/** 타임라인 시간 → 그 순간 재생되는 조각과 영상 파일 시간 (빈자리면 null) */
export function srcAt(p: Project, t: number, dur: number): { clip: Clip; s: number } | null {
  let hit: Clip | null = null;
  for (const c of clipsOf(p, dur)) if (t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6) hit = c;   // 겹치면 뒤에 놓인 조각
  return hit ? { clip: hit, s: hit.srcIn + (t - hit.start) } : null;
}
/** 타임라인 끝 (마지막 조각 끝) */
export const timelineEnd = (p: Project, dur: number) => Math.max(dur || 0, ...clipsOf(p, dur).map(clipEnd));
/** 타임라인 전체를 dt초 옮기는 변경 (모든 요소의 상대 위치는 그대로 — 앞쪽 빈 구간 없애기용) */
export function shiftProject(p: Project, dur: number, dt: number): Partial<Project> {
  const fx = getFx(p);
  const out: Partial<Project> = {
    anchorTime: p.anchorTime + dt,
    clips: clipsOf(p, dur).map(c => ({ ...c, start: c.start + dt })),
    skips: (p.skips || []).map(k => ({ ...k, start: k.start + dt, end: k.end + dt })),
    recAt: recAtOf(p, dur) + dt,
    captions: (p.captions || []).map(c => ({ ...c, start: c.start + dt, end: c.end + dt })),
    cuts: p.cuts.map(c => ({ ...c, t: c.t <= 1e-6 ? 0 : Math.max(0, c.t + dt) })),
    fx: {
      ...fx,
      zooms: fx.zooms.map(z => ({ ...z, start: z.start + dt, end: z.end + dt })),
      punches: fx.punches.map(u => ({ ...u, t: u.t + dt })),
      intro: typeof fx.intro.at === 'number' ? { ...fx.intro, at: Math.max(0, fx.intro.at + dt) } : fx.intro,
      outro: typeof fx.outro.at === 'number' ? { ...fx.outro, at: Math.max(0, fx.outro.at + dt) } : fx.outro,
    },
  };
  if (p.recClips) out.recClips = p.recClips.map(c => ({ ...c, at: c.at + dt }));
  if (p.sheetClips) out.sheetClips = p.sheetClips.map(c => ({ ...c, start: c.start + dt }));
  if (p.cycle) out.cycle = { ...p.cycle, start: Math.max(0, p.cycle.start + dt), end: Math.max(0, p.cycle.end + dt) };
  return out;
}
/** 첫 영상(앵글이 붙는 영상)의 첫 조각: 타임라인 − 영상 시간 */
export const mainShift = (p: Project, dur: number) => { const c = clipsOf(p, dur).find(x => !x.src); return c ? c.start - c.srcIn : 0; };
/** 녹음본이 타임라인에서 시작하는 시각 (녹음본 시간 = 타임라인 − recAt). 예전 프로젝트는 첫 영상에 붙어 있던 값으로 */
export const recAtOf = (p: Project, dur: number) => typeof p.recAt === 'number' ? p.recAt : mainShift(p, dur) - p.recOffset;
export interface Trim { in: number; out: number }
/** 추가 녹음본 하나: src = 파일 이름, at = 그 녹음본 0초가 오는 타임라인 시각 */
export interface RecClip { src: string; at: number; id?: string }   // id: 잘라서 생긴 조각 (src = MAIN_REC면 첫 녹음본의 조각)
export const recKey = (src: string) => 'recx:' + src;
export const MAIN_REC = '@main';
/** 이 녹음본 조각의 줄이기(trims) 키 */
export const recKeyOf = (c: RecClip) => recKey(c.id || c.src);
/** 트랙에서 쓰는 부분 (파일 시간). 손대지 않았으면 처음부터 끝까지 */
export const trimOf = (p: Project, id: string, srcDur: number): Trim => {
  const t = p.trims?.[id];
  return t ? { in: Math.max(0, t.in), out: Math.min(srcDur || t.out, t.out) } : { in: 0, out: srcDur || 1e9 };
};
/** [a,b]에서 잘라낸 구간을 뺀 나머지 조각들 */
export function keepSegments(p: Project, a: number, b: number): [number, number][] {
  const mt = p.trims?.main;   // 기준 영상 앞뒤를 줄였으면 그 안에서만
  if (mt) { a = Math.max(a, mt.in); b = Math.min(b, mt.out); }
  const sk = [...(p.skips || [])].sort((x, y) => x.start - y.start);
  const out: [number, number][] = [];
  let cur = a;
  for (const s of sk) {
    if (s.end <= cur || s.start >= b) continue;
    if (s.start > cur) out.push([cur, Math.min(s.start, b)]);
    cur = Math.max(cur, s.end);
  }
  if (cur < b) out.push([cur, b]);
  return out.filter(([x, y]) => y - x > 0.05);
}
/** 겹치는 잘라낸 구간 합치기 */
export function mergeSkips(list: Skip[]): Skip[] {
  const s = [...list].sort((a, b) => a.start - b.start), out: Skip[] = [];
  for (const k of s) { const l = out[out.length - 1]; if (l && k.start <= l.end + 0.01) l.end = Math.max(l.end, k.end); else out.push({ ...k }); }
  return out.filter(k => k.end - k.start > 0.05);
}
export interface CardSeg { id: string; start: number; end: number }
/** 악보 조각: 타임라인 start부터 악보의 barIn~barOut 마디(0 = 악보 첫 마디 시작, 박 단위 소수 가능)를 템포대로 흘려 보여줌.
 *  0보다 앞(−)은 첫 줄을 미리 보여주는 카운트인, 악보 길이보다 뒤는 마지막 줄 그대로 */
export interface SheetClip { id: string; start: number; barIn: number; barOut: number; sheet?: string; bpm?: number }   // sheet: 어느 악보 파일인지 (없으면 첫 악보) · bpm: 이 악보 템포 (없으면 앞 템포 그대로)
/** 처음 넣을 때 악보 첫 마디가 오는 자리 (마디 눈금의 1마디) */
export const sheetHome = (p: Project) => barStart(p, 1 + (p.sheetOffset || 0));
export function sheetClipsOf(p: Project, nBars: number): SheetClip[] {
  if (p.sheetClips) return [...p.sheetClips].sort((a, b) => a.start - b.start);
  return nBars > 0 ? [{ id: 'k0', start: sheetHome(p), barIn: 0, barOut: nBars }] : [];
}
/** 이 악보 조각의 한 마디 길이 (악보마다 템포가 다를 수 있음) */
export const clipBarLen = (p: Project, c: SheetClip) => c.bpm ? p.beatsPerBar * 60 / c.bpm : barLen(p, c.start);
export const sheetClipEnd = (p: Project, c: SheetClip) => c.start + (c.barOut - c.barIn) * clipBarLen(p, c);
/** t에 보이는 악보 조각 (겹치면 나중에 시작한 것) */
export function sheetClipAt(p: Project, t: number, nBars: number): SheetClip | null {
  let hit: SheetClip | null = null;
  for (const c of sheetClipsOf(p, nBars)) if (t >= c.start - 1e-6 && t < sheetClipEnd(p, c) - 1e-6) hit = c;
  return hit;
}
/** t에서 악보 카드 불투명도: 악보 조각 안에서만 보임 (붙어 있는 조각이 없는 끝은 0.2초 동안 서서히) */
export function cardAlpha(p: Project, t: number, nBars: number) {
  const cs = sheetClipsOf(p, nBars), c = sheetClipAt(p, t, nBars);
  if (!c) return 0;
  const e = sheetClipEnd(p, c), F = 0.2;
  const joinedIn = c.start <= 0.05 || cs.some(x => x !== c && x.start < c.start - 1e-3 && sheetClipEnd(p, x) >= c.start - 0.02);
  const joinedOut = cs.some(x => x !== c && x.start <= e + 0.02 && sheetClipEnd(p, x) > e + 1e-3);
  const fi = joinedIn ? 1 : (t - c.start) / F, fo = joinedOut ? 1 : (e - t) / F;
  return Math.max(0, Math.min(1, fi, fo));
}
export const markKind = (m: Punch): MarkKind => m.kind || 'punch';
/** 인트로·엔딩 카드 글자 모양과 글상자 위치 (x·y: 상자 가운데, w: 상자 폭 — 화면 대비 0~1, y<0 · w<=0 이면 자동) */
export interface CardStyle {
  font: string; weight: number; subWeight: number; size: number; subSize: number;
  color: string; subColor: string; align: 'left' | 'center' | 'right'; dim: number;
  x: number; y: number; w: number;
}
export const defaultCardStyle = (): CardStyle => ({
  font: 'IBM Plex Sans KR', weight: 700, subWeight: 500, size: 1, subSize: 1,
  color: '#ffffff', subColor: '#e6e6e6', align: 'center', dim: 0.72, x: 0.5, y: -1, w: 0,
});
export const cardStyleOf = (c: { style?: Partial<CardStyle> }): CardStyle => ({ ...defaultCardStyle(), ...(c.style || {}) });
/** 엔딩 카드 안에서 바뀌는 문구 하나 (at: 카드가 시작된 뒤 몇 초부터) — 첫 문구는 카드의 title/sub */
export interface CardPage { id: string; at: number; title: string; sub: string }
export const FIRST_PAGE = 'first';
/** 카드의 문구들 (시간 순, 카드 길이 안에 있는 것만). 첫 문구 = 카드의 title/sub */
export function cardPages(c: { title: string; sub: string; dur: number; pages?: CardPage[] }): CardPage[] {
  const rest = (c.pages || []).filter(p => p.at > 0 && p.at < c.dur - 0.05).sort((a, b) => a.at - b.at);
  return [{ id: FIRST_PAGE, at: 0, title: c.title, sub: c.sub }, ...rest];
}
/** 카드 시작 후 dt초에 보이는 문구와 그 앞 문구 */
export function cardPageAt(c: { title: string; sub: string; dur: number; pages?: CardPage[] }, dt: number) {
  const ps = cardPages(c);
  let i = 0;
  for (let k = 1; k < ps.length; k++) if (ps[k].at <= dt + 1e-6) i = k;
  return { page: ps[i], prev: i > 0 ? ps[i - 1] : null, since: dt - ps[i].at, index: i, count: ps.length };
}
export interface Fx {
  trType: TransType; trDur: number;
  fadeIn: number; fadeOut: number; fadeColor: 'black' | 'white'; audioFade: boolean;
  intro: { on: boolean; title: string; sub: string; dur: number; at?: number; style?: Partial<CardStyle> };   // at: 타임라인 시작 시각 (없으면 영상 처음)
  outro: { on: boolean; title: string; sub: string; dur: number; at?: number; style?: Partial<CardStyle>; pages?: CardPage[] };   // at 없으면 영상 끝에 붙음 · pages: 카드 안에서 바뀌는 다음 문구들
  kenBurns: number;
  preset: string; filter: ColorFilter; vignette: number;
  logo: string | null;
  watermark: { on: boolean; pos: 'tl' | 'tr' | 'bl' | 'br'; size: number; opacity: number };
  punch: 'off' | 'manual' | 'bar' | 'beat' | 'hits'; punchAmt: number;
  zooms: ZoomSeg[];   // 서서히 확대 구간
  punches: Punch[];   // 직접 찍은 지점 (펀치 줌 · 크래시 플래시 · 화면 흔들림)
  flash: boolean; shake: boolean;
  hits: number[]; // 큰 타격음 시각 (영상 시간, 자동 계산)
  face: { on: boolean; smooth: number; bright: number; warm: number };   // 얼굴 보정
  sheetCursor: boolean;                                                  // 악보 위 진행 커서
  sheetFollow: boolean; sheetFollowBars: number;                         // 따라가기: 확대해서 연주 위치를 따라감 (보이는 마디 수)
  sheetBold: boolean;                                                    // 음표 진하게
  colorMatch: { on: boolean; m: Record<string, number[]> };              // 앵글 색 맞추기: 앵글별 [r,g,b 배율, r,g,b 더하기]
  filterOn?: boolean; zoomOn?: boolean; marksOn?: boolean;
  sheetHidden?: boolean;                                                 // 악보 카드 숨기기 (영상·미리보기 모두)                // 효과 켜고 끄기 (없으면 켜짐 · 설정값은 그대로 두고 잠깐 끄기)
}
export const NEUTRAL_FILTER: ColorFilter = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, hue: 0 };
export const defaultFx = (): Fx => ({
  trType: 'cut', trDur: 0.5,
  fadeIn: 0, fadeOut: 0, fadeColor: 'black', audioFade: true,
  intro: { on: false, title: '', sub: '', dur: 2.5 },
  outro: { on: false, title: '', sub: '', dur: 3 },
  kenBurns: 0,
  preset: 'none', filter: { ...NEUTRAL_FILTER }, vignette: 0,
  logo: null,
  watermark: { on: false, pos: 'br', size: 0.16, opacity: 0.85 },
  punch: 'off', punchAmt: 0.06,
  zooms: [], punches: [],
  flash: false, shake: false,
  hits: [],
  face: { on: false, smooth: 0.55, bright: 0.25, warm: 0.2 },
  sheetCursor: true,
  sheetFollow: true, sheetFollowBars: 2.5,
  sheetBold: true,
  colorMatch: { on: false, m: {} },
});
export const getFx = (p: Project): Fx => {
  const d = defaultFx(), f = (p as any).fx || {};
  return { ...d, ...f, zooms: f.zooms || [], punches: f.punches || [], intro: { ...d.intro, ...(f.intro || {}) }, outro: { ...d.outro, ...(f.outro || {}) },
    filter: { ...d.filter, ...(f.filter || {}) }, watermark: { ...d.watermark, ...(f.watermark || {}) },
    face: { ...d.face, ...(f.face || {}) }, colorMatch: { ...d.colorMatch, ...(f.colorMatch || {}) } };
};
export type CutSnap = 'bar' | 'beat' | 'off';

/** 영상 화면 배치: 위치(x,y: 캔버스 크기 대비), 크기 배율, 자르기(원본 대비 0~1) */
export interface VideoXf { x: number; y: number; scale: number; crop: { l: number; t: number; r: number; b: number } }
export const defaultXf = (): VideoXf => ({ x: 0, y: 0, scale: 1, crop: { l: 0, t: 0, r: 0, b: 0 } });

export type CaptionAnim = 'none' | 'fade' | 'pop' | 'up' | 'type';
export interface CaptionStyle {
  font: string; weight: number; size: number; letter: number; lineH: number; align: 'left' | 'center' | 'right';
  color: string;
  outline: boolean; outlineColor: string; outlineW: number;
  shadow: boolean; shadowBlur: number;
  box: boolean; boxColor: string; boxOpacity: number; boxPad: number; boxRadius: number;
  x: number; y: number;
  anim: CaptionAnim;
}
export interface Caption { id: string; start: number; end: number; text: string; style?: Partial<CaptionStyle>; pos?: Partial<Record<Ratio, { x: number; y: number }>> }   // pos: 이 자막만의 위치 (화면 비율별)
const baseCaption: Omit<CaptionStyle, 'size' | 'x' | 'y'> = {
  font: 'IBM Plex Sans KR', weight: 700, letter: 0, lineH: 1.3, align: 'center',
  color: '#ffffff',
  outline: true, outlineColor: '#000000', outlineW: 0.14,
  shadow: true, shadowBlur: 0.3,
  box: false, boxColor: '#000000', boxOpacity: 0.6, boxPad: 0.4, boxRadius: 0.3,
  anim: 'pop',   // 등장 효과 기본: 팝
};
export const defaultCaptionStyles = (): Record<Ratio, CaptionStyle> => ({
  '9:16': { ...baseCaption, size: 0.08, x: 0.5, y: 0.6 },
  '4:5': { ...baseCaption, size: 0.08, x: 0.5, y: 0.8 },
  '16:9': { ...baseCaption, size: 0.045, x: 0.5, y: 0.86 },   // 가로 화면은 폭이 넓어서 릴스 80과 같은 글자 높이
});
/** 예전 형식(bg: none/outline/box)도 읽을 수 있게 맞춰서 반환 */
export function normCaptionStyle(raw: any, ratio: Ratio): CaptionStyle {
  const d = defaultCaptionStyles()[ratio];
  const st: CaptionStyle = { ...d, ...(raw || {}) };
  if (raw && raw.bg && raw.outline === undefined) {
    st.outline = raw.bg === 'outline'; st.shadow = raw.bg === 'outline'; st.box = raw.bg === 'box';
  }
  delete (st as any).bg;
  // 예전 기본 크기를 그대로 쓰던 자막은 새 기본 크기(80)로
  const OLD: Record<Ratio, number> = { '9:16': 0.058, '4:5': 0.055, '16:9': 0.04 };
  if (raw && Math.abs((raw.size ?? -1) - OLD[ratio]) < 1e-6) st.size = d.size;
  return st;
}

/** PIP 작은 화면: 왼쪽 위 모서리(x,y: 화면 크기 대비)와 폭(w: 화면 폭 대비) */
export interface PipPos { x: number; y: number; w: number }

export interface Project {
  bpm: number;
  beatsPerBar: number;
  anchorTime: number;   // 영상 시간(초) — 이 지점이 anchorBar 마디의 1박
  anchorBar: number;
  recOffset: number;    // (예전 방식) 녹음본 시간 = 첫 영상 시간 + recOffset — 이제는 recAt
  recAt?: number;       // 녹음본이 타임라인에서 시작하는 시각 (녹음본이 기준: 영상들을 녹음본에 맞춰 놓음)
  recClips?: RecClip[]; // 두 번째부터 넣은 녹음본들 (타임라인 위치 · 줄이기는 trims['recx:'+src])
  videoMuted: boolean;
  videoVol: number;
  recMuted: boolean;
  recVol: number;
  clickOn: boolean;     // 미리듣기 전용 메트로놈 (추출 영상에는 절대 포함되지 않음)
  snapOnset: boolean;
  bpmTouched: boolean;
  anchorTouched: boolean;
  syncTouched: boolean;
  cuts: Cut[];
  angleOffsets: Record<string, number>; // 앵글 시간 = 영상 시간 + offset (파일 이름별)
  cutSnap: CutSnap;
  frames: Partial<Record<Ratio, Record<string, VideoXf>>>; // 비율·앵글별 영상 배치
  captions: Caption[];
  cardSegs?: CardSeg[];   // (예전 방식) 쓰지 않음
  sheetClips?: SheetClip[];   // 악보 조각들 (없으면 1마디부터 악보 전체 한 조각)
  skips?: Skip[];         // (예전 방식) 잘라낸 구간 — 이제는 clips로 바뀜
  clips?: Clip[];         // 기준 영상 조각들 (타임라인 위치 · 그 영상의 쓰는 부분). 녹음본·앵글은 영상에 붙어서 같이 움직임
  cycle?: { start: number; end: number; on: boolean };   // 구간 반복 (추출도 이 구간)
  sheetShift?: number;    // (예전 방식) 쓰지 않음
  trims?: Record<string, Trim>;   // 트랙별 쓰는 부분 (그 파일의 시간, 초) — 'main'·앵글 id·'rec'
  captionStyles: Record<Ratio, CaptionStyle>;
  pip?: Partial<Record<Ratio, PipPos>>;   // PIP 작은 화면 위치·크기 (화면 비율별, 없으면 기본 자리)
  fx: Fx;
  sheetOffset: number;  // 악보 표기 이동(마디). +1이면 악보 첫 마디가 한 마디 늦게, -1이면 한 마디 일찍 (못갖춘마디용)
}

export const defaultProject = (): Project => ({
  bpm: 120, beatsPerBar: 4, anchorTime: 0, anchorBar: 1, recOffset: 0,
  videoMuted: false, videoVol: 1, recMuted: false, recVol: 1,
  clickOn: false, snapOnset: true,
  bpmTouched: false, anchorTouched: false, syncTouched: false,
  cuts: [], angleOffsets: {}, cutSnap: 'beat',
  sheetOffset: 0, frames: {},
  captions: [], captionStyles: defaultCaptionStyles(),
  fx: defaultFx(),
});

// 4:5는 처음엔 9:16에서 맞춘 영상 배치를 이어받음
export const getXf = (p: Project, ratio: Ratio, id: string): VideoXf => p.frames?.[ratio]?.[id] || (ratio === '4:5' ? p.frames?.['9:16']?.[id] : undefined) || defaultXf();
export const withXf = (p: Project, ratio: Ratio, id: string, xf: VideoXf) =>
  ({ ...(p.frames || {}), [ratio]: { ...((p.frames || {})[ratio] || {}), [id]: xf } });

/** 영상의 n마디 → 악보 마디 순번(0부터) */
export const sheetIndex = (p: Project, bar: number) => bar - 1 - p.sheetOffset;
/** 악보 마디 순번 → 영상 마디 번호 */
export const barOfSheet = (p: Project, idx: number) => idx + 1 + p.sheetOffset;
/** 악보가 시작되는 영상 시간 */
export const sheetStart = (p: Project, nBars = 1e9) => { const cs = sheetClipsOf(p, nBars); return cs.length ? Math.min(...cs.map(c => c.start)) : sheetHome(p); };
/** 악보가 끝나는 영상 시간 */
export const sheetEnd = (p: Project, nBars: number) => { const cs = sheetClipsOf(p, nBars); return cs.length ? Math.max(...cs.map(c => sheetClipEnd(p, c))) : sheetHome(p) + nBars * barLen(p); };
/** t에서 악보 위치 (악보 조각 기준): idx = 악보 마디 순번(0부터), beat = 그 마디 안의 박(0부터), frac = 마디 안 진행(0~1) */
export function sheetPos(p: Project, t: number, nBars: number) {
  const c = sheetClipAt(p, t, nBars), L = c ? clipBarLen(p, c) : barLen(p);
  const x = c ? c.barIn + (t - c.start) / L : (t - sheetHome(p)) / L;
  const idx = Math.floor(x + 1e-9), frac = x - idx;
  return { idx, beat: Math.min(p.beatsPerBar - 1, Math.floor(frac * p.beatsPerBar + 1e-9)), frac, clip: c };
}

/** t 시점에 보여줄 앵글 id */
export function angleAt(cuts: Cut[], t: number): string {
  let id = MAIN;
  for (const c of cuts) { if (c.t <= t + 1e-6) id = c.angle; else break; }
  return id;
}

/** 같은 앵글이 연달아 오는 컷을 정리 */
export const TRANS_LIST: [TransType, string][] = [
  ['cut', '바로'], ['dissolve', '디졸브'], ['black', '검정'], ['white', '흰색'],
  ['slide', '슬라이드'], ['wipe', '와이프'], ['zoom', '줌'], ['blur', '블러'],
];

export function normalizeCuts(cuts: Cut[]): Cut[] {
  const sorted = [...cuts].sort((a, b) => a.t - b.t);
  const out: Cut[] = [];
  let prev = MAIN;
  for (const c of sorted) {
    if (c.angle === prev) continue;
    if (out.length && Math.abs(out[out.length - 1].t - c.t) < 0.02) { out[out.length - 1] = c; prev = c.angle; continue; }
    out.push(c); prev = c.angle;
  }
  // 덮어쓰기 후 다시 같은 앵글이 이어질 수 있어 한 번 더 정리
  const fin: Cut[] = [];
  prev = MAIN;
  for (const c of out) { if (c.angle !== prev) { fin.push(c); prev = c.angle; } }
  return fin;
}

/** t부터 다음 컷 전까지 앵글을 id로 바꾼다 */
export function setCutAt(cuts: Cut[], t: number, id: string): Cut[] {
  const rest = cuts.filter(c => Math.abs(c.t - t) >= 0.03);
  return normalizeCuts([...rest, { t, angle: id }]);
}

export function snapTime(p: Project, t: number, mode: CutSnap = p.cutSnap): number {
  if (mode === 'off') return t;
  const u = mode === 'bar' ? 1 : 1 / p.beatsPerBar;   // 마디 단위로 반올림 (템포가 바뀌는 곳도 맞게)
  return barStart(p, Math.round((barAt(p, t) - p.anchorBar) / u) * u + p.anchorBar);
}

export const defaultLayouts = (): Record<Ratio, CardLayout> => ({
  '9:16': { x: 0.02, y: 0.145, w: 0.96, opacity: 0.92, lines: 2 },
  '4:5': { x: 0.04, y: 0.03, w: 0.92, opacity: 0.92, lines: 2 },
  '16:9': { x: 0.52, y: 0.06, w: 0.45, opacity: 0.92, lines: 2 },
});

/** 템포 지도: 기본 템포(마디 눈금) + BPM을 정한 악보 조각이 시작하는 곳마다 템포가 바뀜
 *  각 구간: t0부터 b0마디(소수 가능), 한 마디 L초 */
export interface TempoSeg { t0: number; b0: number; L: number; bpm: number }
const tempoCache = new WeakMap<Project, TempoSeg[]>();
export function tempoSegs(p: Project): TempoSeg[] {
  let segs = tempoCache.get(p);
  if (segs) return segs;
  const L0 = p.beatsPerBar * 60 / p.bpm;
  segs = [{ t0: p.anchorTime, b0: p.anchorBar, L: L0, bpm: p.bpm }];   // 첫 구간은 앞쪽으로도 그대로 이어짐
  const ch = (p.sheetClips || []).filter(c => c.bpm && c.bpm > 0).sort((a, b) => a.start - b.start);
  for (const c of ch) {
    const cur = segs[segs.length - 1];
    if (Math.abs(cur.bpm - c.bpm!) < 1e-6 || (segs.length > 1 && c.start <= cur.t0 + 1e-6)) continue;
    let b = cur.b0 + (c.start - cur.t0) / cur.L;
    if (Math.abs(b - Math.round(b)) < 0.03) b = Math.round(b);   // 악보가 마디선에서 시작하면 마디 번호를 딱 맞춤
    segs.push({ t0: c.start, b0: b, L: p.beatsPerBar * 60 / c.bpm!, bpm: c.bpm! });
  }
  tempoCache.set(p, segs);
  return segs;
}
const segAtT = (p: Project, t: number) => { const s = tempoSegs(p); let k = 0; for (let i = 1; i < s.length; i++) if (s[i].t0 <= t + 1e-9) k = i; return s[k]; };
const segAtBar = (p: Project, n: number) => { const s = tempoSegs(p); let k = 0; for (let i = 1; i < s.length; i++) if (s[i].b0 <= n + 1e-9) k = i; return s[k]; };
/** t(없으면 기본 템포)에서 한 박 · 한 마디 길이 */
export const beatLen = (p: Project, t?: number) => (t === undefined ? p.beatsPerBar * 60 / p.bpm : segAtT(p, t).L) / p.beatsPerBar;
export const barLen = (p: Project, t?: number) => t === undefined ? p.beatsPerBar * 60 / p.bpm : segAtT(p, t).L;
export const bpmAt = (p: Project, t: number) => segAtT(p, t).bpm;
/** 영상 시간 → 소수점 마디 번호 (n마디는 [n, n+1) 구간) */
export const barAt = (p: Project, t: number) => { const g = segAtT(p, t); return g.b0 + (t - g.t0) / g.L; };
/** n마디 1박의 영상 시간 */
export const barStart = (p: Project, n: number) => { const g = segAtBar(p, n); return g.t0 + (n - g.b0) * g.L; };

export function barBeat(p: Project, t: number) {
  const pos = barAt(p, t);
  const bar = Math.floor(pos + 1e-9);
  const beat = Math.min(p.beatsPerBar - 1, Math.floor((pos - bar) * p.beatsPerBar + 1e-9));
  return { bar, beat, pos };
}

export const fmtTime = (t: number) => {
  if (!isFinite(t)) t = 0;
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`;
};
