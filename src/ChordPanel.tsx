// 기타 코드표 패널 (직접 만들기): 새 코드표 → 코드 이름 쓰고 지판에 점 찍기 → 내 코드표에 저장해 두고 다시 쓰기
import { ChordData, chartOf, blankChord, editableOf, NONE, MUTE, OPEN_STR } from './chords';
import { paintChord, chordGeom } from './render';
import { Caption } from './model';

const { useRef, useEffect, useState } = React;

/** 작은 코드표 그림 (어두운 칸 위에 흰 코드표) */
function Thumb({ data, w = 118, h = 66 }: { data: ChordData; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(data);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = chartOf(data), g = chordGeom(w, h, { x: 0.5, y: 0.5, size: 1 }, v, data.name);
    paintChord(ctx, w, h, { x: 0.5, y: 0.5, size: Math.min(w * 0.92 / g.w, h * 0.86 / g.h) }, data.name, v);
  }, [key, w, h]);
  return <canvas ref={ref} className="chord-thumb" style={{ width: w, height: h }} aria-hidden="true" />;
}

/** 지판에 점 찍기: 칸을 누르면 그 줄 그 프렛에 점(다시 누르면 지움) · 줄 왼쪽 칸은 O → X → 표시 없음 */
function ChordEditor({ data, onChange }: { data: ChordData; onChange: (d: ChordData) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ s: number; f: number } | null>(null);   // f: 0 = 줄 왼쪽(X/O) 칸, 1 이상 = 표 칸 번호
  const W = 272, H = 168;
  const geom = () => {
    const v = chartOf(data)!, g0 = chordGeom(W, H, { x: 0.5, y: 0.5, size: 1 }, v, '');
    const size = Math.min(W * 0.94 / g0.w, H * 0.86 / g0.h);
    return { v, size, g: chordGeom(W, H, { x: 0.5, y: 0.5, size }, v, '') };
  };
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { v, size, g } = geom();
    // 마우스가 있는 칸을 옅게 표시 (어디에 점이 찍힐지)
    if (hover) {
      const rowGap = g.gh / 5, cell = g.gw / g.nFret, y = g.gy + (5 - hover.s) * rowGap;
      const x = hover.f === 0 ? g.gx - g.xoW * 0.55 : g.gx + (hover.f - 0.5) * cell;
      ctx.fillStyle = 'rgba(143,220,164,0.35)'; ctx.beginPath(); ctx.arc(x, y, rowGap * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    paintChord(ctx, W, H, { x: 0.5, y: 0.5, size }, '', v);
  }, [JSON.stringify(data), hover?.s, hover?.f]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
    const { g } = geom(), rowGap = g.gh / 5, cell = g.gw / g.nFret;
    const s = 5 - Math.round((y - g.gy) / rowGap);
    if (s < 0 || s > 5 || Math.abs(y - (g.gy + (5 - s) * rowGap)) > rowGap * 0.6) return null;
    if (x >= g.gx - g.xoW - rowGap * 0.3 && x < g.gx) return { s, f: 0 };
    if (x >= g.gx && x <= g.gx + g.gw) return { s, f: Math.min(g.nFret, Math.floor((x - g.gx) / cell) + 1) };
    return null;
  };
  const press = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const h = at(e); if (!h) return;
    const d = editableOf(data), f = d.frets!.slice(), base = d.base || 1;
    if (h.f === 0) f[h.s] = f[h.s] === OPEN_STR ? MUTE : f[h.s] === MUTE ? NONE : OPEN_STR;   // O → X → 표시 없음
    else { const fr = base + h.f - 1; f[h.s] = f[h.s] === fr ? NONE : fr; }                    // 같은 자리 다시 누르면 지움
    onChange({ ...d, frets: f });
  };
  return (
    <canvas ref={ref} className="chord-editor" style={{ width: W, height: H }} role="img" aria-label="지판: 칸을 눌러 점 찍기" title="칸을 누르면 점, 다시 누르면 지움 · 줄 왼쪽을 누르면 O → X → 없음"
      onPointerDown={press} onPointerMove={e => { const h = at(e); setHover(h && (h.s !== hover?.s || h.f !== hover?.f) ? h : h ? hover : null); }} onPointerLeave={() => setHover(null)} />
  );
}

