// 미리보기: 렌더러 결과 + 악보 카드 드래그/크기 조절 + 영상 위치 이동·크기·자르기 + 스냅/안전 영역
import { CardLayout, Project, Ratio, VideoXf, CaptionStyle, CardStyle, getXf, cardAlpha, getFx, angleAt, srcAt, PipPos } from './model';
import { styleFor } from './render';
import { SheetData } from './sheet';
import { safeZones } from './render';
export { safeZones };
import { cardBox, drawVideo, drawCard, drawCaptions, FONT, videoRect, croppedRect, captionBox, captionStyleOf, activeCaptions, cardMetrics, sheetZoom } from './render';
import { Angle, activeSource } from './angles';
import { isExporting } from './exporter';
import { renderComposite, sheetAt, activeTitleCard, cardSafeRect, clampCardY, CardLayoutResult, pipBox } from './effects';

const { useRef, useEffect, useState } = React;

export const RES: Record<Ratio, [number, number]> = { '9:16': [1080, 1920], '4:5': [1080, 1350], '16:9': [1920, 1080] };

interface Props {
  video: HTMLVideoElement;
  project: Project;
  sheet: SheetData | null;
  sheets?: Map<string, SheetData>;   // 두 번째부터 넣은 악보들
  ratio: Ratio;
  layout: CardLayout;
  onLayout: (l: CardLayout) => void;
  showSafe: boolean;
  hasVideo: boolean;
  angles: Angle[];
  sources?: Map<string, HTMLVideoElement>;   // 추가로 올린 영상들
  cropMode: boolean;
  viewTrack: string | null;   // 타임라인에서 고른 앵글만 보기
  viewLabel: string;
  onXf: (id: string, xf: VideoXf) => void;
  onPip?: (pos: PipPos | null) => void;
  levelGrid?: boolean;   // 수평 맞추기용 격자
  onEditChord?: (id: string) => void;   // 코드표 더블클릭 → 코드표 패널   // PIP 작은 화면 옮기기·크기 (null = 기본 자리로)
  onCaptionMove: (id: string, x: number, y: number) => void;
  onCardStyle?: (kind: 'intro' | 'outro', patch: Partial<CardStyle>) => void;
  onEditCard?: (kind: 'intro' | 'outro', page?: string) => void;
  selCaption: string | null;
  onSelectCaption: (id: string | null) => void;
  onCaptionText: (id: string, text: string) => void;
  clean?: boolean;            // 전체화면: 편집용 표시 없이
  now: () => number;          // 재생 시계 (타임라인 시간)
  tlEnd?: number;
  onPause?: () => void;
}

/** 지금 미리보기에 그릴 영상: 고른 앵글이 있으면 그것, 없으면 결과물 */
function pickSource(p: Props) {
  if (p.viewTrack) {
    if (p.viewTrack === 'main') { const s = activeSource(p.video, [], p.project, p.now(), p.sources); return s; }
    const a = p.angles.find(x => x.id === p.viewTrack);
    if (a) return { video: a.video, id: a.id };
  }
  return activeSource(p.video, p.angles, p.project, p.now(), p.sources);
}

const curSheet = (p: Props) => sheetAt(p.project, p.sheet, p.sheets, p.now());

type Mode = 'move' | 'resize' | 'video' | 'cl' | 'cr' | 'ct' | 'cb' | 'cap' | 'tc' | 'tcw' | 'tcs' | 'pip' | 'pipr' | 'sheetT' | 'sheetB';
interface Drag {
  mode: Mode;
  sx: number; sy: number;
  start: CardLayout;
  xf0: VideoXf; id: string; vw: number; vh: number;
  cap0?: CaptionStyle; capId?: string;
  tcKind?: 'intro' | 'outro'; tcBox?: CardLayoutResult;   // 인트로·엔딩 카드 글상자
  guides: { x?: number; y?: number }[];
  pip0?: { x: number; y: number; w: number; h: number; ar: number };   // PIP 작은 화면 (드래그 시작 때)
}

