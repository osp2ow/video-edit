// 썸네일 만들기: 기준 영상 한 장면 + 제목 글자 → PNG
import { Project, Ratio, getFx, fmtTime, RATIO_ASCII, RATIOS, RATIO_LABEL, NEUTRAL_FILTER } from './model';
import { filterCss } from './effects';
import { retouchFaces } from './face';
import { saveBlob } from './exporter';
import { CAPTION_FONTS } from './CaptionStudio';

const { useState, useRef, useEffect } = React;

interface Props {
  cloud?: { getPref(k: string): Promise<any>; setPref(k: string, v: any): Promise<void> } | null;
  onClose: () => void;
  src: string;            // 기준 영상 주소
  time: number;           // 처음 고를 장면 (지금 위치)
  duration: number;
  project: Project;
  ratio: Ratio;
  videoName: string;
  projectTitle?: string;
}

const SIZE: Record<Ratio, [number, number]> = { '16:9': [1280, 720], '4:5': [1080, 1350], '9:16': [1080, 1920] };
const COLORS = ['#ffffff', '#ffe14d', '#ff8a1f', '#ff5c7a', '#56c2b4', '#111111'];
type Pos = 'top' | 'center' | 'bottom';
/** 썸네일이 실제로 보이는 곳 (글자는 이 안에만)
 *  릴스 9:16: 프로필 격자는 가운데 3:4만 보여서 위아래 12.5%씩 잘림 + 릴스 화면 위 UI(14%)·아래 계정명·캡션(20%)
 *  피드 4:5: 프로필 격자 3:4에서 좌우가 조금 잘림
 *  유튜브 16:9: 오른쪽 아래 영상 길이 표시 */
function thumbSafe(ratio: Ratio, W: number, H: number) {
  if (ratio === '9:16') return {
    l: W * 0.07, r: W * 0.93, t: H * 0.15, b: H * 0.79,
    cuts: [
      { x: 0, y: 0, w: W, h: H * 0.125, label: '프로필 격자에서 잘림' },
      { x: 0, y: H * 0.875, w: W, h: H * 0.125, label: '프로필 격자에서 잘림' },
      { x: 0, y: H * 0.125, w: W, h: H * 0.015, label: '' , soft: true },
      { x: 0, y: H * 0.80, w: W, h: H * 0.075, label: '릴스 계정명 · 캡션', soft: true },
    ],
  };
  if (ratio === '4:5') {
    const cut = (W - H * 0.75) / 2;
    return { l: cut + W * 0.05, r: W - cut - W * 0.05, t: H * 0.05, b: H * 0.95,
      cuts: [{ x: 0, y: 0, w: cut, h: H, label: '' }, { x: W - cut, y: 0, w: cut, h: H, label: '' }] };
  }
  return { l: W * 0.05, r: W * 0.95, t: H * 0.06, b: H * 0.86,
    cuts: [{ x: W * 0.84, y: H * 0.87, w: W * 0.14, h: H * 0.1, label: '영상 길이' }] };
}
const FACTORY = { sub: '', font: 'Pretendard', color: '#ffffff', size: 0.11, pos: 'bottom' as Pos, shade: true, tw: 700, sw: 700, ratio: null as Ratio | null, ratios: null as Ratio[] | null };
type Defaults = typeof FACTORY;
const DKEY = 'pve.thumbDefaults';
function loadDefaults(): Defaults {
  try { return { ...FACTORY, ...(JSON.parse(localStorage.getItem(DKEY) || '{}')) }; } catch { return { ...FACTORY }; }
}
const last = { title: '', ...loadDefaults() };
const WEIGHTS: [number, string][] = [[400, '보통'], [700, '굵게'], [900, '아주 굵게']];