interface Props {
  sel: Caption | null;                         // 고른 코드표
  count: number;                               // 넣은 코드표 수
  size: number;                                // 코드표 크기 (공통)
  lib: ChordData[];                            // 내 코드표 (저장해 둔 것)
  onNew: () => void;                           // 재생 위치에 빈 코드표
  onPlace: (d: ChordData) => void;             // 재생 위치에 이 코드표 (그 자리에 있으면 바꾸기)
  onChange: (d: ChordData) => void;            // 고른 코드표 고치기
  onSaveLib: (d: ChordData) => void;
  onRemoveLib: (i: number) => void;
  onSize: (s: number) => void;
  onResetPos: () => void;
  onDelete: () => void;
  onClose: () => void;
  disabled: boolean;
}

export function ChordPanel(p: Props) {
  const data = p.sel?.chord ? editableOf(p.sel.chord) : null;
  const set = (patch: Partial<ChordData>) => data && p.onChange({ ...data, ...patch });
  const saved = data ? p.lib.findIndex(x => JSON.stringify(editableOf(x)) === JSON.stringify(data)) : -1;
  return (
    <aside id="chord-panel" className="cap-studio chord-panel" aria-label="코드표">
      <div className="row between">
        <h2>코드표 {p.count > 0 && <span className="dim small">{p.count}개</span>}</h2>
        <button type="button" className="btn ghost sm" onClick={p.onClose}>닫기</button>
      </div>
      <button type="button" className="btn accent sm" disabled={p.disabled} onClick={p.onNew}>+ 새 코드표</button>
      {data ? (
        <div className="subbox">
          <div className="field">
            <label htmlFor="chord-name">코드 이름</label>
            <input id="chord-name" type="text" value={data.name} placeholder="예: C, Am7, G/B" maxLength={16} onChange={e => set({ name: e.target.value })} onKeyDown={e => e.stopPropagation()} />
          </div>
          <ChordEditor data={data} onChange={p.onChange} />
          <div className="row tight chord-opts">
            <span className="small">시작 프렛</span>
            <button type="button" className="btn ghost sm" aria-label="시작 프렛 내리기" disabled={(data.base || 1) <= 1} onClick={() => set({ base: Math.max(1, (data.base || 1) - 1) })}>−</button>
            <span id="chord-base" className="mono">{data.base || 1}</span>
            <button type="button" className="btn ghost sm" aria-label="시작 프렛 올리기" disabled={(data.base || 1) >= 15} onClick={() => set({ base: Math.min(15, (data.base || 1) + 1) })}>+</button>
            <span className="small dim">{(data.base || 1) > 1 ? `${data.base}fr로 표시` : '줄받침부터'}</span>
          </div>
          <div className="row tight chord-opts">
            <span className="small">칸 수</span>
            {[4, 5, 6].map(n => <button key={n} type="button" className={`btn sm ${(data.span || 4) === n ? 'accent' : 'ghost'}`} onClick={() => set({ span: n })}>{n}</button>)}
            <label className="row tight small" htmlFor="chord-barre"><input id="chord-barre" type="checkbox" checked={data.barre !== false} onChange={e => set({ barre: e.target.checked })} />바레로 이어 그리기</label>
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => set({ frets: blankChord().frets })}>점 모두 지우기</button>
            <button type="button" className="btn sm" disabled={!data.name.trim() || saved >= 0} onClick={() => p.onSaveLib(data)} title="다음에 눌러서 바로 넣을 수 있게 저장">{saved >= 0 ? '내 코드표에 있음' : '내 코드표에 저장'}</button>
          </div>
          <div className="field">
            <label htmlFor="chord-size">크기 (모든 코드표) <span className="mono dim">{Math.round(p.size * 100)}%</span></label>
            <input id="chord-size" type="range" min="0.4" max="2" step="0.01" value={p.size} onChange={e => p.onSize(parseFloat(e.target.value))} />
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={p.onResetPos}>위치·크기 처음대로</button>
            <button type="button" className="btn ghost sm danger" onClick={p.onDelete}>이 코드표 지우기</button>
          </div>
        </div>
      ) : null}
      <div className="sec-lib">
        <span className="small sub-title">내 코드표 {p.lib.length > 0 && <span className="dim">{p.lib.length}개</span>}</span>
        {p.lib.length ? (
          <div className="chord-grid">
            {p.lib.map((d, i) => (
              <div key={i} className="chord-lib-item">
                <button type="button" className="chord-btn" disabled={p.disabled} onClick={() => p.onPlace(d)} title={`${d.name} 넣기`}><Thumb data={d} /></button>
                <button type="button" className="chord-lib-del" onClick={() => p.onRemoveLib(i)} aria-label={`${d.name} 내 코드표에서 빼기`}>×</button>
              </div>
            ))}
          </div>
        ) : <p className="small dim">저장한 코드표가 없어요</p>}
      </div>
    </aside>
  );
}