export function Preview(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const drag = useRef<Drag | null>(null);
  const hover = useRef<Mode | null>(null);
  const [W, H] = RES[props.ratio];
  // 미리보기에서 자막 더블클릭 → 그 자리에서 글자 고치기
  const [edit, setEdit] = useState<{ id: string; orig: string; text: string; left: number; top: number; w: number; fs: number; lh: number; font: string; color: string; align: CanvasTextAlign } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (edit && editRef.current) { editRef.current.focus(); editRef.current.select(); } }, [edit?.id]);
  const onDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
    const tch = tcHit(x, y);
    if (tch) { live.current.onPause?.(); live.current.onEditCard?.(tch.kind, tch.page); return; }
    if (!capHit(x, y) && pipHit(x, y)) { live.current.onPip?.(null); return; }   // PIP 더블클릭: 기본 자리로
    {
      // 악보 위·아래 가장자리 더블클릭: 자동 여백으로 되돌림
      const hm = hit(x, y);
      if (hm === 'sheetT' || hm === 'sheetB') {
        const p = live.current, sh = curSheet(p), l = p.layout, z = sheetZoom(sh, p.project), k = cardBox(l, W, H, sh, p.project).lineW * z;
        if (hm === 'sheetT') { const a0 = cardMetrics(sh, l)!.above, a1 = cardMetrics(sh, { ...l, cropT: 0 })!.above; p.onLayout({ ...l, cropT: 0, y: Math.max(0, l.y - (a1 - a0) * k / H) }); }
        else p.onLayout({ ...l, cropB: 0 });
        return;
      }
    }
    const c = capHit(x, y);
    if (!c) return;
    if (c.chord) { live.current.onEditChord?.(c.id); return; }   // 코드표는 글자 고치기 대신 코드표 패널
    live.current.onPause?.();
    const st = styleFor(live.current.project, live.current.ratio, c);
    const b = captionBox(canvasRef.current!.getContext('2d')!, W, H, c, st);
    const k = r.width / W, w = Math.max(b.w, W * 0.5) * k;
    live.current.onSelectCaption(c.id);
    setEdit({ id: c.id, orig: c.text, text: c.text, left: st.x * W * k - w / 2, top: b.y * k, w, fs: b.fs * k, lh: st.lineH,
      font: `"${st.font}", sans-serif`, color: st.color, align: st.align as CanvasTextAlign });
  };

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = canvasRef.current;
      if (c && !isExporting()) {
        const ctx = c.getContext('2d')!;
        const { video, project, layout, ratio, hasVideo, angles, cropMode, clean } = live.current;
        const sheet = sheetAt(project, live.current.sheet, live.current.sheets, live.current.now());
        const showSafe = live.current.showSafe && !clean;
        const [w, h] = RES[ratio];
        // 순서: 영상 → 안전 영역(카드 아래) → 악보 카드 → 편집용 표시
        const t = live.current.now();
        const src = hasVideo ? pickSource(live.current) : null;
        const xf = src ? getXf(project, ratio, src.id) : null;
        if (cropMode && src && xf && src.video.videoWidth) {
          drawCropView(ctx, w, h, src.video, xf);
        } else {
          renderComposite(ctx, w, h, t, { master: video, angles, sources: live.current.sources, project, sheet: live.current.sheet, sheets: live.current.sheets, layout, range: [0, Math.max(video.duration || 0, live.current.tlEnd || 0)] },
            { viewTrack: live.current.viewTrack, beforeCard: showSafe ? () => drawSafe(ctx, w, h, ratio) : undefined, ghostCard: false, preview: true });
          if (!hasVideo && showSafe) drawSafe(ctx, w, h, ratio);
          if (!clean) {
            drawCapOutline(ctx, w, h, t, project, ratio, drag.current?.mode === 'cap' || hover.current === 'cap');
            {
              const tc = activeTitleCard(ctx, w, h, t, project, range());
              const m = drag.current?.mode || hover.current;
              if (tc) drawTcOutline(ctx, w, h, tc.box, m === 'tc' || m === 'tcw' || m === 'tcs', drag.current?.mode === 'tc' ? drag.current.guides : []);
            }
            // 악보 카드는 타임라인에 악보가 있는 동안에만 (없는 곳에서는 테두리·손잡이도 숨김)
            const cardDrag = drag.current?.mode === 'move' || drag.current?.mode === 'resize' || drag.current?.mode === 'sheetT' || drag.current?.mode === 'sheetB';
            if (cardDrag || cardVisible(project, sheet, t)) drawEditing(ctx, w, h, ratio, layout, sheet, showSafe, drag.current, hover.current, project);
          }
          // PIP 작은 화면: 마우스를 올리거나 옮기는 중이면 테두리·모서리 손잡이
          {
            const pm = drag.current?.mode === 'pip' || drag.current?.mode === 'pipr' ? drag.current.mode : hover.current === 'pip' || hover.current === 'pipr' ? hover.current : null;
            const pb = pm && !clean ? pipNow() : null;
            if (pb) drawPipOutline(ctx, w, pb, drag.current?.mode === pm ? drag.current.guides : [], h);
          }
          // 영상을 옮기는 중이면 영상 테두리와 가이드
          if (drag.current?.mode === 'video' && src && xf) drawVideoGuides(ctx, w, h, src.video, xf, drag.current.guides);
        }
        if (live.current.levelGrid && !clean) drawLevelGrid(ctx, w, h);
        if (live.current.viewLabel && !clean) drawBadge(ctx, w, live.current.viewLabel);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toCanvas = (e: PointerEvent | React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };

  const source = () => {
    const p = live.current;
    if (!p.hasVideo) return null;
    const src = pickSource(p);
    if (!src.video.videoWidth) return null;
    return { ...src, xf: getXf(p.project, p.ratio, src.id), vw: src.video.videoWidth, vh: src.video.videoHeight };
  };

  const range = (): [number, number] => [0, Math.max(live.current.video.duration || 0, live.current.tlEnd || 0)];
  /** 지금 보이는 인트로·엔딩 카드 글상자를 눌렀는지 (모서리 · 양옆 · 가운데) */
  const tcHit = (x: number, y: number): { kind: 'intro' | 'outro'; box: CardLayoutResult; page: string; mode: Mode } | null => {
    const p = live.current;
    if (!p.onCardStyle || p.viewTrack) return null;
    const tc = activeTitleCard(canvasRef.current!.getContext('2d')!, W, H, p.now(), p.project, range());
    if (!tc) return null;
    const b = tc.box, th = W * 0.025;
    if (Math.hypot(x - (b.x + b.w), y - (b.y + b.h)) < th * 1.6) return { ...tc, mode: 'tcs' };
    if (y > b.y - th && y < b.y + b.h + th && (Math.abs(x - b.x) < th || Math.abs(x - (b.x + b.w)) < th)) return { ...tc, mode: 'tcw' };
    if (x > b.x - th && x < b.x + b.w + th && y > b.y - th && y < b.y + b.h + th) return { ...tc, mode: 'tc' };
    return null;
  };

  /** 지금 보이는 자막을 눌렀는지 */
  const capHit = (x: number, y: number) => {
    const p = live.current;
    const ctx = canvasRef.current!.getContext('2d')!;
    const list = activeCaptions(p.project, p.now());
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      const b = captionBox(ctx, W, H, c, styleFor(p.project, p.ratio, c));
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return c;
    }
    return null;
  };

  /** 지금 화면에 PIP 작은 화면이 보이면 그 자리 (픽셀) */
  const pipNow = () => {
    const p = live.current;
    if (p.viewTrack || p.cropMode || !p.hasVideo || !p.angles.length || p.clean) return null;
    const t = p.now();
    if (angleAt(p.project.cuts, t) !== 'pip') return null;
    if (srcAt(p.project, t, p.video.duration || 0)?.clip.src) return null;   // 이어 붙인 영상 구간엔 PIP 없음
    return pipBox(W, H, p.project);
  };
  const pipHit = (x: number, y: number): Mode | null => {
    const b = pipNow();
    if (!b) return null;
    if (Math.hypot(x - (b.x + b.w), y - (b.y + b.h)) < W * 0.042) return 'pipr';
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return 'pip';
    return null;
  };

  const hit = (x: number, y: number): Mode | null => {
    const p = live.current;
    const src = source();
    if (p.cropMode) {
      if (!src) return null;
      const d = croppedRect(W, H, src.vw, src.vh, src.xf);
      const th = W * 0.03;
      const inY = y > d.y - th && y < d.y + d.h + th, inX = x > d.x - th && x < d.x + d.w + th;
      if (inY && Math.abs(x - d.x) < th) return 'cl';
      if (inY && Math.abs(x - (d.x + d.w)) < th) return 'cr';
      if (inX && Math.abs(y - d.y) < th) return 'ct';
      if (inX && Math.abs(y - (d.y + d.h)) < th) return 'cb';
      return 'video';
    }
    const tch = tcHit(x, y);
    if (tch) return tch.mode;
    const cap = capHit(x, y);
    if (cap) return 'cap';
    // PIP는 악보 카드에 가려져도 잡을 수 있게 카드보다 먼저
    const ph = pipHit(x, y);
    if (ph) return ph;
    if (!cardVisible(p.project, curSheet(p), live.current.now())) return src ? 'video' : null;
    const g = cardBox(p.layout, W, H, curSheet(p), p.project);
    const hr = W * 0.03;
    if (Math.hypot(x - (g.x + g.w), y - (g.y + g.h)) < hr * 1.4) return 'resize';
    // 위·아래 가장자리: 악보 흰 여백 자르기 (악보가 있을 때만)
    if (curSheet(p)?.bars.length && x > g.x + g.w * 0.08 && x < g.x + g.w * 0.92) {
      if (Math.abs(y - g.y) < hr * 1.1) return 'sheetT';
      if (Math.abs(y - (g.y + g.h)) < hr * 1.1) return 'sheetB';
    }
    if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return 'move';
    return src ? 'video' : null;
  };

  const CURSOR: Record<Mode, string> = { tc: 'move', tcw: 'ew-resize', tcs: 'nwse-resize', cap: 'move', move: 'grab', resize: 'nwse-resize', video: 'move', pip: 'move', pipr: 'nwse-resize', sheetT: 'ns-resize', sheetB: 'ns-resize', cl: 'ew-resize', cr: 'ew-resize', ct: 'ns-resize', cb: 'ns-resize' };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvas(e);
    const m = hit(x, y);
    if (!m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const src = source();
    const hitCap = m === 'cap' ? capHit(x, y) : null;
    const tch = m === 'tc' || m === 'tcw' || m === 'tcs' ? tcHit(x, y) : null;
    if (hitCap) live.current.onSelectCaption(hitCap.id);
    drag.current = { mode: m, sx: x, sy: y, start: { ...live.current.layout }, guides: [],
      cap0: hitCap ? styleFor(live.current.project, live.current.ratio, hitCap) : undefined, capId: hitCap?.id,
      tcKind: tch?.kind, tcBox: tch?.box, pip0: m === 'pip' || m === 'pipr' ? pipNow() || undefined : undefined,
      xf0: src ? JSON.parse(JSON.stringify(src.xf)) : null, id: src?.id || 'main', vw: src?.vw || 1, vh: src?.vh || 1 };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvas(e);
    const d = drag.current;
    if (!d) {
      const m = hit(x, y);
      hover.current = m === 'video' ? null : m;
      e.currentTarget.style.cursor = m ? CURSOR[m] : 'default';
      return;
    }
    e.currentTarget.style.cursor = d.mode === 'move' ? 'grabbing' : CURSOR[d.mode];
    const p = live.current;
    const th = W * 0.018;
    if ((d.mode === 'tc' || d.mode === 'tcw' || d.mode === 'tcs') && d.tcBox && d.tcKind) {
      // 인트로·엔딩 카드 글상자: 옮기기 / 폭 / 글자 크기 — 가이드라인 안에서만
      const b = d.tcBox, S = cardSafeRect(W, H), st: CardStyle = b.st;
      const keep = { x: b.cx / W, y: b.cy / H, w: b.w / W };
      if (d.mode === 'tc') {
        let cx = b.cx + (x - d.sx), cy = b.cy + (y - d.sy);
        const guides: { x?: number; y?: number }[] = [];
        if (Math.abs(cx - W / 2) < th) { cx = W / 2; guides.push({ x: W / 2 }); }
        if (Math.abs(cy - H / 2) < th) { cy = H / 2; guides.push({ y: cy }); }
        cx = Math.max(S.l + b.w / 2, Math.min(S.r - b.w / 2, cx));
        cy = clampCardY(cy, b.h, H, S);
        d.guides = guides;
        p.onCardStyle?.(d.tcKind, { ...keep, x: cx / W, y: cy / H });
      } else if (d.mode === 'tcw') {
        const hw = Math.abs(x - b.cx);
        const w = Math.max(W * 0.2, Math.min(S.r - S.l, hw * 2));
        p.onCardStyle?.(d.tcKind, { ...keep, w: w / W });
      } else {
        const r0 = Math.max(1, Math.hypot(d.sx - b.cx, d.sy - b.cy)), r1 = Math.hypot(x - b.cx, y - b.cy);
        const k = r1 / r0, cl = (v: number) => Math.max(0.4, Math.min(2.5, Math.round(v * 100) / 100));
        p.onCardStyle?.(d.tcKind, { ...keep, size: cl(st.size * k), subSize: cl(st.subSize * k) });
      }
      return;
    }
    if ((d.mode === 'pip' || d.mode === 'pipr') && d.pip0) {
      // PIP 작은 화면: 옮기기 (가장자리·가운데·안전 영역에 자석) / 오른쪽 아래 모서리로 크기
      const b = d.pip0, mg = W * 0.04, safe = safeZones(p.ratio, W, H);
      const guides: { x?: number; y?: number }[] = [];
      if (d.mode === 'pip') {
        let nx = b.x + (x - d.sx), ny = b.y + (y - d.sy);
        const sx: [number, number][] = [[mg, mg], [W - mg - b.w, W - mg], [W / 2 - b.w / 2, W / 2]];
        for (const [tg, gl] of sx) if (Math.abs(nx - tg) < th) { nx = tg; guides.push({ x: gl }); break; }
        const sy: [number, number][] = [[safe.top, safe.top], [mg, mg], [H / 2 - b.h / 2, H / 2], [safe.bottomSoft - b.h, safe.bottomSoft], [H - mg - b.h, H - mg]];
        for (const [tg, gl] of sy) if (Math.abs(ny - tg) < th) { ny = tg; guides.push({ y: gl }); break; }
        nx = Math.max(0, Math.min(W - b.w, nx)); ny = Math.max(0, Math.min(H - b.h, ny));
        d.guides = guides;
        p.onPip?.({ x: nx / W, y: ny / H, w: b.w / W });
      } else {
        let nw = b.w + (x - d.sx);
        nw = Math.max(W * 0.15, Math.min(W - b.x, (H - b.y) / b.ar, nw));
        if (Math.abs(b.x + nw - (W - mg)) < th) { nw = W - mg - b.x; guides.push({ x: W - mg }); }
        d.guides = guides;
        p.onPip?.({ x: b.x / W, y: b.y / H, w: nw / W });
      }
      return;
    }
    if (d.mode === 'cap' && d.cap0) {
      // 자막 위치 이동 (모든 자막 공통) — 가운데·안전 영역 경계에 자석
      let nx = d.cap0.x + (x - d.sx) / W, ny = d.cap0.y + (y - d.sy) / H;
      const guides: { x?: number; y?: number }[] = [];
      if (Math.abs((nx - 0.5) * W) < th) { nx = 0.5; guides.push({ x: W / 2 }); }
      const safe = safeZones(p.ratio, W, H);
      for (const gy of [H / 2, safe.bottomSoft, safe.top]) if (Math.abs(ny * H - gy) < th) { ny = gy / H; guides.push({ y: gy }); break; }
      d.guides = guides;
      if (d.capId) p.onCaptionMove(d.capId, Math.max(0.05, Math.min(0.95, nx)), Math.max(0.03, Math.min(0.97, ny)));
      return;
    }
    if (d.mode === 'video') {
      // 영상 위치 이동 — 화면 밖으로도 갈 수 있고, 가운데 근처에서 자석
      let nx = d.xf0.x + (x - d.sx) / W, ny = d.xf0.y + (y - d.sy) / H;
      const guides: { x?: number; y?: number }[] = [];
      if (Math.abs(nx * W) < th) { nx = 0; guides.push({ x: W / 2 }); }
      if (Math.abs(ny * H) < th) { ny = 0; guides.push({ y: H / 2 }); }
      d.guides = guides;
      p.onXf(d.id, { ...d.xf0, x: nx, y: ny });
      return;
    }
    if (d.mode === 'cl' || d.mode === 'cr' || d.mode === 'ct' || d.mode === 'cb') {
      const full = videoRect(W, H, d.vw, d.vh, d.xf0);
      const c = { ...d.xf0.crop }, MIN = 0.05;
      if (d.mode === 'cl') c.l = Math.max(0, Math.min(1 - c.r - MIN, (x - full.x) / full.w));
      if (d.mode === 'cr') c.r = Math.max(0, Math.min(1 - c.l - MIN, (full.x + full.w - x) / full.w));
      if (d.mode === 'ct') c.t = Math.max(0, Math.min(1 - c.b - MIN, (y - full.y) / full.h));
      if (d.mode === 'cb') c.b = Math.max(0, Math.min(1 - c.t - MIN, (full.y + full.h - y) / full.h));
      p.onXf(d.id, { ...d.xf0, crop: c });
      return;
    }
    if (d.mode === 'sheetT' || d.mode === 'sheetB') {
      // 악보 위·아래 흰 여백 자르기: 위를 끌면 카드 위쪽이 손을 따라오고(악보 줄은 제자리), 아래를 끌면 카드 아래가 따라옴
      const sh = curSheet(p), z = sheetZoom(sh, p.project), g0 = cardBox(d.start, W, H, sh, p.project);
      const k = g0.lineW * z, lines = z > 1 ? 1 : d.start.lines, dy = y - d.sy;
      const m0 = cardMetrics(sh, d.start)!;
      if (d.mode === 'sheetT') {
        const next = { ...d.start, cropT: (d.start.cropT || 0) + dy / k };
        const m1 = cardMetrics(sh, next)!;
        next.cropT = (d.start.cropT || 0) + (m0.above - m1.above);   // 한계(오선 · 줄 그림 끝)에 닿으면 거기서 멈춤
        next.y = Math.max(0, d.start.y + (m0.above - m1.above) * k / H);
        p.onLayout(next);
      } else {
        const next = { ...d.start, cropB: (d.start.cropB || 0) - dy / (k * lines) };
        const m1 = cardMetrics(sh, next)!;
        next.cropB = (d.start.cropB || 0) + (m0.below - m1.below);
        p.onLayout(next);
      }
      return;
    }
    const safe = safeZones(p.ratio, W, H);
    const margin = W * 0.03;
    if (d.mode === 'move') {
      const g0 = cardBox(d.start, W, H, curSheet(p), p.project);
      let nx = g0.x + (x - d.sx), ny = g0.y + (y - d.sy);
      const guides: { x?: number; y?: number }[] = [];
      const snapsX: [number, number][] = [[W / 2 - g0.w / 2, W / 2], [safe.side, safe.side], [W - safe.side - g0.w, W - safe.side], [margin, margin], [W - margin - g0.w, W - margin]];
      for (const [target, guide] of snapsX) if (Math.abs(nx - target) < th) { nx = target; guides.push({ x: guide }); break; }
      const snapsY: [number, number][] = [
        [safe.top, safe.top], [safe.bottomSoft - g0.h, safe.bottomSoft], [safe.bottom - g0.h, safe.bottom], [H / 2 - g0.h / 2, H / 2],
      ];
      for (const [target, guide] of snapsY) if (Math.abs(ny - target) < th) { ny = target; guides.push({ y: guide }); break; }
      nx = Math.max(0, Math.min(W - g0.w, nx));
      ny = Math.max(0, Math.min(H - g0.h, ny));
      d.guides = guides;
      p.onLayout({ ...d.start, x: nx / W, y: ny / H });
    } else {
      const g0 = cardBox(d.start, W, H, curSheet(p), p.project);
      let nw = Math.max(W * 0.3, Math.min(W - g0.x, g0.w + (x - d.sx)));
      const guides: { x?: number; y?: number }[] = [];
      if (Math.abs(g0.x + nw - (W - margin)) < th) { nw = W - margin - g0.x; guides.push({ x: W - margin }); }
      if (Math.abs(g0.x + nw / 2 - W / 2) < th) { nw = (W / 2 - g0.x) * 2; guides.push({ x: W / 2 }); }
      d.guides = guides;
      const next = { ...d.start, w: nw / W };
      const g1 = cardBox(next, W, H, curSheet(p), p.project);
      if (g1.y + g1.h > H) next.y = Math.max(0, (H - g1.h) / H);
      p.onLayout(next);
    }
  };

  // Ctrl+휠: 영상 크기
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const src = source();
      if (!src) return;
      e.preventDefault();
      const scale = Math.max(0.2, Math.min(5, src.xf.scale * Math.exp(-(e.deltaY || e.deltaX) * 0.0015)));
      live.current.onXf(src.id, { ...src.xf, scale });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  const onUp = () => { drag.current = null; };

  return (
    <div className="stage-box">
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className={`stage stage-${props.ratio === '9:16' ? 'v' : props.ratio === '4:5' ? 'f' : 'h'}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => { if (!drag.current) hover.current = null; }}
      onDoubleClick={onDbl}
      aria-label="미리보기"
    />
    {edit && (
      <textarea ref={editRef} className="cap-inline" value={edit.text} aria-label="자막 내용 고치기"
        rows={Math.max(1, edit.text.split('\n').length)}
        style={{ left: edit.left, top: edit.top, width: edit.w, fontSize: edit.fs, lineHeight: edit.lh, fontFamily: edit.font, color: edit.color, textAlign: edit.align as any }}
        onChange={e => { const v = e.target.value; setEdit({ ...edit, text: v }); live.current.onCaptionText(edit.id, v); }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); setEdit(null); }
          else if (e.key === 'Escape') { live.current.onCaptionText(edit.id, edit.orig); setEdit(null); }
        }}
        onBlur={() => setEdit(null)} />
    )}
    </div>
  );
}

function drawSafe(ctx: CanvasRenderingContext2D, W: number, H: number, ratio: Ratio) {
  ctx.save();
    const sz = safeZones(ratio, W, H);
    for (const z of sz.zones) {
      ctx.fillStyle = z.soft ? 'rgba(240,180,76,0.13)' : 'rgba(232,72,72,0.22)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = z.soft ? 'rgba(240,180,76,0.6)' : 'rgba(255,120,120,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,235,235,0.9)';
      ctx.font = `600 ${W * 0.024}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (z.w > W * 0.3) ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2);
      else { ctx.save(); ctx.translate(z.x + z.w / 2, z.y + z.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(z.label, 0, 0); ctx.restore(); }
    }
    if (ratio === '9:16') {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.setLineDash([6, 10]);
      ctx.beginPath(); ctx.moveTo(sz.side, sz.top); ctx.lineTo(sz.side, sz.bottom); ctx.moveTo(W - sz.side, sz.top); ctx.lineTo(W - sz.side, sz.bottom); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (ratio === '16:9') {
      ctx.strokeStyle = 'rgba(255,120,120,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
      ctx.setLineDash([]);
    }
    ctx.restore();
}

/** 지금 악보 카드가 화면에 보이는지 (타임라인에서 악보 조각이 있는 곳) */
function cardVisible(project: Project, sheet: SheetData | null, t: number) {
  return !getFx(project).sheetHidden && !!sheet?.bars.length && cardAlpha(project, t, sheet.bars.length) > 0.01;
}
function drawEditing(ctx: CanvasRenderingContext2D, W: number, H: number, ratio: Ratio, layout: CardLayout,
  sheet: SheetData | null, showSafe: boolean, d: Drag | null, hover: Mode | null, project?: Project) {
  ctx.save();
  const g = cardBox(layout, W, H, sheet, project);
  if (showSafe && ratio === '9:16') {
    const hitZone = safeZones(ratio, W, H).zones.some(z => !z.soft && g.x < z.x + z.w && g.x + g.w > z.x && g.y < z.y + z.h && g.y + g.h > z.y);
    if (hitZone) {
      ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = W * 0.004; ctx.setLineDash([W * 0.014, W * 0.008]);
      ctx.beginPath(); ctx.roundRect(g.x - 3, g.y - 3, g.w + 6, g.h + 6, g.w * 0.03); ctx.stroke();
      ctx.setLineDash([]);
      const msg = '인스타 화면에 일부가 가려지는 위치예요';
      ctx.font = `600 ${W * 0.026}px ${FONT}`;
      const tw = ctx.measureText(msg).width;
      const ty = g.y > H * 0.2 ? g.y - W * 0.05 : g.y + g.h + W * 0.012;
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2 - W * 0.02, ty, tw + W * 0.04, W * 0.042, W * 0.012); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, W / 2, ty + W * 0.021);
    }
  }
  if ((d && (d.mode === 'move' || d.mode === 'resize')) || hover === 'move' || hover === 'resize') {
    ctx.strokeStyle = '#ffb066'; ctx.lineWidth = W * 0.003; ctx.setLineDash([W * 0.012, W * 0.008]);
    ctx.beginPath(); ctx.roundRect(g.x - 4, g.y - 4, g.w + 8, g.h + 8, g.w * 0.03); ctx.stroke();
    ctx.setLineDash([]);
  }
  // 악보 위·아래 여백 자르기 손잡이 (가운데 작은 막대)
  if (sheet?.bars.length) {
    for (const [yy, mode] of [[g.y, 'sheetT'], [g.y + g.h, 'sheetB']] as [number, Mode][]) {
      const on = hover === mode || d?.mode === mode, bw = g.w * 0.12, bh = W * 0.011;
      ctx.fillStyle = on ? '#ff8a1f' : 'rgba(255,255,255,0.95)'; ctx.strokeStyle = '#ff8a1f'; ctx.lineWidth = W * 0.003;
      ctx.beginPath(); ctx.roundRect(g.x + g.w / 2 - bw / 2, yy - bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.stroke();
    }
    if (d?.mode === 'sheetT' || d?.mode === 'sheetB' || hover === 'sheetT' || hover === 'sheetB') {
      ctx.strokeStyle = '#ffb066'; ctx.lineWidth = W * 0.003; ctx.setLineDash([W * 0.012, W * 0.008]);
      ctx.beginPath(); ctx.roundRect(g.x - 4, g.y - 4, g.w + 8, g.h + 8, g.w * 0.03); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // 크기 조절 손잡이 (항상 보이게 — 조작 가능하다는 걸 알 수 있도록)
  const hr = W * 0.017;
  ctx.fillStyle = hover === 'resize' || d?.mode === 'resize' ? '#ff8a1f' : 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#ff8a1f'; ctx.lineWidth = W * 0.004;
  ctx.beginPath(); ctx.arc(g.x + g.w, g.y + g.h, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (d) {
    ctx.strokeStyle = '#3ad1c0'; ctx.lineWidth = W * 0.0025;
    for (const gd of d.guides) {
      ctx.beginPath();
      if (gd.x !== undefined) { ctx.moveTo(gd.x, 0); ctx.lineTo(gd.x, H); }
      if (gd.y !== undefined) { ctx.moveTo(0, gd.y); ctx.lineTo(W, gd.y); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 자르기 화면: 잘려 나갈 부분은 흐리게, 남는 부분은 그대로, 네 변에 손잡이 */
function drawCropView(ctx: CanvasRenderingContext2D, W: number, H: number, video: HTMLVideoElement, xf: VideoXf) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const d = croppedRect(W, H, vw, vh, xf), f = d.full;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.3; ctx.drawImage(video, f.x, f.y, f.w, f.h); ctx.globalAlpha = 1;
  const c = xf.crop;
  ctx.drawImage(video, c.l * vw, c.t * vh, vw * (1 - c.l - c.r), vh * (1 - c.t - c.b), d.x, d.y, d.w, d.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.strokeRect(f.x, f.y, f.w, f.h); ctx.setLineDash([]);
  ctx.strokeStyle = '#ff8a1f'; ctx.lineWidth = W * 0.004;
  ctx.strokeRect(d.x, d.y, d.w, d.h);
  const hl = W * 0.06, hw = W * 0.012;
  ctx.fillStyle = '#ff8a1f';
  ctx.fillRect(d.x - hw / 2, d.y + d.h / 2 - hl / 2, hw, hl);
  ctx.fillRect(d.x + d.w - hw / 2, d.y + d.h / 2 - hl / 2, hw, hl);
  ctx.fillRect(d.x + d.w / 2 - hl / 2, d.y - hw / 2, hl, hw);
  ctx.fillRect(d.x + d.w / 2 - hl / 2, d.y + d.h - hw / 2, hl, hw);
}

function drawVideoGuides(ctx: CanvasRenderingContext2D, W: number, H: number, video: HTMLVideoElement, xf: VideoXf, guides: { x?: number; y?: number }[]) {
  if (!video.videoWidth) return;
  const d = croppedRect(W, H, video.videoWidth, video.videoHeight, xf);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,176,102,0.9)'; ctx.lineWidth = W * 0.003; ctx.setLineDash([W * 0.012, W * 0.008]);
  ctx.strokeRect(d.x, d.y, d.w, d.h);
  ctx.setLineDash([]);
  ctx.strokeStyle = '#3ad1c0'; ctx.lineWidth = W * 0.0025;
  for (const g of guides) {
    ctx.beginPath();
    if (g.x !== undefined) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H); }
    if (g.y !== undefined) { ctx.moveTo(0, g.y); ctx.lineTo(W, g.y); }
    ctx.stroke();
  }
  ctx.restore();
}

/** 수평 맞추기 격자 (가로·세로 8칸, 가운데 선은 진하게) */
function drawLevelGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.save();
  const n = 8, step = W / n;
  for (let i = 1; i * step < Math.max(W, H); i++) {
    const strong = (i * step === W / 2);
    ctx.strokeStyle = strong ? 'rgba(255,214,120,0.8)' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = strong ? 2 : 1;
    if (i * step < W) { ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, H); ctx.stroke(); }
  }
  for (let y = H / 2 % step; y < H; y += step) {
    const strong = Math.abs(y - H / 2) < 1;
    ctx.strokeStyle = strong ? 'rgba(255,214,120,0.8)' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = strong ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}

/** PIP 작은 화면 테두리 + 크기 손잡이 + 자석 가이드 */
function drawPipOutline(ctx: CanvasRenderingContext2D, W: number, b: { x: number; y: number; w: number; h: number }, guides: { x?: number; y?: number }[], H: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,184,214,0.95)'; ctx.lineWidth = W * 0.003; ctx.setLineDash([W * 0.012, W * 0.008]);
  ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb8d6'; ctx.strokeStyle = '#000'; ctx.lineWidth = W * 0.002;
  ctx.beginPath(); ctx.arc(b.x + b.w, b.y + b.h, W * 0.016, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#3ad1c0'; ctx.lineWidth = W * 0.0025;
  for (const g of guides) {
    ctx.beginPath();
    if (g.x !== undefined) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H); }
    if (g.y !== undefined) { ctx.moveTo(0, g.y); ctx.lineTo(W, g.y); }
    ctx.stroke();
  }
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, W: number, text: string) {
  ctx.save();
  ctx.font = `700 ${W * 0.032}px ${FONT}`;
  const tw = ctx.measureText(text).width, pad = W * 0.02, h = W * 0.058;
  ctx.fillStyle = 'rgba(58,209,192,0.95)';
  ctx.beginPath(); ctx.roundRect(W * 0.03, W * 0.03, tw + pad * 2, h, h / 2); ctx.fill();
  ctx.fillStyle = '#0c1d1b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, W * 0.03 + pad, W * 0.03 + h / 2);
  ctx.restore();
}

function drawCapOutline(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: Project, ratio: Ratio, on: boolean) {
  if (!on) return;
  ctx.save();
  ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = W * 0.003; ctx.setLineDash([W * 0.012, W * 0.008]);
  for (const c of activeCaptions(p, t)) { const b = captionBox(ctx, W, H, c, styleFor(p, ratio, c)); ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); }
  ctx.restore();
}

