// 기타 코드표 패널: 근음 → 코드 종류 → (넣은 코드표) 운지·크기
import { ROOTS, Root, QUALITIES, voicingsOf, chordName, parseChord, Voicing } from './chords';
import { paintChord, chordGeom } from './render';
import { Caption } from './model';

const { useRef, useEffect, useState } = React;

/** 작은 코드표 그림 (어두운 칸 위에 흰 코드표) */
function Thumb({ name, v, w = 132, h = 78 }: { name: string; v: Voicing | null; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 크기 1로 잰 그림을 칸에 꽉 차게 (배치는 크기에 비례)
    const g = chordGeom(w, h, { x: 0.5, y: 0.5, size: 1 }, v, name);
    paintChord(ctx, w, h, { x: 0.5, y: 0.5, size: Math.min(w * 0.92 / g.w, h * 0.86 / g.h) }, name, v);
  }, [name, v, w, h]);
  return <canvas ref={ref} className="chord-thumb" style={{ width: w, height: h }} aria-hidden="true" />;
}

interface Props {
  sel: Caption | null;                              // 고른 코드표 (자막 중 코드표인 것)
  count: number;                                    // 넣은 코드표 수
  size: number;                                     // 코드표 크기 (공통)
  onPlace: (name: string, v: number) => void;       // 재생 위치에 넣기 (그 자리에 코드표가 있으면 바꾸기)
  onVoicing: (v: number) => void;                   // 고른 코드표의 운지 바꾸기
  onSize: (s: number) => void;
  onResetPos: () => void;
  onDelete: () => void;
  onClose: () => void;
  disabled: boolean;
}

export function ChordPanel(p: Props) {
  const cur = p.sel?.chord ? parseChord(p.sel.chord.name) : null;
  const [root, setRoot] = useState<Root>(cur?.root || 'C');
  useEffect(() => { if (cur) setRoot(cur.root); }, [p.sel?.id, p.sel?.chord?.name]);
  const selVs = cur ? voicingsOf(cur.root, cur.q) : [];
  return (
    <aside id="chord-panel" className="cap-studio chord-panel" aria-label="코드표">
      <div className="row between">
        <h2>코드표 {p.count > 0 && <span className="dim small">{p.count}개</span>}</h2>
        <button type="button" className="btn ghost sm" onClick={p.onClose}>닫기</button>
      </div>
      <div className="chord-roots" role="tablist" aria-label="근음">
        {ROOTS.map(r => <button key={r} type="button" role="tab" aria-selected={root === r} className={root === r ? 'on' : ''} onClick={() => setRoot(r)}>{r}</button>)}
      </div>
      <div className="chord-grid">
        {QUALITIES.map(q => {
          const name = chordName(root, q.id), vs = voicingsOf(root, q.id), on = p.sel?.chord?.name === name;
          return (
            <button key={q.id} type="button" className={`chord-btn ${on ? 'on' : ''}`} disabled={p.disabled} onClick={() => p.onPlace(name, 0)} title={`${name} 넣기`}>
              <Thumb name={name} v={vs[0] || null} w={118} h={66} />
            </button>
          );
        })}
      </div>
      {p.sel?.chord && cur && (
        <div className="subbox">
          <span className="small sub-title">고른 코드표 · {p.sel.chord.name}</span>
          <span className="small dim">운지 고르기</span>
          <div className="chord-voicings">
            {selVs.map((v, i) => (
              <button key={i} type="button" className={`chord-btn ${(p.sel!.chord!.v || 0) === i ? 'on' : ''}`} onClick={() => p.onVoicing(i)} aria-label={`${i + 1}번째 운지`}>
                <Thumb name={p.sel!.chord!.name} v={v} w={118} h={66} />
              </button>
            ))}
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
      )}
    </aside>
  );
}