export function ThumbDialog(p: Props) {
  // 여러 비율을 골라 한 번에 저장 (릴스 / 피드 / 유튜브)
  const [ratios, setRatiosS] = useState<Ratio[]>(last.ratios || [last.ratio || p.ratio]);
  const sel = RATIOS.filter(r => ratios.includes(r));
  const [focus, setFocus] = useState<Ratio>(sel[0]);
  const setRatios = (rs: Ratio[]) => { setRatiosS(rs); if (!rs.includes(focus)) setFocus(RATIOS.filter(r => rs.includes(r))[0]); };
  const toggleRatio = (r: Ratio) => {
    if (ratios.includes(r)) { if (ratios.length > 1) setRatios(ratios.filter(x => x !== r)); }
    else { setRatios([...ratios, r]); setFocus(r); }
  };
  const [t, setT] = useState(p.time);
  type View = { zoom: number; pan: { x: number; y: number } };   // 비율마다 따로: 확대 · 위치(-1..1)
  const [views, setViews] = useState<Record<Ratio, View>>(() => ({ '9:16': { zoom: 1, pan: { x: 0, y: 0 } }, '4:5': { zoom: 1, pan: { x: 0, y: 0 } }, '16:9': { zoom: 1, pan: { x: 0, y: 0 } } }));
  const setView = (r: Ratio, v: Partial<View>) => setViews(vs => ({ ...vs, [r]: { ...vs[r], ...v } }));
  const zoom = views[focus].zoom;
  const [title, setTitle] = useState(last.title);
  const [sub, setSub] = useState(last.sub);
  const [font, setFont] = useState(last.font);
  const [color, setColor] = useState(last.color);
  const [size, setSize] = useState(last.size);
  const [pos, setPos] = useState(last.pos);
  const [shade, setShade] = useState(last.shade);
  const [tw, setTw] = useState(last.tw);
  const [sw, setSw] = useState(last.sw);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const cvs = useRef<Partial<Record<Ratio, HTMLCanvasElement | null>>>({});
  const vid = useRef<HTMLVideoElement | null>(null);
  const [guide, setGuide] = useState(true);
  const savingRef = useRef(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === 'Escape' && !savingRef.current) { e.stopPropagation(); p.onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  const st = useRef({ sel, views, title, sub, font, color, size, pos, shade, tw, sw, guide });
  st.current = { sel, views, title, sub, font, color, size, pos, shade, tw, sw, guide };
  Object.assign(last, { title, sub, font, color, size, pos, shade, tw, sw, ratios: sel });
  const touched = useRef(false);
  const apply = (d: Defaults) => { setSub(d.sub); setFont(d.font); setColor(d.color); setSize(d.size); setPos(d.pos); setShade(d.shade); setTw(d.tw); setSw(d.sw); if (d.ratios?.length) setRatios(d.ratios); else if (d.ratio) setRatios([d.ratio]); };
  // 다른 PC에서 저장한 기본값이 있으면 불러오기 (아직 아무것도 안 바꿨을 때만)
  useEffect(() => {
    p.cloud?.getPref('thumbDefaults').then(v => {
      if (!v || touched.current) return;
      const d = { ...FACTORY, ...v }; try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch {}
      apply(d);
    }).catch(() => {});
  }, []);
  const saveDefaults = async () => {
    const d: Defaults = { sub, font, color, size, pos, shade, tw, sw, ratio: sel[0], ratios: sel };
    try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch {}
    try { await p.cloud?.setPref('thumbDefaults', d); } catch {}
    setMsg('지금 설정을 기본값으로 저장했어요. 다음에 썸네일을 열면 이 설정으로 시작해요.');
  };
  const resetDefaults = async () => {
    try { localStorage.removeItem(DKEY); } catch {}
    try { await p.cloud?.setPref('thumbDefaults', null); } catch {}
    apply(FACTORY); setRatios([p.ratio]);
    setMsg('처음 기본값으로 되돌렸어요.');
  };

  // 장면 고르기용 영상 (편집 화면 재생에는 영향 없음)
  useEffect(() => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = p.src;
    v.addEventListener('loadeddata', () => { v.currentTime = p.time; });
    vid.current = v;
    return () => { v.removeAttribute('src'); v.load(); };
  }, []);
  useEffect(() => { const v = vid.current; if (v && v.readyState >= 1) v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05)); }, [t]);
  useEffect(() => { for (const w of [tw, sw]) document.fonts?.load(`${w} 40px "${font}"`).catch(() => {}); }, [font, tw, sw]);
  useEffect(() => { if (fontsOpen) for (const [f, n] of CAPTION_FONTS) document.fonts?.load(`400 16px "${f}"`, n).catch(() => {}); }, [fontsOpen]);

  // 그리기
  useEffect(() => {
    let raf = 0;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const draw = () => { for (const r of st.current.sel) { const c = cvs.current[r]; if (c) drawTo(c, r); } };
  const drawTo = (c: HTMLCanvasElement, ratio: Ratio) => {
    const v = vid.current;
    const s = { ...st.current, ...st.current.views[ratio], ratio }, [W, H] = SIZE[ratio];
    if (c.width !== W) c.width = W; if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const fx = getFx(p.project);
    if (v && v.videoWidth) {
      const k = Math.max(W / v.videoWidth, H / v.videoHeight) * s.zoom;
      const dw = v.videoWidth * k, dh = v.videoHeight * k;
      const x = (W - dw) / 2 + s.pan.x * Math.max(0, dw - W) / 2, y = (H - dh) / 2 + s.pan.y * Math.max(0, dh - H) / 2;
      ctx.filter = filterCss(fx.filterOn === false ? NEUTRAL_FILTER : fx.filter); ctx.drawImage(v, x, y, dw, dh); ctx.filter = 'none';
      retouchFaces(ctx, W, H, fx.face);
    }
    if (s.shade && (s.title || s.sub)) {
      const g = s.pos === 'top' ? ctx.createLinearGradient(0, 0, 0, H * 0.55) : s.pos === 'bottom' ? ctx.createLinearGradient(0, H, 0, H * 0.45) : null;
      if (g) { g.addColorStop(0, 'rgba(0,0,0,0.72)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      else { ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fillRect(0, 0, W, H); }
    }
    const base = Math.min(W, H), S = thumbSafe(ratio, W, H), maxW = S.r - S.l, cx = (S.l + S.r) / 2;
    // 보이는 곳 폭에 맞춰 줄바꿈 → 그래도 넘치면(긴 단어 · 높이 초과) 글자를 줄임
    const wrap = (text: string, font: string) => {
      ctx.font = font; const out: string[] = [];
      for (const para of text.split('\n')) {
        let line = '';
        for (const w of para.split(/(\s+)/).filter(x => x.length)) {
          const tryL = line + w;
          if (line.trim() && ctx.measureText(tryL.trimEnd()).width > maxW) { out.push(line.trimEnd()); line = w.trimStart(); } else line = tryL;
        }
        out.push(line.trimEnd());
      }
      return out;
    };
    let kf = 1, fs = 0, fs2 = 0, lines: string[] = [], subs: string[] = [], lh = 0, total = 0;
    for (let i = 0; i < 16; i++) {
      fs = base * s.size * kf; fs2 = fs * 0.42; lh = fs * 1.12;
      lines = s.title ? wrap(s.title, `${s.tw} ${fs}px "${s.font}", sans-serif`).filter((l, j, a) => l || a.length === 1) : [];
      subs = s.sub ? wrap(s.sub, `${s.sw} ${fs2}px "${s.font}", sans-serif`) : [];
      total = lines.length * lh + subs.length * fs2 * 1.3 + (subs.length ? fs2 * 0.3 : 0);
      ctx.font = `${s.tw} ${fs}px "${s.font}", sans-serif`; const w1 = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
      ctx.font = `${s.sw} ${fs2}px "${s.font}", sans-serif`; const w2 = Math.max(0, ...subs.map(l => ctx.measureText(l).width));
      if (total <= S.b - S.t && w1 <= maxW + 0.5 && w2 <= maxW + 0.5) break;
      kf *= 0.92;
    }
    let y = s.pos === 'top' ? S.t : s.pos === 'center' ? (S.t + S.b - total) / 2 : S.b - total;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const dark = s.color === '#111111';
    if (s.title) {
      ctx.font = `${s.tw} ${fs}px "${s.font}", sans-serif`;
      for (const l of lines) {
        ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.12; ctx.strokeStyle = dark ? '#fff' : 'rgba(0,0,0,0.85)';
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = fs * 0.25; ctx.strokeText(l, cx, y);
        ctx.shadowBlur = 0; ctx.fillStyle = s.color; ctx.fillText(l, cx, y);
        y += lh;
      }
    }
    if (subs.length) {
      ctx.font = `${s.sw} ${fs2}px "${s.font}", sans-serif`;
      ctx.lineWidth = fs2 * 0.14; ctx.strokeStyle = dark ? '#fff' : 'rgba(0,0,0,0.8)';
      y += fs2 * 0.3;
      for (const l of subs) { ctx.strokeText(l, cx, y); ctx.fillStyle = dark ? '#111' : '#fff'; ctx.fillText(l, cx, y); y += fs2 * 1.3; }
    }
    // 잘리는 곳 표시 (편집할 때만 — 저장하는 그림에는 안 들어감)
    if (st.current.guide && !savingRef.current) {
      ctx.save();
      for (const z of S.cuts) {
        ctx.fillStyle = (z as any).soft ? 'rgba(255,90,60,0.16)' : 'rgba(255,60,40,0.30)'; ctx.fillRect(z.x, z.y, z.w, z.h);
        if (z.label) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `600 ${base * 0.028}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2); }
      }
      ctx.setLineDash([base * 0.015, base * 0.01]); ctx.strokeStyle = 'rgba(127,178,255,0.9)'; ctx.lineWidth = Math.max(2, base * 0.003);
      ctx.strokeRect(S.l, S.t, S.r - S.l, S.b - S.t);
      ctx.restore();
    }
  };

  // 미리보기를 끌어서 화면 위치 옮기기
  const drag = useRef<{ r: Ratio; x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const onDown = (r: Ratio) => (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); setFocus(r); drag.current = { r, x: e.clientX, y: e.clientY, pan: views[r].pan }; };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; if (!d) return;
    const rc = e.currentTarget.getBoundingClientRect();
    const k = 2.2 / Math.max(0.2, views[d.r].zoom - 0.95);
    setView(d.r, { pan: { x: Math.max(-1, Math.min(1, d.pan.x + (e.clientX - d.x) / rc.width * k)), y: Math.max(-1, Math.min(1, d.pan.y + (e.clientY - d.y) / rc.height * k)) } });
  };

  const save = async () => {
    savingRef.current = true;   // 저장할 그림에는 잘리는 곳 표시를 빼고 그림
    draw();
    const base = (p.projectTitle?.trim() || p.videoName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || '썸네일';
    const ab = base.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_|_$/g, '') || 'thumbnail';
    let n = 0;
    for (const r of sel) {
      const c = cvs.current[r]; if (!c) continue;
      savingRef.current = true; drawTo(c, r);
      const b = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
      savingRef.current = false;
      if (!b) continue;
      await saveBlob(b, `${base}_썸네일_${RATIO_LABEL[r]}.png`, `${ab}_thumb_${RATIO_ASCII[r]}.png`, true);
      n++;
      await new Promise(res => setTimeout(res, 350));   // 연속 다운로드 사이 잠깐 쉬기
    }
    savingRef.current = false;
    setMsg(n > 1 ? `썸네일 ${n}장을 저장했어요. 브라우저가 "여러 파일 다운로드"를 물으면 허용을 눌러주세요.` : '썸네일을 저장했어요. 다운로드 목록을 확인하세요.');
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="th-title">
      <div className="modal thumb-modal">
        <div className="modal-head">
          <h2 id="th-title">썸네일 만들기</h2>
          <button type="button" className="btn ghost sm" onClick={p.onClose}>닫기</button>
        </div>
        <div className="thumb-body">
          <div className="thumb-view">
            {sel.map(r => (
              <figure key={r} className={`thumb-item ${focus === r && sel.length > 1 ? 'focus' : ''}`}>
                <canvas ref={el => { cvs.current[r] = el; }} onPointerDown={onDown(r)} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} aria-label={`${RATIO_LABEL[r]} 썸네일 미리보기 (끌어서 위치 옮기기)`} />
                {sel.length > 1 && <figcaption>{r} {RATIO_LABEL[r]}</figcaption>}
              </figure>
            ))}
          </div>
          <div className="thumb-side" onClickCapture={() => { touched.current = true; }} onInputCapture={() => { touched.current = true; }}>
            <div className="field">
              <label>비율 <span className="dim small">여러 개 고르면 한 번에 저장</span></label>
              <div className="seg small">
                {RATIOS.map(r => (
                  <button key={r} type="button" aria-pressed={ratios.includes(r)} className={ratios.includes(r) ? 'on' : ''} onClick={() => toggleRatio(r)}>
                    {ratios.includes(r) && sel.length > 1 && <span className="ck" aria-hidden="true">✓</span>}{r} {RATIO_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="th-t">장면 <span className="mono dim">{fmtTime(t)}</span></label>
              <input id="th-t" type="range" min={0} max={Math.max(0.1, p.duration - 0.05)} step={0.04} value={t} onChange={e => setT(parseFloat(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="th-z">확대{sel.length > 1 ? ` · ${RATIO_LABEL[focus]}` : ''} <span className="mono dim">{Math.round(zoom * 100)}%</span></label>
              <input id="th-z" type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setView(focus, { zoom: parseFloat(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="th-title-in">제목 <span className="dim small">Shift+Enter 줄바꿈</span></label>
              <textarea id="th-title-in" rows={2} value={title} placeholder="예: Nord - Live" onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="th-sub">부제</label>
              <input id="th-sub" type="text" value={sub} placeholder="예: Drum Cover · 오세혁" onChange={e => setSub(e.target.value)} />
            </div>
            <div className="field">
              <label>글꼴</label>
              <button type="button" className={`font-pick ${fontsOpen ? 'open' : ''}`} aria-expanded={fontsOpen} onClick={() => setFontsOpen(o => !o)}>
                <span className="fp-name" style={{ fontFamily: `"${font}", sans-serif` }}>{(CAPTION_FONTS.find(([f]) => f === font) || [font, font])[1]}</span><span className="fp-arr" aria-hidden="true">▾</span>
              </button>
              {fontsOpen && (
                <ul className="font-list" role="listbox" aria-label="글꼴">
                  {CAPTION_FONTS.map(([f, n]) => (
                    <li key={f}>
                      <button type="button" role="option" aria-selected={font === f} className={font === f ? 'on' : ''} style={{ fontFamily: `"${f}", sans-serif` }} onClick={() => { setFont(f); setFontsOpen(false); }}>{n}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="field">
              <label>제목 굵기</label>
              <div className="seg small">{WEIGHTS.map(([w, n]) => <button key={w} type="button" className={tw === w ? 'on' : ''} onClick={() => setTw(w)}>{n}</button>)}</div>
            </div>
            <div className="field">
              <label>부제 굵기</label>
              <div className="seg small">{WEIGHTS.map(([w, n]) => <button key={w} type="button" className={sw === w ? 'on' : ''} onClick={() => setSw(w)}>{n}</button>)}</div>
            </div>
            <div className="field">
              <label>글자색</label>
              <div className="row tight">
                {COLORS.map(c => <button key={c} type="button" className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />)}
                <input className="color-in" type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="글자색 직접 고르기" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="th-size">글자 크기 <span className="mono dim">{Math.round(size * 1000)}</span></label>
              <input id="th-size" type="range" min={0.05} max={0.2} step={0.002} value={size} onChange={e => setSize(parseFloat(e.target.value))} />
            </div>
            <div className="field">
              <label>위치</label>
              <div className="seg small">
                {([['top', '위'], ['center', '가운데'], ['bottom', '아래']] as const).map(([k, n]) => <button key={k} type="button" className={pos === k ? 'on' : ''} onClick={() => setPos(k)}>{n}</button>)}
              </div>
            </div>
            <label className="switch"><input id="th-shade" type="checkbox" checked={shade} onChange={e => setShade(e.target.checked)} /><span>글자 뒤 어둡게</span></label>
            <label className="switch"><input id="th-guide" type="checkbox" checked={guide} onChange={e => setGuide(e.target.checked)} /><span>잘리는 곳 보기 <span className="dim small">(저장 그림엔 안 들어가요)</span></span></label>
            <button type="button" className="btn accent wide" onClick={save}>{sel.length > 1 ? `PNG ${sel.length}장 저장` : 'PNG 저장'}</button>
            <div className="row tight">
              <button type="button" className="btn sm" onClick={saveDefaults} title="제목을 뺀 지금 설정(비율·부제·글꼴·굵기·색·크기·위치)을 기본값으로">이 설정을 기본값으로</button>
              <button type="button" className="link small" onClick={resetDefaults}>처음 설정으로</button>
            </div>
            {msg && <p className="note">{msg}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