/** 인트로·엔딩 카드 글상자 테두리 (편집 화면에서만) */
function drawTcOutline(ctx: CanvasRenderingContext2D, W: number, H: number, b: CardLayoutResult, on: boolean, guides: { x?: number; y?: number }[]) {
  const pad = W * 0.012;
  ctx.save();
  ctx.strokeStyle = on ? 'rgba(127,178,255,0.95)' : 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1.5, W * 0.0022);
  ctx.setLineDash([W * 0.012, W * 0.008]);
  ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  ctx.setLineDash([]);
  if (on) {
    ctx.fillStyle = '#7fb2ff';
    const hw = W * 0.008, hh = Math.min(b.h * 0.5, W * 0.05);
    ctx.fillRect(b.x - pad - hw / 2, b.y + b.h / 2 - hh / 2, hw, hh);
    ctx.fillRect(b.x + b.w + pad - hw / 2, b.y + b.h / 2 - hh / 2, hw, hh);
    ctx.beginPath(); ctx.arc(b.x + b.w + pad, b.y + b.h + pad, W * 0.014, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(127,178,255,0.8)'; ctx.lineWidth = 1.5;
    for (const g of guides) { ctx.beginPath(); if (g.x !== undefined) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H); } else if (g.y !== undefined) { ctx.moveTo(0, g.y); ctx.lineTo(W, g.y); } ctx.stroke(); }
  }
  ctx.restore();
}
