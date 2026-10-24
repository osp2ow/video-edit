// 자막 스튜디오: 미리보기 왼쪽 — 자막 목록 · 내용 · 세부 스타일
import { Caption, CaptionStyle, CaptionAnim, fmtTime } from './model';
import { ownLook } from './render';

const { useRef, useEffect, useState } = React;

export const CAPTION_FONTS: [string, string][] = [
  ['Pretendard', '프리텐다드'], ['Gasoek One', '가석원'], ['Bagel Fat One', '베이글 팻 원'],
  ['Jalnan', '여기어때 잘난체'], ['SB Aggro', '어그로체'], ['Tmon Monsori', '티몬 몬소리'], ['ONE Mobile POP', '원스토어 POP'],
  ['Cafe24 Ssurround', '카페24 써라운드'], ['BM Hanna Pro', '한나체 Pro'], ['Maplestory Bold', '메이플스토리'], ['Tenada', '태나다체'],
  ['Yangjin', '양진체'], ['Vitro Core', '비트로 코어'], ['NEXON Football', '넥슨 풋볼고딕'], ['Recipekorea', '레코체'],
  ['IBM Plex Sans KR', '플렉스 산스'], ['Noto Sans KR', '노토 산스'], ['Gothic A1', '고딕 A1'], ['Nanum Gothic', '나눔고딕'],
  ['Black Han Sans', '검은고딕'], ['Do Hyeon', '도현'], ['Jua', '주아'], ['Sunflower', '해바라기'],
  ['Nanum Myeongjo', '나눔명조'], ['Noto Serif KR', '노토 세리프'], ['Gowun Batang', '고운바탕'], ['Song Myung', '송명'],
  ['Gowun Dodum', '고운돋움'], ['Nanum Pen Script', '나눔손글씨 펜'], ['Gaegu', '개구'], ['Dongle', '동글'],
];
const ANIMS: [CaptionAnim, string][] = [['none', '없음'], ['fade', '페이드'], ['pop', '팝'], ['up', '아래에서'], ['type', '타자']];
const COLORS = ['#ffffff', '#ffe14d', '#ff8a1f', '#ff5c7a', '#56c2b4', '#7fb2ff', '#111111'];

interface Props {
  captions: Caption[];
  sel: Caption | null;
  onSelect: (id: string | null) => void;
  onAdd: (text?: string) => void;
  onUpdate: (id: string, patch: Partial<Caption>) => void;
  onDelete: (id: string) => void;
  onSeek: (t: number) => void;
  now: () => number;
  style: CaptionStyle;              // 지금 편집 중인 스타일 (공통 또는 이 자막)
  scope: 'one' | 'all';             // 꾸미기(색·테두리·그림자·상자·위치·등장)를 이 자막만 / 모든 자막에
  setScope: (s: 'one' | 'all') => void;
  hasOwn: boolean;                  // 고른 자막에 자기 꾸미기가 있는지
  posScope: 'one' | 'all';          // 위치를 이 자막만 / 모든 자막에
  setPosScope: (s: 'one' | 'all') => void;
  hasOwnPos: boolean;               // 고른 자막에 자기 위치가 있는지
  onResetPos: () => void;
  onResetLook: () => void;
  setStyle: (patch: Partial<CaptionStyle>) => void;
  onClose: () => void;
  focusKey: number;
  disabled: boolean;
}

function Range(p: { id: string; label: string; v: number; min: number; max: number; step: number; fmt: (v: number) => string; on: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={p.id}>{p.label} <span className="mono dim">{p.fmt(p.v)}</span></label>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.v} onChange={e => p.on(parseFloat(e.target.value))} />
    </div>
  );
}

