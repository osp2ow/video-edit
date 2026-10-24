// 효과 탭: 장면 전환 · 시작/끝 · 화면 필터 · 로고 · 박자 효과
import { Fx, CardPage, CardStyle, cardStyleOf, TransType, Cut, ColorFilter, ZoomSeg, Punch, TRANS_LIST, MarkKind, MARK_KINDS, MARK_AMT, markKind } from './model';
import { FILTER_PRESETS } from './effects';
import { CAPTION_FONTS } from './CaptionStudio';
const useStateCS = React.useState;
import { faceStatus, onFaceStatus, ensureFace } from './face';

const TRANS = TRANS_LIST;

interface Props {
  fx: Fx;
  setFx: (patch: Partial<Fx>) => void;
  selCut: { cut: Cut; where: string } | null;
  setCutTr: (tr: Cut['tr'] | null) => void;
  onLogo: (f: File) => void;
  hasAudio: boolean;
  selFx: { kind: 'zoom' | 'punch'; id: string } | null;
  setSelFx: (s: { kind: 'zoom' | 'punch'; id: string } | null) => void;
  onAddZoom: () => void;
  onAddPunch: () => void;
  canAdd: boolean;
  selCard?: 'intro' | 'outro' | null;
  stampKind: MarkKind;
  setStampKind: (k: MarkKind) => void;
  outroDt?: () => number | null;   // 재생 위치가 엔딩 카드 안이면 카드 시작부터 몇 초인지
}

function Slider(p: { id: string; label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={p.id}>{p.label} <span className="mono dim">{p.fmt(p.value)}</span></label>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={e => p.onChange(parseFloat(e.target.value))} />
    </div>
  );
}

