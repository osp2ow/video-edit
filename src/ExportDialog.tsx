// MP4 추출 창
import { Project, Ratio, fmtTime, RATIOS, RATIO_LABEL, RATIO_ASCII, clipsOf, clipEnd } from './model';
import { ExportInput, ExportOptions, CodecPlan, exportMp4, pickCodecs, saveBlob, outSize, exportSupported } from './exporter';

const { useState, useRef, useEffect } = React;

type Phase = 'setup' | 'running' | 'done' | 'error';
type Range = 'all' | 'cycle' | 'sheet' | 'pick';
const last = { quality: 1080 as 1080 | 720, fps: 60 as 30 | 60, ratios: null as Ratio[] | null };   // 다시 열어도 고른 화질·프레임 유지

interface Props {
  onClose: () => void;
  getInput: (r: Ratio) => Promise<ExportInput>;
  setSilent: (on: boolean) => void;
  duration: number;
  project: Project;
  sheetRange: [number, number] | null;
  ratio: Ratio;
  setRatio: (r: Ratio) => void;
  videoName: string;
  projectTitle?: string;   // 저장 파일 이름 (없으면 영상 파일 이름)
  picked: [number, number] | null;       // 타임라인에서 고른 구간
  onPickStart: () => void;
}

export function ExportDialog(p: Props) {
  const [quality, setQualityS] = useState<1080 | 720>(last.quality);
  const [fps, setFpsS] = useState<30 | 60>(last.fps);
  const setQuality = (q: 1080 | 720) => { last.quality = q; setQualityS(q); };
  const setFps = (f: 30 | 60) => { last.fps = f; setFpsS(f); };
  const [range, setRange] = useState<Range>(p.picked ? 'pick' : (p.project.cycle?.on && p.project.cycle.end - p.project.cycle.start > 0.2) ? 'cycle' : 'all');
  // 여러 비율을 골라 한 번에 추출 (누른 순서대로)
  const [ratios, setRatiosS] = useState<Ratio[]>(last.ratios || [p.ratio]);
  const setRatios = (r: Ratio[]) => { last.ratios = r; setRatiosS(r); };
  const toggleRatio = (r: Ratio) => {
    if (ratios.includes(r)) { if (ratios.length > 1) setRatios(ratios.filter(x => x !== r)); }
    else { setRatios([...ratios, r]); p.setRatio(r); }
  };
  const order = RATIOS.filter(r => ratios.includes(r));
  const [cur, setCur] = useState<{ i: number; n: number; r: Ratio } | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<CodecPlan | null>(null);
  type Result = { ratio: Ratio; blob: Blob; name: string; ascii: string; secs: number; msg: string };
  const [results, setResults] = useState<Result[]>([]);
  const [saveMsg, setSaveMsg] = useState('');
  const abort = useRef<AbortController | null>(null);
  const t0 = useRef(0);
  const [, tick] = useState(0);

  // Esc로 닫기 (만드는 중에는 안 닫힘)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === 'Escape' && phase !== 'running') { e.stopPropagation(); p.onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(id);
  }, [phase]);

  const span = (): [number, number] => {
    const d = p.duration;
    if (range === 'sheet' && p.sheetRange) return [Math.max(0, p.sheetRange[0]), Math.min(d, p.sheetRange[1])];
    if (range === 'pick' && p.picked) return [Math.max(0, p.picked[0]), Math.min(d, p.picked[1])];
    const cy = p.project.cycle;
    if (range === 'cycle' && cy && cy.end > cy.start) return [Math.max(0, cy.start), Math.min(d, cy.end)];
    const cs = clipsOf(p.project, d);
    return cs.length ? [Math.max(0, Math.min(...cs.map(c => c.start))), Math.min(d, Math.max(...cs.map(clipEnd)))] : [0, d];
  };
  const [s0, s1] = span();
  const len = Math.max(0, s1 - s0);
  const base = (p.projectTitle?.trim() || p.videoName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || '연주영상';
  const fileName = (r: Ratio) => `${base}_${RATIO_LABEL[r]}_${quality}p.mp4`;
  const asciiBase = base.replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'performance';
  const asciiName = (r: Ratio) => `${asciiBase}_${RATIO_ASCII[r]}_${quality}p.mp4`;
  const sound = [!p.project.videoMuted && '영상 소리', !p.project.recMuted && '녹음본'].filter(Boolean).join(' + ') || '소리 없음';

  const start = async () => {
    if (!exportSupported()) { setError('이 브라우저는 영상 추출을 지원하지 않아요. PC용 크롬 최신 버전에서 열어주세요.'); setPhase('error'); return; }
    if (len < 0.2) { setError('추출할 구간이 너무 짧아요. 구간을 다시 골라주세요.'); setPhase('error'); return; }
    // 저장할 곳을 지금(버튼을 누른 순간) 정해두면, 끝났을 때 브라우저가 막지 않고 바로 저장됨
    // (몇 분 뒤 저절로 받는 다운로드는 크롬이 '여러 파일 자동 다운로드'로 막을 수 있어서)
    let saveFile: any = null, saveDir: any = null;
    const w = window as any;
    if (!w.claude?.use && !navigator.webdriver) {
      try {
        if (order.length === 1 && w.showSaveFilePicker) saveFile = await w.showSaveFilePicker({ suggestedName: fileName(order[0]), id: 'pve-export', types: [{ description: 'MP4 영상', accept: { 'video/mp4': ['.mp4'] } }] });
        else if (order.length > 1 && w.showDirectoryPicker) saveDir = await w.showDirectoryPicker({ id: 'pve-export', mode: 'readwrite' });
      } catch (e: any) {
        if (e?.name === 'AbortError') return;   // 저장 창에서 취소 = 추출 안 함
        saveFile = null; saveDir = null;         // 막힌 환경이면 예전처럼 다운로드
      }
    }
    const writeTo = async (h: any, blob: Blob) => { const wr = await h.createWritable(); await wr.write(blob); await wr.close(); };
    setPhase('running'); setProgress(0); setStage('준비 중'); setSaveMsg(''); setResults([]);
    abort.current = new AbortController();
    p.setSilent(true);
    const done: Result[] = [];
    try {
      for (let i = 0; i < order.length; i++) {
        const r = order[i];
        setCur({ i, n: order.length, r });
        const o: ExportOptions = { ratio: r, quality, fps, start: s0, end: s1 };
        const pl = await pickCodecs(o);
        if (!pl) throw new Error('이 PC에서 쓸 수 있는 영상 인코더를 찾지 못했어요. 화질을 720p로 낮춰보거나 크롬을 업데이트해 주세요.');
        setPlan(pl);
        t0.current = performance.now(); setProgress(0);
        const inp = await p.getInput(r);
        const blob = await exportMp4(inp, o, pl, (x, st) => { setProgress(x); setStage(st); }, abort.current.signal);
        const res: Result = { ratio: r, blob, name: fileName(r), ascii: asciiName(r), secs: (performance.now() - t0.current) / 1000, msg: '' };
        // 하나 끝날 때마다 바로 저장
        let sr: string;
        try {
          if (saveFile) { await writeTo(saveFile, blob); sr = 'saved'; }
          else if (saveDir) { await writeTo(await saveDir.getFileHandle(res.name, { create: true }), blob); sr = 'saved'; }
          else sr = await saveBlob(blob, res.name, res.ascii, true);
        } catch { sr = await saveBlob(blob, res.name, res.ascii, true); }
        res.msg = sr === 'declined' ? '저장 취소됨' : sr === 'saved' ? '저장함' : '다운로드함';
        done.push(res); setResults([...done]);
      }
      setPhase('done');
      setSaveMsg(saveFile || saveDir ? (done.length > 1 ? `${done.length}개 파일을 고른 폴더에 저장했어요.` : '고른 위치에 저장했어요.')
        : done.length > 1 ? `${done.length}개 파일을 다운로드했어요. 브라우저가 "여러 파일 다운로드"를 물으면 허용을 눌러주세요.` : '다운로드했어요. 브라우저의 다운로드 목록을 확인하세요.');
    } catch (e: any) {
      if (e?.name === 'AbortError') { if (done.length) { setPhase('done'); setSaveMsg('나머지는 취소했어요.'); } else setPhase('setup'); }
      else { setError(`추출 중 문제가 생겼어요: ${e?.message || e}`); setPhase('error'); }
    } finally {
      p.setSilent(false); setCur(null);
    }
  };


  const elapsed = (performance.now() - t0.current) / 1000;
  const eta = progress > 0.03 ? elapsed / progress - elapsed : null;
  const sizes = order.map(r => outSize({ ratio: r, quality }).join('×')).join(' · ');

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="ex-title">
      <div className="modal">
        <div className="modal-head">
          <h2 id="ex-title">MP4 추출</h2>
          {phase !== 'running' && <button type="button" className="btn ghost sm" onClick={p.onClose}>닫기</button>}
        </div>

        {phase === 'setup' && (
          <div className="modal-body">
            <div className="field">
              <label>화면 비율 <span className="dim small">여러 개 고르면 한 번에 추출</span></label>
              <div className="seg">
                {RATIOS.map(r => (
                  <button key={r} type="button" aria-pressed={ratios.includes(r)} className={ratios.includes(r) ? 'on' : ''} onClick={() => toggleRatio(r)}>
                    {ratios.includes(r) && order.length > 1 && <span className="ck" aria-hidden="true">✓</span>}{r}<small>{RATIO_LABEL[r]}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>화질</label>
                <div className="seg small">
                  <button type="button" className={quality === 1080 ? 'on' : ''} onClick={() => setQuality(1080)}>1080p</button>
                  <button type="button" className={quality === 720 ? 'on' : ''} onClick={() => setQuality(720)}>720p</button>
                </div>
              </div>
              <div className="field">
                <label>프레임</label>
                <div className="seg small">
                  <button type="button" className={fps === 30 ? 'on' : ''} onClick={() => setFps(30)}>30fps</button>
                  <button type="button" className={fps === 60 ? 'on' : ''} onClick={() => setFps(60)}>60fps</button>
                </div>
              </div>
            </div>
            <div className="field">
              <label>구간</label>
              <div className="seg small">
                <button type="button" className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>영상 전체</button>
                <button type="button" className={range === 'cycle' ? 'on' : ''} disabled={!(p.project.cycle && p.project.cycle.end - p.project.cycle.start > 0.2)} onClick={() => setRange('cycle')} title="타임라인 맨 위 숫자 줄을 드래그해서 만든 노란 구간">반복 구간</button>
                <button type="button" className={range === 'sheet' ? 'on' : ''} disabled={!p.sheetRange} onClick={() => setRange('sheet')}>악보 구간</button>
                <button type="button" className={range === 'pick' ? 'on' : ''} onClick={p.onPickStart} title="타임라인에서 구간 고르기">구간 지정</button>
              </div>
              {range === 'pick' && p.picked && <button type="button" className="link small" onClick={p.onPickStart}>타임라인에서 다시 고르기</button>}
              <p className="note mono">{fmtTime(s0)} ~ {fmtTime(s1)} · {len.toFixed(1)}초</p>
            </div>
            <dl className="summary">
              <div><dt>크기</dt><dd className="mono">{sizes}</dd></div>
              <div><dt>소리</dt><dd>{sound} <span className="dim">(메트로놈 제외)</span></dd></div>
              <div><dt>파일</dt><dd className="mono">{order.map(r => fileName(r)).join('\n')}</dd></div>
            </dl>
            <p className="note">약 {Math.ceil(len * order.length)}초 걸려요{order.length > 1 ? ` (${order.length}개를 차례로)` : ''} · 누르면 저장할 곳을 먼저 고르고, 끝나면 거기에 바로 저장돼요</p>
            <button type="button" className="btn accent wide" onClick={start} disabled={len < 0.2}>추출 시작</button>
          </div>
        )}

        {phase === 'running' && (
          <div className="modal-body">
            <p className="stage">{cur && cur.n > 1 ? `${RATIO_LABEL[cur.r]} (${cur.i + 1}/${cur.n}) · ` : ''}{stage}</p>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="note mono">{Math.round(progress * 100)}% · {elapsed.toFixed(0)}초 지남{eta !== null ? ` · 약 ${Math.ceil(eta)}초 남음` : ''}</p>
            {plan && !plan.standard && <p className="note warn-text">H.264를 지원하지 않는 브라우저라 VP9로 만들고 있어요 (인스타 업로드 불가)</p>}
            <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>취소</button>
          </div>
        )}

        {phase === 'done' && results.length > 0 && (
          <div className="modal-body">
            <p className="stage ok-text">추출 완료</p>
            <ul className="ex-results">
              {results.map(r => (
                <li key={r.ratio}>
                  <div><b>{r.ratio} {RATIO_LABEL[r.ratio]}</b><span className="mono dim small"> {(r.blob.size / 1048576).toFixed(1)}MB · {r.secs.toFixed(0)}초 · {r.msg}</span></div>
                </li>
              ))}
            </ul>
            <p className="note mono">{plan?.standard ? 'H.264 + AAC (인스타·유튜브 호환)' : 'VP9 + Opus'}</p>
            {saveMsg && <p className="note">{saveMsg}</p>}
            <button type="button" className="btn ghost" onClick={() => { setResults([]); setPhase('setup'); }}>다른 설정으로 다시 추출</button>
          </div>
        )}

        {phase === 'error' && (
          <div className="modal-body">
            <p className="note warn-text">{error}</p>
            <button type="button" className="btn" onClick={() => setPhase('setup')}>돌아가기</button>
          </div>
        )}
      </div>
    </div>
  );
}