function Toggle(p: { id: string; label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="switch"><input id={p.id} type="checkbox" checked={p.on} onChange={e => p.set(e.target.checked)} /><span>{p.label}</span></label>;
}

export function CaptionStudio(p: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [fontsOpen, setFontsOpen] = useState(false);
  useEffect(() => { if (p.focusKey && ta.current) { ta.current.focus(); ta.current.select(); } }, [p.focusKey]);
  const fontName = (CAPTION_FONTS.find(([f]) => f === p.style.font) || [p.style.font, p.style.font])[1];
  const st = p.style, set = p.setStyle;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <aside id="cap-studio" className="cap-studio" aria-label="자막">
      <div className="cs-head">
        <h2>자막</h2>
        <button type="button" className="btn accent sm" onClick={() => p.onAdd()} disabled={p.disabled} title="지금 위치에 자막 추가 (Shift+C)">+ 추가</button>
        <button type="button" className="btn ghost sm" onClick={p.onClose} aria-label="자막 패널 접기" title="접기">▴</button>
      </div>

      <textarea id="cap-text" ref={ta} rows={3} className="cs-input" value={p.sel ? p.sel.text : ''} disabled={p.disabled}
        placeholder={p.sel ? '자막 내용' : '여기에 쓰면 지금 위치에 자막이 들어가요'}
        onChange={e => { const v = e.target.value; if (p.sel) p.onUpdate(p.sel.id, { text: v }); else if (v) p.onAdd(v); }}
        onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }} aria-label="자막 내용" />
      {p.sel && (
        <div className="cs-block">
          <div className="row tight">
            <button type="button" className="btn ghost xs" onClick={() => p.onUpdate(p.sel!.id, { start: Math.min(p.sel!.end - 0.2, p.now()) })} title="시작을 지금 위치로">시작 {fmtTime(p.sel.start)}</button>
            <button type="button" className="btn ghost xs" onClick={() => p.onUpdate(p.sel!.id, { end: Math.max(p.sel!.start + 0.2, p.now()) })} title="끝을 지금 위치로">끝 {fmtTime(p.sel.end)}</button>
            <button type="button" className="link small danger" onClick={() => p.onDelete(p.sel!.id)}>삭제</button>
          </div>
        </div>
      )}

      {p.captions.length > 0 && (
        <ul className="cap-list">
          {p.captions.map(c => (
            <li key={c.id}>
              <button type="button" className={c.id === p.sel?.id ? 'on' : ''} onClick={() => { p.onSelect(c.id); p.onSeek(c.start); }}>
                <span className="mono">{fmtTime(c.start).slice(0, 5)}</span><span className="cap-txt">{c.text.replace(/\n/g, ' ') || '(빈 자막)'}</span>
                {(ownLook(c) || c.pos) && <span className="own-dot" title="이 자막만의 꾸미기·위치" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="cs-group">
        <h3>글꼴 <span className="dim small">· 모든 자막 공통</span></h3>
        <button type="button" className={`font-pick ${fontsOpen ? 'open' : ''}`} aria-expanded={fontsOpen} aria-controls="font-grid" onClick={() => setFontsOpen(o => !o)}>
          <span className="fp-name" style={{ fontFamily: `"${st.font}", sans-serif` }}>{fontName}</span><span className="fp-arr" aria-hidden="true">▾</span>
        </button>
        {fontsOpen && (
          <div id="font-grid" className="font-grid">
            {CAPTION_FONTS.map(([f, n]) => (
              <button key={f} type="button" className={st.font === f ? 'on' : ''} style={{ fontFamily: `"${f}", sans-serif` }} onClick={() => { set({ font: f }); setFontsOpen(false); }}>
                <span className="fg-sample">가나다 Ab</span><span className="fg-name">{n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="seg small">
          {([[400, '보통'], [700, '굵게'], [900, '아주 굵게']] as [number, string][]).map(([w, n]) => (
            <button key={w} type="button" className={st.weight === w ? 'on' : ''} onClick={() => set({ weight: w })}>{n}</button>
          ))}
        </div>
        <Range id="cs-size" label="크기" v={st.size} min={0.025} max={0.14} step={0.001} fmt={v => String(Math.round(v * 1000))} on={v => set({ size: v })} />
        <Range id="cs-letter" label="자간" v={st.letter} min={-0.08} max={0.4} step={0.01} fmt={v => v.toFixed(2)} on={v => set({ letter: v })} />
        <Range id="cs-lineh" label="줄 간격" v={st.lineH} min={1} max={2} step={0.05} fmt={v => v.toFixed(2)} on={v => set({ lineH: v })} />
        <div className="seg small">
          {([['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] as [CaptionStyle['align'], string][]).map(([a, n]) => (
            <button key={a} type="button" className={st.align === a ? 'on' : ''} onClick={() => set({ align: a })}>{n}</button>
          ))}
        </div>
      </div>

      <div className="cs-group">
        <h3>위치 <span className="dim small">· {p.sel && p.posScope === 'one' ? '이 자막만 (미리보기에서 끌어도 이 자막만)' : '모든 자막 공통'}</span></h3>
        {p.sel && (
          <div className="seg small">
            <button type="button" id="cs-pos-one" className={p.posScope === 'one' ? 'on' : ''} onClick={() => p.setPosScope('one')}>이 자막만</button>
            <button type="button" id="cs-pos-all" className={p.posScope === 'all' ? 'on' : ''} onClick={() => p.setPosScope('all')}>모든 자막에</button>
          </div>
        )}
        <Range id="cs-x" label="가로" v={st.x} min={0.05} max={0.95} step={0.005} fmt={pct} on={v => set({ x: v })} />
        <Range id="cs-y" label="세로" v={st.y} min={0.03} max={0.97} step={0.005} fmt={pct} on={v => set({ y: v })} />
        <button type="button" className="btn ghost xs" onClick={() => set({ x: 0.5 })}>가로 가운데로</button>
        {p.sel && p.hasOwnPos && <button type="button" className="link small" onClick={p.onResetPos}>이 자막 위치를 공통으로 되돌리기</button>}
      </div>

      <div className="cs-group cs-scope">
        <h3>꾸미기 적용 <span className="dim small">· 색 · 테두리 · 그림자 · 상자 · 등장 효과</span></h3>
        {p.sel ? (
          <>
            <div className="seg small">
              <button type="button" className={p.scope === 'one' ? 'on' : ''} onClick={() => p.setScope('one')}>이 자막만</button>
              <button type="button" className={p.scope === 'all' ? 'on' : ''} onClick={() => p.setScope('all')}>모든 자막에</button>
            </div>
            {p.hasOwn && <button type="button" className="link small" onClick={p.onResetLook}>이 자막 꾸미기를 공통으로 되돌리기</button>}
          </>
        ) : <p className="small dim">자막을 고르지 않으면 새 자막과 꾸미기를 따로 안 한 자막에 쓰이는 기본 꾸미기를 바꿔요</p>}
      </div>

      <div className="cs-group">
        <h3>글자색</h3>
        <div className="row tight">
          {COLORS.map(c => <button key={c} type="button" className={`swatch ${st.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => set({ color: c })} />)}
          <input id="cs-color" className="color-in" type="color" value={st.color} onChange={e => set({ color: e.target.value })} aria-label="글자색 직접 고르기" />
        </div>
      </div>

      <div className="cs-group">
        <div className="row between"><h3>테두리</h3><Toggle id="cs-ol" label="" on={st.outline} set={v => set({ outline: v })} /></div>
        {st.outline && (
          <>
            <div className="row tight"><input id="cs-olc" className="color-in" type="color" value={st.outlineColor} onChange={e => set({ outlineColor: e.target.value })} aria-label="테두리 색" /><span className="small dim">색</span></div>
            <Range id="cs-olw" label="두께" v={st.outlineW} min={0.02} max={0.35} step={0.01} fmt={v => v.toFixed(2)} on={v => set({ outlineW: v })} />
          </>
        )}
        <div className="row between"><h3>그림자</h3><Toggle id="cs-sh" label="" on={st.shadow} set={v => set({ shadow: v })} /></div>
        {st.shadow && <Range id="cs-shb" label="흐림" v={st.shadowBlur} min={0} max={1} step={0.02} fmt={v => v.toFixed(2)} on={v => set({ shadowBlur: v })} />}
        <div className="row between"><h3>배경 상자</h3><Toggle id="cs-box" label="" on={st.box} set={v => set({ box: v })} /></div>
        {st.box && (
          <>
            <div className="row tight"><input id="cs-boxc" className="color-in" type="color" value={st.boxColor} onChange={e => set({ boxColor: e.target.value })} aria-label="상자 색" /><span className="small dim">색</span></div>
            <Range id="cs-boxo" label="불투명도" v={st.boxOpacity} min={0.1} max={1} step={0.01} fmt={pct} on={v => set({ boxOpacity: v })} />
            <Range id="cs-boxp" label="여백" v={st.boxPad} min={0.1} max={1.2} step={0.02} fmt={v => v.toFixed(2)} on={v => set({ boxPad: v })} />
            <Range id="cs-boxr" label="모서리" v={st.boxRadius} min={0} max={1} step={0.02} fmt={v => v.toFixed(2)} on={v => set({ boxRadius: v })} />
          </>
        )}
      </div>

      <div className="cs-group">
        <h3>등장 효과</h3>
        <div className="chips">
          {ANIMS.map(([a, n]) => <button key={a} type="button" className={st.anim === a ? 'on' : ''} onClick={() => set({ anim: a })}>{n}</button>)}
        </div>
      </div>
    </aside>
  );
}