const sec = (v: number) => v ? `${v.toFixed(1)}초` : '끔';
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function FxPanel({ fx, setFx, selCut, setCutTr, onLogo, hasAudio, selFx, setSelFx, onAddZoom, onAddPunch, canAdd, stampKind, setStampKind, selCard, outroDt }: Props) {
  const selZoom = selFx?.kind === 'zoom' ? fx.zooms.find(z => z.id === selFx.id) : undefined;
  const selPunch = selFx?.kind === 'punch' ? fx.punches.find(z => z.id === selFx.id) : undefined;
  const upZoom = (patch: Partial<ZoomSeg>) => selZoom && setFx({ zooms: fx.zooms.map(z => z.id === selZoom.id ? { ...z, ...patch } : z) });
  const upPunch = (patch: Partial<Punch>) => selPunch && setFx({ punches: fx.punches.map(z => z.id === selPunch.id ? { ...z, ...patch } : z) });
  const [fst, setFst] = React.useState(faceStatus());
  React.useEffect(() => onFaceStatus(() => setFst(faceStatus())), []);
  const setFace = (patch: Partial<Fx['face']>) => { setFx({ face: { ...fx.face, ...patch } }); if (patch.on) ensureFace(); };
  const setFilter = (f: Partial<ColorFilter>) => setFx({ filter: { ...fx.filter, ...f }, preset: 'custom' });
  const filterOn = fx.filterOn !== false, zoomOn = fx.zoomOn !== false, marksOn = fx.marksOn !== false;
  const faceNote = fx.face.on ? (fst.status === 'loading' ? '준비 중…' : fst.status === 'error' ? (fst.reason === 'gl' ? '이 컴퓨터에서는 쓸 수 없어요 (그래픽 가속 꺼짐)' : '불러오지 못했어요 (인터넷 확인)') : fst.status === 'ready' ? (fst.count ? `얼굴 ${fst.count}명` : '얼굴 찾는 중') : '') : '';
  return (
    <>
      {/* 1) 인트로 · 엔딩 카드: 크게 고르는 두 칸 */}
      <section>
        <h2>인트로 · 엔딩 카드</h2>
        <div className="card-tiles">
          <CardTile id="intro-on" title="인트로 카드" desc="영상 처음에 제목" on={fx.intro.on} onChange={v => setFx({ intro: { ...fx.intro, on: v } })} />
          <CardTile id="outro-on" title="엔딩 카드" desc="영상 끝에 안내 문구" on={fx.outro.on} onChange={v => setFx({ outro: { ...fx.outro, on: v } })} />
        </div>
        {fx.intro.on && (
          <div className={`subbox ${selCard === 'intro' ? 'sel-card' : ''}`}>
            <span className="small sub-title">인트로 카드</span>
            <textarea id="intro-title" className="card-text title" rows={2} placeholder="제목 (예: Nord Live) · Enter로 줄 나누기" value={fx.intro.title} onChange={e => setFx({ intro: { ...fx.intro, title: e.target.value } })} aria-label="인트로 카드 제목" />
            <textarea id="intro-sub" className="card-text" rows={3} placeholder="부제 (예: Drum Cover · 오세혁) · Enter로 줄 나누기" value={fx.intro.sub} onChange={e => setFx({ intro: { ...fx.intro, sub: e.target.value } })} aria-label="인트로 카드 부제" />
            <p className="small dim">화면 가이드라인 안에 맞춰 길면 자동으로 줄이 바뀌고 글자가 작아져요</p>
            <CardStyleBox kind="intro" fx={fx} setFx={setFx} />
            <Slider id="intro-dur" label="길이 (타임라인 자막 줄에서도 조절)" value={fx.intro.dur} min={0.5} max={15} step={0.1} fmt={v => `${v.toFixed(1)}초`} onChange={v => setFx({ intro: { ...fx.intro, dur: v } })} />
          </div>
        )}
        {fx.outro.on && (
          <div className={`subbox ${selCard === 'outro' ? 'sel-card' : ''}`}>
            <span className="small sub-title">엔딩 카드</span>
            <OutroTemplates fx={fx} setFx={setFx} />
            {!!fx.outro.pages?.length && <span className="small dim">1번째 문구 · 처음부터</span>}
            <textarea id="outro-title" className="card-text title big" rows={5} placeholder="제목 (예: 주니퍼 실용음악학원) · Enter로 줄 나누기" value={fx.outro.title} onChange={e => setFx({ outro: { ...fx.outro, title: e.target.value } })} aria-label="엔딩 카드 제목" />
            <input id="outro-sub" type="text" className="card-sub-in" placeholder="계정명 (예: @juniper_music)" value={fx.outro.sub} onChange={e => setFx({ outro: { ...fx.outro, sub: e.target.value } })} aria-label="엔딩 카드 부제 (계정명)" />
            <p className="small dim">화면 가이드라인 안에 맞춰 길면 자동으로 줄이 바뀌고 글자가 작아져요</p>
            <OutroPages fx={fx} setFx={setFx} nowDt={outroDt} />
            <CardStyleBox kind="outro" fx={fx} setFx={setFx} />
            <Slider id="outro-dur" label="길이 (타임라인 자막 줄에서도 조절)" value={fx.outro.dur} min={0.5} max={Math.max(15, Math.ceil(fx.outro.dur))} step={0.1} fmt={v => `${v.toFixed(1)}초`} onChange={v => setFx({ outro: { ...fx.outro, dur: v } })} />
          </div>
        )}
      </section>

      {/* 2) 화면 필터 */}
      <section>
        <SecHead id="filter-on" title="화면 필터" on={filterOn} onChange={v => setFx({ filterOn: v })} />
        <div className={filterOn ? '' : 'sec-off'} aria-disabled={!filterOn}>
          <div className="chips">
            {Object.entries(FILTER_PRESETS).map(([k, v]) => <button key={k} type="button" className={fx.preset === k ? 'on' : ''} onClick={() => setFx({ preset: k, filter: { ...v.f } })}>{v.label}</button>)}
          </div>
          <Slider id="f-bri" label="밝기" value={fx.filter.brightness} min={0.6} max={1.5} step={0.01} fmt={pct} onChange={v => setFilter({ brightness: v })} />
          <Slider id="f-con" label="대비" value={fx.filter.contrast} min={0.6} max={1.6} step={0.01} fmt={pct} onChange={v => setFilter({ contrast: v })} />
          <Slider id="f-sat" label="채도" value={fx.filter.saturate} min={0} max={2} step={0.01} fmt={pct} onChange={v => setFilter({ saturate: v })} />
          <Slider id="f-vig" label="비네트 (가장자리 어둡게)" value={fx.vignette} min={0} max={1} step={0.01} fmt={v => v ? pct(v) : '끔'} onChange={v => setFx({ vignette: v })} />
        </div>
      </section>

      {/* 3) 얼굴 보정 */}
      <section>
        <SecHead id="face-on" title="얼굴 보정" note={faceNote} on={fx.face.on} onChange={v => setFace({ on: v })} />
        {fx.face.on && (
          <>
            <Slider id="face-smooth" label="피부 매끈하게" value={fx.face.smooth} min={0} max={1} step={0.01} fmt={pct} onChange={v => setFace({ smooth: v })} />
            <Slider id="face-bright" label="얼굴 밝게" value={fx.face.bright} min={0} max={1} step={0.01} fmt={pct} onChange={v => setFace({ bright: v })} />
            <Slider id="face-warm" label="혈색 (따뜻하게)" value={fx.face.warm} min={0} max={1} step={0.01} fmt={pct} onChange={v => setFace({ warm: v })} />
          </>
        )}
      </section>

      {/* 4) 서서히 확대 */}
      <section>
        <SecHead id="zoom-on" title="서서히 확대" note={`${fx.zooms.length}구간`} on={zoomOn} onChange={v => setFx({ zoomOn: v })} />
        <div className={zoomOn ? '' : 'sec-off'} aria-disabled={!zoomOn}>
          <button type="button" className="btn sm" disabled={!canAdd} onClick={onAddZoom} title="지금 위치부터 2마디">확대 구간 추가</button>
          {selZoom && (
            <div className="subbox">
              <span className="small">선택한 구간 · {selZoom.start.toFixed(1)}~{selZoom.end.toFixed(1)}초</span>
              <Slider id="z-from" label="시작 배율" value={selZoom.from} min={1} max={1.6} step={0.01} fmt={pct} onChange={v => upZoom({ from: v })} />
              <Slider id="z-to" label="끝 배율" value={selZoom.to} min={1} max={1.6} step={0.01} fmt={pct} onChange={v => upZoom({ to: v })} />
              <button type="button" className="link small danger" onClick={() => { setFx({ zooms: fx.zooms.filter(z => z.id !== selZoom.id) }); setSelFx(null); }}>구간 삭제</button>
            </div>
          )}
          {fx.kenBurns > 0 && !fx.zooms.length && (
            <button type="button" className="link small" onClick={() => setFx({ kenBurns: 0 })}>예전 전체 확대 설정 끄기 (+{Math.round(fx.kenBurns * 100)}%)</button>
          )}
        </div>
      </section>

      {/* 5) 박자 효과 */}
      <section>
        <SecHead id="marks-on" title="박자 효과" note={`${fx.punches.length}곳`} on={marksOn} onChange={v => setFx({ marksOn: v })} />
        <div className={marksOn ? '' : 'sec-off'} aria-disabled={!marksOn}>
          <div className="field">
            <label>직접 찍기</label>
            <div className="seg small mark-seg">
              {MARK_KINDS.map(([k, n, key, sh]) => (
                <button key={k} type="button" className={`mk-${k} ${stampKind === k ? 'on' : ''}`} onClick={() => setStampKind(k)} title={`${n} · 단축키 ${key}`}>
                  <span className="mk-dot" aria-hidden="true" />{sh}
                </button>
              ))}
            </div>
          </div>
          <div className="row tight">
            <button type="button" className="btn sm" disabled={!canAdd} onClick={onAddPunch} title="타임라인 효과 줄 더블클릭으로도 찍어요">지금 위치에 찍기</button>
            <span className="small dim">{MARK_KINDS.map(([k, , , sh]) => `${sh} ${fx.punches.filter(m => markKind(m) === k).length}`).join(' · ')}</span>
          </div>
          {selPunch && (() => {
            const k = markKind(selPunch), r = MARK_AMT[k];
            return (
              <div className="subbox">
                <span className="small">선택한 지점 · {selPunch.t.toFixed(2)}초</span>
                <div className="seg small mark-seg">
                  {MARK_KINDS.map(([kk, n, , sh]) => (
                    <button key={kk} type="button" title={n} className={`mk-${kk} ${k === kk ? 'on' : ''}`} onClick={() => upPunch({ kind: kk, amt: kk === k ? selPunch.amt : MARK_AMT[kk].def })}><span className="mk-dot" aria-hidden="true" />{sh}</button>
                  ))}
                </div>
                <Slider id="pu-amt" label="세기" value={Math.min(r.max, Math.max(r.min, selPunch.amt))} min={r.min} max={r.max} step={r.step}
                  fmt={v => k === 'punch' ? `+${Math.round(v * 100)}%` : `${Math.round((v - r.min) / (r.max - r.min) * 90 + 10)}`} onChange={v => upPunch({ amt: v })} />
                <button type="button" className="link small danger" onClick={() => { setFx({ punches: fx.punches.filter(z => z.id !== selPunch.id) }); setSelFx(null); }}>삭제</button>
              </div>
            );
          })()}
        </div>
      </section>

      <section>
        <h2>장면 전환</h2>
        <div className="chips">
          {TRANS.map(([k, n]) => <button key={k} type="button" className={fx.trType === k ? 'on' : ''} onClick={() => setFx({ trType: k })}>{n}</button>)}
        </div>
        {fx.trType !== 'cut' && <Slider id="tr-dur" label="전환 길이" value={fx.trDur} min={0.2} max={1.5} step={0.05} fmt={v => `${v.toFixed(2)}초`} onChange={v => setFx({ trDur: v })} />}
        {selCut && (
          <div className="subbox">
            <span className="small">선택한 전환점 · {selCut.where}</span>
            <div className="chips">
              <button type="button" className={!selCut.cut.tr ? 'on' : ''} onClick={() => setCutTr(null)}>기본</button>
              {TRANS.map(([k, n]) => <button key={k} type="button" className={selCut.cut.tr?.type === k ? 'on' : ''} onClick={() => setCutTr({ type: k, dur: selCut.cut.tr?.dur || fx.trDur })}>{n}</button>)}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>페이드 인 · 아웃</h2>
        <Slider id="fade-in" label="페이드 인" value={fx.fadeIn} min={0} max={3} step={0.1} fmt={sec} onChange={v => setFx({ fadeIn: v })} />
        <Slider id="fade-out" label="페이드 아웃" value={fx.fadeOut} min={0} max={3} step={0.1} fmt={sec} onChange={v => setFx({ fadeOut: v })} />
        <div className="row tight">
          <div className="seg small grow">
            <button type="button" className={fx.fadeColor === 'black' ? 'on' : ''} onClick={() => setFx({ fadeColor: 'black' })}>검정</button>
            <button type="button" className={fx.fadeColor === 'white' ? 'on' : ''} onClick={() => setFx({ fadeColor: 'white' })}>흰색</button>
          </div>
          <Toggle id="afade" label="소리도" on={fx.audioFade} onChange={v => setFx({ audioFade: v })} />
        </div>
      </section>

      <section>
        <h2>로고</h2>
        <div className="row tight">
          {fx.logo ? <img className="logo-thumb" src={fx.logo} alt="로고" /> : null}
          <label className="btn sm" htmlFor="logo-file">{fx.logo ? '바꾸기' : '로고 이미지 넣기'}</label>
          <input id="logo-file" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = ''; }} />
          {fx.logo && <button type="button" className="link small danger" onClick={() => setFx({ logo: null })}>빼기</button>}
        </div>
        {fx.logo && (
          <>
            <Toggle id="wm-on" label="워터마크로 계속 표시" on={fx.watermark.on} onChange={v => setFx({ watermark: { ...fx.watermark, on: v } })} />
            {fx.watermark.on && (
              <div className="subbox">
                <div className="seg small">
                  {([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']] as [Fx['watermark']['pos'], string][]).map(([k, n]) => (
                    <button key={k} type="button" className={fx.watermark.pos === k ? 'on' : ''} onClick={() => setFx({ watermark: { ...fx.watermark, pos: k } })}>{n}</button>
                  ))}
                </div>
                <Slider id="wm-size" label="크기" value={fx.watermark.size} min={0.06} max={0.35} step={0.01} fmt={pct} onChange={v => setFx({ watermark: { ...fx.watermark, size: v } })} />
                <Slider id="wm-op" label="불투명도" value={fx.watermark.opacity} min={0.2} max={1} step={0.01} fmt={pct} onChange={v => setFx({ watermark: { ...fx.watermark, opacity: v } })} />
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** 켜고 끄는 스위치 (앱 전체 같은 모양) */
function Toggle(p: { id: string; label?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input id={p.id} type="checkbox" role="switch" checked={p.on} onChange={e => p.onChange(e.target.checked)} />
      {p.label && <span>{p.label}</span>}
    </label>
  );
}
/** 효과 묶음 제목 + 오른쪽 켜기/끄기 스위치 */
function SecHead(p: { id: string; title: string; note?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="sec-head">
      <h2><label htmlFor={p.id}>{p.title}</label>{p.note ? <span className="dim small"> {p.note}</span> : null}</h2>
      <label className="switch"><input id={p.id} type="checkbox" role="switch" checked={p.on} onChange={e => p.onChange(e.target.checked)} aria-label={`${p.title} 켜기`} /></label>
    </div>
  );
}
/** 인트로·엔딩 카드 고르기: 큰 칸 전체를 눌러 켜고 끔 */
function CardTile(p: { id: string; title: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`card-tile ${p.on ? 'on' : ''}`} htmlFor={p.id} title={p.desc}>
      <span className="ct-title">{p.title}</span>
      <span className="ct-bot">
        <span className="switch"><input id={p.id} type="checkbox" role="switch" checked={p.on} onChange={e => p.onChange(e.target.checked)} /></span>
        <span className="ct-state">{p.on ? '켜짐' : '꺼짐'}</span>
      </span>
    </label>
  );
}


const CARD_COLORS = ['#ffffff', '#ffe14d', '#ff8a1f', '#ff5c7a', '#56c2b4', '#7fb2ff', '#111111'];
/** 인트로·엔딩 카드 글자 모양 (글꼴 · 굵기 · 크기 · 색 · 정렬 · 배경 어둡게) */
function CardStyleBox({ kind, fx, setFx }: { kind: 'intro' | 'outro'; fx: Fx; setFx: (patch: Partial<Fx>) => void }) {
  const [open, setOpen] = useStateCS(false);
  const [fontsOpen, setFontsOpen] = useStateCS(false);
  const c = fx[kind], st = cardStyleOf(c);
  const set = (patch: Partial<CardStyle>) => setFx({ [kind]: { ...c, style: { ...(c.style || {}), ...patch } } } as Partial<Fx>);
  const fontName = (CAPTION_FONTS.find(([f]) => f === st.font) || [st.font, st.font])[1];
  return (
    <div className="card-style">
      <button type="button" className={`link small cs-toggle ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)}>글자 모양 · 위치 {open ? '▴' : '▾'}</button>
      {open && (
        <div className="card-style-body">
          <button type="button" className={`font-pick ${fontsOpen ? 'open' : ''}`} aria-expanded={fontsOpen} onClick={() => setFontsOpen(o => !o)}>
            <span className="fp-name" style={{ fontFamily: `"${st.font}", sans-serif` }}>{fontName}</span><span className="fp-arr" aria-hidden="true">▾</span>
          </button>
          {fontsOpen && (
            <ul className="font-list" role="listbox" aria-label="글꼴">
              {CAPTION_FONTS.map(([f, n]) => (
                <li key={f}><button type="button" role="option" aria-selected={st.font === f} className={st.font === f ? 'on' : ''} style={{ fontFamily: `"${f}", sans-serif` }}
                  onClick={() => { set({ font: f }); setFontsOpen(false); (document as any).fonts?.load?.(`${st.weight} 40px "${f}"`, '가나다').catch(() => {}); }}>{n}</button></li>
              ))}
            </ul>
          )}
          <div className="row tight"><span className="small dim cs-lab">제목</span>
            <div className="seg small grow">
              {([[400, '보통'], [700, '굵게'], [900, '아주 굵게']] as [number, string][]).map(([w, n]) => <button key={w} type="button" className={st.weight === w ? 'on' : ''} onClick={() => set({ weight: w })}>{n}</button>)}
            </div>
          </div>
          <Slider id={`${kind}-ts`} label="제목 크기" value={st.size} min={0.4} max={2.5} step={0.05} fmt={v => `${Math.round(v * 100)}%`} onChange={v => set({ size: v })} />
          <div className="row tight"><span className="small dim cs-lab">부제</span>
            <div className="seg small grow">
              {([[400, '보통'], [500, '중간'], [700, '굵게']] as [number, string][]).map(([w, n]) => <button key={w} type="button" className={st.subWeight === w ? 'on' : ''} onClick={() => set({ subWeight: w })}>{n}</button>)}
            </div>
          </div>
          <Slider id={`${kind}-ss`} label="부제 크기" value={st.subSize} min={0.4} max={2.5} step={0.05} fmt={v => `${Math.round(v * 100)}%`} onChange={v => set({ subSize: v })} />
          <div className="row tight wrap"><span className="small dim cs-lab">제목 색</span>
            {CARD_COLORS.map(col => <button key={col} type="button" className={`swatch ${st.color === col ? 'on' : ''}`} style={{ background: col }} aria-label={col} onClick={() => set({ color: col })} />)}
            <input className="color-in" type="color" value={st.color} onChange={e => set({ color: e.target.value })} aria-label="제목 색 직접 고르기" />
          </div>
          <div className="row tight wrap"><span className="small dim cs-lab">부제 색</span>
            {CARD_COLORS.map(col => <button key={col} type="button" className={`swatch ${st.subColor === col ? 'on' : ''}`} style={{ background: col }} aria-label={col} onClick={() => set({ subColor: col })} />)}
            <input className="color-in" type="color" value={st.subColor} onChange={e => set({ subColor: e.target.value })} aria-label="부제 색 직접 고르기" />
          </div>
          <div className="seg small">
            {([['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] as [CardStyle['align'], string][]).map(([a, n]) => <button key={a} type="button" className={st.align === a ? 'on' : ''} onClick={() => set({ align: a })}>{n}</button>)}
          </div>
          <Slider id={`${kind}-dim`} label="뒤 영상 어둡게" value={st.dim} min={0} max={1} step={0.02} fmt={v => `${Math.round(v * 100)}%`} onChange={v => set({ dim: v })} />
          <p className="small dim">미리보기에서 글상자를 끌면 옮겨지고, 양옆을 끌면 폭이, 오른쪽 아래 모서리를 끌면 글자 크기가 바뀌어요. 더블클릭하면 글자를 고칠 수 있어요.</p>
          <button type="button" className="btn ghost xs" onClick={() => set({ x: 0.5, y: -1, w: 0 })}>위치·폭 처음대로</button>
        </div>
      )}
    </div>
  );
}


// ---------- 엔딩 카드 템플릿 ----------
interface OutroTpl { name: string; title: string; sub?: string; style?: any; builtin?: boolean }
const BUILTIN_OUTRO: OutroTpl[] = [
  { name: 'DM 악보 안내', title: '팔로우 + 댓글\n남겨주시면\n\nDM으로 악보\n발송해드립니다!', builtin: true },
];
/** 엔딩 카드 안에서 바뀌는 다음 문구들 (자막처럼 중간에 글자가 바뀜) */
function OutroPages({ fx, setFx, nowDt }: { fx: Fx; setFx: (patch: Partial<Fx>) => void; nowDt?: () => number | null }) {
  const o = fx.outro;
  const pages = [...(o.pages || [])].sort((a, b) => a.at - b.at);
  const setPage = (id: string, patch: Partial<CardPage>) => setFx({ outro: { ...o, pages: pages.map(p => p.id === id ? { ...p, ...patch } : p) } });
  const remove = (id: string) => setFx({ outro: { ...o, pages: pages.filter(p => p.id !== id) } });
  const add = () => {
    // 재생 위치가 엔딩 카드 안이면 그 자리부터, 아니면 마지막 문구 뒤 남은 시간의 가운데 (남은 시간이 짧으면 카드를 늘려서 뒤에)
    const dt = nowDt?.() ?? null, last = pages.length ? pages[pages.length - 1].at : 0;
    let at: number, dur = o.dur;
    if (dt !== null && dt > 0.3 && dt < dur - 0.3 && !pages.some(p => Math.abs(p.at - dt) < 0.3)) at = dt;
    else if (dur - last >= 2) at = last + (dur - last) / 2;
    else { at = dur; dur = dur + 2.5; }
    const id = 'pg' + Date.now().toString(36);
    setFx({ outro: { ...o, dur: Math.round(dur * 10) / 10, pages: [...pages, { id, at: Math.round(at * 10) / 10, title: '', sub: o.sub }] } });
    setTimeout(() => (document.getElementById(`outro-page-${id}-title`) as HTMLTextAreaElement | null)?.focus(), 60);
  };
  return (
    <div className="outro-pages">
      {pages.map((pg, i) => {
        const hidden = pg.at >= o.dur - 0.05;
        return (
          <div key={pg.id} className={`outro-page ${hidden ? 'off' : ''}`}>
            <div className="row between">
              <span className="small sub-title">{i + 2}번째 문구 · {pg.at.toFixed(1)}초부터{hidden ? ' (카드 길이 밖이라 안 보여요)' : ''}</span>
              <button type="button" className="btn ghost sm" onClick={() => remove(pg.id)} aria-label={`${i + 2}번째 문구 빼기`}>빼기</button>
            </div>
            <textarea id={`outro-page-${pg.id}-title`} className="card-text title" rows={3} placeholder="이 시점부터 보일 문구 · Enter로 줄 나누기" value={pg.title} onChange={e => setPage(pg.id, { title: e.target.value })} aria-label={`엔딩 카드 ${i + 2}번째 문구`} />
            <input id={`outro-page-${pg.id}-sub`} type="text" className="card-sub-in" placeholder="계정명 (비우면 안 보여요)" value={pg.sub} onChange={e => setPage(pg.id, { sub: e.target.value })} aria-label={`엔딩 카드 ${i + 2}번째 부제`} />
            <Slider id={`outro-page-${pg.id}-at`} label="바뀌는 시점 (카드 시작부터)" value={Math.min(pg.at, o.dur)} min={0.3} max={Math.max(0.4, o.dur - 0.3)} step={0.1} fmt={v => `${v.toFixed(1)}초`} onChange={v => setPage(pg.id, { at: v })} />
          </div>
        );
      })}
      <button type="button" className="btn sm" onClick={add}>+ 문구 추가 (카드 안에서 바뀜)</button>
      {pages.length > 0 && <p className="small dim">타임라인 자막 줄의 엔딩 카드에서 문구 사이 경계선을 끌어도 바뀌는 시점을 옮길 수 있어요</p>}
    </div>
  );
}

const TPL_KEY = 'pve.outroTpl';
const loadTpls = (): OutroTpl[] => { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch { return []; } };
const saveTpls = (l: OutroTpl[]) => { try { localStorage.setItem(TPL_KEY, JSON.stringify(l)); } catch { /* 저장 불가 */ } };

/** 엔딩 카드 문구 템플릿: 누르면 제목(과 저장해 둔 글자 모양)이 들어감 · 지금 내용을 새 템플릿으로 저장 */
function OutroTemplates({ fx, setFx }: { fx: Fx; setFx: (patch: Partial<Fx>) => void }) {
  const [mine, setMine] = useStateCS<OutroTpl[]>(loadTpls);
  const all = [...BUILTIN_OUTRO, ...mine];
  const apply = (t: OutroTpl) => setFx({ outro: { ...fx.outro, title: t.title, ...(t.sub !== undefined ? { sub: t.sub } : {}), ...(t.style ? { style: t.style } : {}) } });
  const saveNow = () => {
    const name = window.prompt('템플릿 이름', fx.outro.title.split('\n')[0].slice(0, 16) || '내 템플릿');
    if (!name) return;
    const next = [...mine.filter(t => t.name !== name), { name, title: fx.outro.title, sub: fx.outro.sub, style: fx.outro.style }];
    setMine(next); saveTpls(next);
  };
  const remove = (name: string) => { const next = mine.filter(t => t.name !== name); setMine(next); saveTpls(next); };
  return (
    <div className="outro-tpl">
      <span className="small dim">템플릿</span>
      <div className="chips">
        {all.map(t => (
          <span key={t.name} className="tpl-chip">
            <button type="button" className={fx.outro.title === t.title ? 'on' : ''} onClick={() => apply(t)} title={t.title.replace(/\n+/g, ' / ')}>{t.name}</button>
            {!t.builtin && <button type="button" className="tpl-x" onClick={() => remove(t.name)} aria-label={`${t.name} 템플릿 지우기`}>×</button>}
          </span>
        ))}
        <button type="button" className="tpl-add" onClick={saveNow} disabled={!fx.outro.title.trim()} title="지금 엔딩 카드 문구·글자 모양을 템플릿으로 저장">+ 지금 내용 저장</button>
      </div>
    </div>
  );
}
