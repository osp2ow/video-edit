import { shiftProject, recKey, recKeyOf, MAIN_REC, RecClip, trimOf, bpmAt, mainShift, recAtOf, sheetClipsOf, sheetClipEnd, sheetHome, SheetClip, clipEnd, barAt, Project, Ratio, CardLayout, Cut, CutSnap, MAIN, defaultProject, defaultLayouts, barBeat, barStart, barLen, beatLen, fmtTime, angleAt, setCutAt, snapTime, normalizeCuts, sheetStart, sheetEnd, sheetIndex, barOfSheet, VideoXf, getXf, withXf, defaultXf, Caption, CaptionStyle, Fx, getFx, LAYOUT_LABEL, clipsOf, timelineEnd, Clip, RATIOS, RATIO_LABEL, MarkKind, Punch, MARK_AMT, cardSpan, FIRST_PAGE } from './model';
import { captionStyleOf, styleFor, CAP_SHARED, ownLook, ownPos } from './render';
import { CaptionStudio } from './CaptionStudio';
import { Angle, ANGLE_COLORS, makeAngleVideo, followMaster, activeSource } from './angles';
import { fixEditList } from './movfix';
import { decodeVideoAudio } from './audiofile';
import { estimateTempoRange } from './analysis';
import { Track, decodeMono, analyzeTrack, estimateTempo, syncOffset, firstStrongBeat, downbeatShift, refinePhase, kickGrid } from './analysis';
import { SheetData, fileToPages, detectSheet, leadingRests, stitchImages } from './sheet';
import { Player } from './player';
import { Preview } from './Preview';
import { Timeline, BpmBox } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { ThumbDialog } from './ThumbDialog';
import { Transport } from './transport';
import { computeColorMatch } from './colormatch';
import { FxPanel } from './FxPanel';
import { Cloud, CloudStatus, CloudUser, ProjectDoc, TemplateDoc, FileRef, ProjectFiles, refsOf, initCloud, EDIT_SESSION } from './cloud';
import { LoginScreen, ProjectsPanel, NeededFiles } from './CloudUI';

const cloud: Cloud | null = initCloud();

/** 클라우드(Firebase)가 설정돼 있으면 로그인부터, 아니면 바로 편집기 */
export function Root() {
  const [st, setSt] = useState<{ status: CloudStatus; user: CloudUser | null }>({ status: 'loading', user: null });
  useEffect(() => cloud ? cloud.onAuth((user, status) => setSt({ user, status })) : undefined, []);
  if (!cloud) return <App cloud={null} user={null} admin={false} />;
  if (st.status === 'member' || st.status === 'admin') return <App cloud={cloud} user={st.user} admin={st.status === 'admin'} />;
  return <LoginScreen cloud={cloud} status={st.status} user={st.user} />;
}

interface Want { videoName: string; recName: string; sheetName: string; angleNames: string[]; sourceNames?: string[]; sheetNames?: string[]; recNames?: string[] }
/** 두 번째부터 넣은 녹음본 */
interface XRec { id: string; track: Track | null; dur: number; file: File }
/** 이어 붙이는 영상 하나 */
interface VSource { id: string; name: string; video: HTMLVideoElement; track: Track | null; dur: number; file: File }

const { useState, useEffect, useRef, useMemo } = React;

// ---------- 저장 (이 브라우저에만) ----------
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } },
  getArr<T>(k: string): T[] { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : []; } catch { return []; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
interface Template { name: string; layouts: Record<Ratio, CardLayout> }
/** 비율별 악보 카드 배치 (4:5는 처음엔 9:16 크기를 이어받고 위쪽에) */
function layoutFor(ls: Partial<Record<Ratio, CardLayout>>, r: Ratio): CardLayout {
  if (ls[r]) return ls[r]!;
  const d = defaultLayouts()[r];
  if (r === '4:5' && ls['9:16']) { const s = ls['9:16']!; return { ...d, opacity: s.opacity, lines: s.lines }; }
  return d;
}

type Msg = { kind: 'info' | 'ok' | 'warn' | 'busy'; text: string } | null;

export function App({ cloud, user, admin }: { cloud: Cloud | null; user: CloudUser | null; admin: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [project, setProjectState] = useState<Project>(defaultProject());
  const projRef = useRef(project);
  projRef.current = project;
  // 자동 분석이 채우는 값 (되돌리기 기록 안 함)
  const setProjectAuto = (patch: Partial<Project>) => setProjectState(p => ({ ...p, ...patch }));
  // 사용자가 바꾸는 값 (Ctrl+Z로 되돌릴 수 있음)
  const setProject = (patch: Partial<Project>) => { record(); setProjectState(p => ({ ...p, ...patch })); };

  const [layouts, setLayouts] = useState<Record<Ratio, CardLayout>>(() => store.get('pve.layouts', defaultLayouts()));
  // ---------- 되돌리기 기록 ----------
  type Snap = { project: Project; layouts: Record<Ratio, CardLayout> };
  const hist = useRef<{ past: Snap[]; future: Snap[]; last: number; brk?: boolean }>({ past: [], future: [], last: 0 });
  // 되돌리기 단위 = 한 번의 동작: 마우스를 새로 누르거나 (글자 입력이 아닌) 키를 누르면 새 단위로 끊음
  // (끄는 동안·글자 치는 동안의 연속 변경은 한 번으로 묶이고, 빠르게 이어 한 다른 작업이 한꺼번에 되돌려지지 않게)
  useEffect(() => {
    const brk = (e: Event) => {
      if (e.type === 'keydown') {
        const el = e.target as HTMLElement, k = e as KeyboardEvent;
        if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
        if ((k.ctrlKey || k.metaKey) && (k.code === 'KeyZ' || k.code === 'KeyY')) return;
      }
      hist.current.brk = true;
    };
    window.addEventListener('pointerdown', brk, true); window.addEventListener('keydown', brk, true);
    return () => { window.removeEventListener('pointerdown', brk, true); window.removeEventListener('keydown', brk, true); };
  }, []);
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const [histVer, setHistVer] = useState(0);
  /** 바뀌기 직전 상태를 저장. 0.6초 안에 이어지는 변경(드래그 등)은 한 번으로 묶는다 */
  function record() {
    const h = hist.current, now = performance.now();
    if (h.brk || now - h.last > 600) {
      h.brk = false;
      h.past.push({ project: projRef.current, layouts: layoutsRef.current });
      if (h.past.length > 200) h.past.shift();
    }
    h.last = now; h.future = [];
    setHistVer(v => v + 1);
  }
  const undo = () => {
    const h = hist.current;
    const s = h.past.pop();
    if (!s) { setMsg({ kind: 'info', text: '더 되돌릴 작업이 없어요.' }); return; }
    h.future.push({ project: projRef.current, layouts: layoutsRef.current });
    h.last = 0;
    setProjectState(s.project); setLayouts(s.layouts);
    setHistVer(v => v + 1);
    setMsg({ kind: 'info', text: '되돌렸어요 (다시 실행: Ctrl+Shift+Z)' });
  };
  const redo = () => {
    const h = hist.current;
    const s = h.future.pop();
    if (!s) return;
    h.past.push({ project: projRef.current, layouts: layoutsRef.current });
    h.last = 0;
    setProjectState(s.project); setLayouts(s.layouts);
    setHistVer(v => v + 1);
    setMsg({ kind: 'info', text: '다시 실행했어요' });
  };
  const resetHistory = () => { hist.current = { past: [], future: [], last: 0 }; setHistVer(v => v + 1); };

  const [ratio, setRatio] = useState<Ratio>(() => (store.get('pve.ui', { ratio: '9:16' as Ratio }).ratio));
  const [showSafe, setShowSafe] = useState(true);
  const [templates, setTemplates] = useState<Template[]>(() => store.getArr<Template>('pve.templates'));
  const [tplName, setTplName] = useState('');

  const [videoName, setVideoName] = useState('');
  const [recName, setRecName] = useState('');
  const [hasVideo, setHasVideo] = useState(false);
  const [duration, setDuration] = useState(0);
  const [vTrack, setVTrack] = useState<Track | null>(null);
  const [rTrack, setRTrack] = useState<Track | null>(null);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  // 두 번째부터 넣은 악보들 (악보 조각의 sheet 이름으로 고름)
  const [extraSheets, setExtraSheets] = useState<SheetData[]>([]);
  const [extraRecs, setExtraRecs] = useState<XRec[]>([]);
  const xrecRef = useRef<XRec[]>([]);
  xrecRef.current = extraRecs;
  const extraRef = useRef<SheetData[]>([]);
  extraRef.current = extraSheets;
  const sheetMap = useMemo(() => new Map(extraSheets.map(x => [x.name, x] as [string, SheetData])), [extraSheets]);
  const sheetNames = [...(sheet ? [sheet.name] : []), ...extraSheets.map(x => x.name)];
  const nBarsOf = (name?: string) => !name || name === sheet?.name ? (sheet?.bars.length || 0) : (extraRef.current.find(x => x.name === name)?.bars.length || 0);
  // 이어 붙이는 영상들 (첫 영상 = 기준 <video>, 나머지는 여기) — 타임라인 '영상' 줄에서 조각으로 자유롭게 편집
  const [sources, setSources] = useState<VSource[]>([]);
  const srcMap = useMemo(() => new Map(sources.map(x => [x.id, x.video] as [string, HTMLVideoElement])), [sources.map(x => x.id).join('|')]);
  const sourcesRef = useRef<VSource[]>([]);
  sourcesRef.current = sources;
  const elsMap = () => { const m = new Map<string, HTMLVideoElement>(); if (videoRef.current) m.set(MAIN, videoRef.current); for (const x of sourcesRef.current) m.set(x.id, x.video); return m; };
  const masterDur = () => videoRef.current?.duration || 0;
  /** 그 영상 파일 길이 (src 없으면 첫 영상) */
  const srcDurOf = (src?: string) => !src ? masterDur() : (sourcesRef.current.find(x => x.id === src)?.dur || 0);
  const recAtNow = () => recAtOf(projRef.current, masterDur());
  const endRef = useRef(0);
  const [sheetPages, setSheetPages] = useState(0);
  const [bpmText, setBpmText] = useState<string | null>(null);   // 템포 칸을 다 지우고 새로 쓸 수 있게 (입력 중인 글자)
  const [tempoInfo, setTempoInfo] = useState<{ bpm: number; suggested: number } | null>(null);
  const [syncInfo, setSyncInfo] = useState<{ offset: number; confidence: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [playing, setPlaying] = useState(false);
  const transportRef = useRef<Transport | null>(null);
  const tnow = () => transportRef.current?.time() ?? 0;   // 타임라인 시간
  const [capScope, setCapScope] = useState<'one' | 'all'>('one');   // 자막 꾸미기 적용 범위 (기본: 이 자막만)
  const [posScope, setPosScope] = useState<'one' | 'all'>('one');   // 자막 위치 적용 범위 (기본: 이 자막만)
  const [now, setNow] = useState(0);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [thumbOpen, setThumbOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fsOn, setFsOn] = useState(false);
  useEffect(() => {
    const on = () => setFsOn(document.fullscreenElement === stageRef.current && !!stageRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else stageRef.current?.requestFullscreen?.().catch(() => setMsg({ kind: 'warn', text: '이 화면에서는 전체화면을 쓸 수 없어요.' })); };
  const [cmBusy, setCmBusy] = useState(false);
  const [pickRange, setPickRange] = useState<{ a: number | null; b: number | null } | null>(null);  // 추출 구간 고르는 중
  const [exportRange, setExportRange] = useState<[number, number] | null>(null);
  const [selCard, setSelCard] = useState<'intro' | 'outro' | null>(null);
  const [cropMode, setCropMode] = useState(false);
  // 타임라인에서 고른 트랙: 'program'(결과물) | 'main' | 앵글 id | 'rec'
  const [selTrack, setSelTrack] = useState('program');
  const [selClipSrc, setSelClipSrc] = useState<string | null>(null);
  const [levelGrid, setLevelGrid] = useState(false);   // 회전 슬라이더를 만지는 동안 미리보기에 수평 격자   // 타임라인에서 고른 영상 조각의 파일 (MAIN = 첫 영상)
  const [inOut, setInOut] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [selCaption, setSelCaption] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [capFocus, setCapFocus] = useState(0);
  // ---------- 클라우드 프로젝트 ----------
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [cloudTemplates, setCloudTemplates] = useState<TemplateDoc[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [currentId, setCurrentIdState] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);
  const setCurrentId = (id: string | null) => { currentRef.current = id; setCurrentIdState(id); };
  const [title, setTitle] = useState('');
  const [want, setWantState] = useState<Want | null>(null);
  const wantRef = useRef<Want | null>(null);
  /** 저장된 프로젝트를 다시 열었을 때: 템포·싱크·마디 위치를 자동으로 다시 계산하지 않고 저장된 값 그대로 씀
   *  (다시 계산하면 옮겨 둔 클립 기준으로 마디 눈금이 같이 움직여서, 옮긴 위치가 저장 안 된 것처럼 보임) */
  const autoLock = useRef<{ bpm: number; bpb: number } | null>(null);
  const lockAuto = (p: Project) => { autoLock.current = { bpm: p.bpm, bpb: p.beatsPerBar }; };
  const unlockAuto = () => { autoLock.current = null; };
  const setWant = (w: Want | null) => { wantRef.current = w; setWantState(w); };
  const [saveState, setSaveState] = useState<{ s: 'idle' | 'saving' | 'saved' | 'error'; at: number }>({ s: 'idle', at: 0 });
  const lastSaved = useRef('');
  // ---------- 클라우드 파일 ----------
  const filesRef = useRef<ProjectFiles>({});
  const projectsRef = useRef<ProjectDoc[]>([]);
  const fromCloud = useRef(new WeakSet<File>());
  const [transfer, setTransfer] = useState<{ kind: 'up' | 'down'; name: string; pct: number } | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const openToken = useRef(0);
  const pending = useRef(new Map<string, File>()); // 프로젝트가 생기기 전에 넣은 파일
  const queue = (job: () => Promise<void>) => {
    chain.current = chain.current.then(job).catch((e: any) => {
      setTransfer(null);
      setMsg({ kind: 'warn', text: `클라우드 파일 작업 실패: ${e?.code || e?.message || e}` });
    });
  };
  /** 다른 프로젝트가 이 파일을 쓰지 않으면 true */
  const isOrphan = (path: string, exceptId: string) =>
    !projectsRef.current.some(d => d.id !== exceptId && refsOf(d.files).some(r => r.path === path));

  /** 파일을 넣으면 클라우드에 올리고 프로젝트에 연결 (같은 파일이 이미 있으면 올리지 않음) */
  const cloudUpload = (role: string, file: File) => {
    if (!cloud?.storage || !user || fromCloud.current.has(file)) return;
    if (!currentRef.current && !creating.current) { pending.current.set(role, file); return; }
    queue(async () => {
      let id = currentRef.current;
      if (!id && creating.current) id = await creating.current.catch(() => null);
      if (!id) { pending.current.set(role, file); return; }
      setTransfer({ kind: 'up', name: file.name, pct: 0 });
      try {
        const ref = await cloud.uploadFile(file, pct => setTransfer({ kind: 'up', name: file.name, pct }));
        if (currentRef.current !== id) return;
        const cur = filesRef.current;
        let old: FileRef | undefined, next: ProjectFiles;
        if (role.startsWith('angle:')) { const aid = role.slice(6); old = cur.angles?.[aid]; next = { ...cur, angles: { ...(cur.angles || {}), [aid]: ref } }; }
        else if (role.startsWith('source:')) { const sid = role.slice(7); old = cur.sources?.[sid]; next = { ...cur, sources: { ...(cur.sources || {}), [sid]: ref } }; }
        else if (role.startsWith('recx:')) { const sid = role.slice(5); old = cur.recs?.[sid]; next = { ...cur, recs: { ...(cur.recs || {}), [sid]: ref } }; }
        else if (role.startsWith('sheetx:')) { const sid = role.slice(7); old = cur.sheets?.[sid]; next = { ...cur, sheets: { ...(cur.sheets || {}), [sid]: ref } }; }
        else { old = (cur as any)[role]; next = { ...cur, [role]: ref }; }
        filesRef.current = next;
        await cloud.setFiles(id, next);
        if (old && old.path !== ref.path && !refsOf(next).some(r => r.path === old!.path) && isOrphan(old.path, id)) cloud.deleteFile(old.path).catch(() => {});
      } finally { setTransfer(null); }
    });
  };
  const creating = useRef<Promise<string> | null>(null);
  const masterFile = useRef<File | null>(null);
  const masterAudio = useRef<{ file: File; buf: AudioBuffer } | null>(null);
  const sourceAudio = useRef(new Map<File, AudioBuffer | null>());
  const anglesRef = useRef(angles);
  anglesRef.current = angles;
  const taps = useRef<number[]>([]);

  // ---------- 플레이어 ----------
  useEffect(() => {
    const v = videoRef.current!;
    playerRef.current = new Player(() => projRef.current, () => v.duration || 0, (text) => setMsg({ kind: 'warn', text }));
    const unguard = playerRef.current.guard(v);
    const unfollow = followMaster(v, () => anglesRef.current, () => projRef.current);
    // 재생 시계: 타임라인 시간 기준 (녹음본이 메인 · 영상들은 시계를 따라감 · 조각 이동·빈자리·구간 반복)
    const tr = new Transport(elsMap, () => projRef.current, () => v.duration || 0, () => endRef.current, playerRef.current);
    transportRef.current = tr;
    (window as any).__pveTransport = tr;   // 점검용
    tr.onState = () => setPlaying(tr.playing);
    let raf = 0;
    const tick = () => { setNow(tr.time()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); unfollow(); unguard(); tr.dispose(); };
  }, []);

  useEffect(() => { playerRef.current?.applyRecGain(); playerRef.current?.applyVideoMix([...elsMap().values()]); }, [project.videoMuted, project.videoVol, project.recMuted, project.recVol, sources.length]);
  useEffect(() => { playerRef.current?.restart(); }, [project.recAt, project.recOffset, project.trims?.rec?.in, project.trims?.rec?.out, JSON.stringify(project.recClips || []), JSON.stringify(project.recFades || {}),
    (project.recClips || []).map(c => { const t = project.trims?.[recKeyOf(c)]; return t ? t.in + ':' + t.out : ''; }).join('|')]);
  // 예전 프로젝트: 녹음본이 첫 영상에 붙어 있던 위치를 타임라인 위치로 고정 (이제 녹음본이 기준)
  useEffect(() => {
    const p = projRef.current;
    if (typeof p.recAt === 'number' || !duration) return;
    setProjectAuto({ recAt: recAtOf(p, duration) });
  }, [duration, project.recAt]);
  useEffect(() => { store.set('pve.layouts', layouts); }, [layouts]);
  useEffect(() => { store.set('pve.ui', { ratio }); }, [ratio]);
  useEffect(() => { store.set('pve.templates', templates); }, [templates]);
  useEffect(() => { if (videoName) store.set('pve.proj:' + videoName, project); }, [project, videoName]);

  // ---------- 파일 ----------
  const loadVideo = async (file: File, keep = false) => {
    const v = videoRef.current!;
    transportRef.current?.pause(); v.pause();
    setHasVideo(false); setVTrack(null); setDuration(0);
    setVideoName(file.name);
    masterFile.current = file;
    resetHistory();
    // 클라우드: 열어둔 프로젝트의 영상이면 설정 유지, 아니면 새 프로젝트 만들기
    if (cloud && !keep) {
      const cur = projects.find(d => d.id === currentRef.current);
      if (!currentRef.current || (cur && cur.videoName && cur.videoName !== file.name)) {
        setWant(null);
        filesRef.current = {};
        const t = file.name.replace(/\.[^.]+$/, '');
        setTitle(t);
        creating.current = cloud.createProject({
          title: t, videoName: file.name, recName, sheetName: sheet?.name || '', angleNames: anglesRef.current.map(a => a.id),
          project: { ...defaultProject() }, layouts: layoutsRef.current, ratio,
        });
        creating.current.then(id => {
          setCurrentId(id); creating.current = null;
          const list = Array.from(pending.current.entries()); pending.current.clear();
          list.forEach(([role, f]) => cloudUpload(role, f));
        }).catch(() => { creating.current = null; setMsg({ kind: 'warn', text: '클라우드에 새 프로젝트를 만들지 못했어요. 인터넷 연결을 확인해 주세요.' }); });
      }
    }
    // 같은 파일을 다시 열면 지난 설정 복원 (클라우드 프로젝트를 다시 여는 중이면 건너뜀)
    const saved = keep ? null : store.get<Project | null>('pve.proj:' + file.name, null as any);
    if (keep) { if (wantRef.current?.videoName !== file.name) unlockAuto(); }
    else if (saved && (saved as any).bpm) {
      const sp = { ...defaultProject(), ...saved };
      delete (sp as any).pickupBeats; delete (sp as any).pickupMode;
      // 악보 타임라인 새 방식(악보 조각)으로: 예전 악보 설정은 초기화
      if (!sp.sheetClips) { delete sp.cardSegs; delete sp.sheetShift; sp.sheetOffset = 0; }
      if (sp.anchorBar !== 1) { sp.anchorTime -= (sp.anchorBar - 1) * barLen(sp); sp.anchorBar = 1; }
      setProjectState(sp);
      lockAuto(sp);
    }
    else { unlockAuto(); setProjectState(p => ({ ...defaultProject(), videoMuted: p.videoMuted, recMuted: p.recMuted, videoVol: p.videoVol, recVol: p.recVol })); }
    if (v.src) URL.revokeObjectURL(v.src);
    // 일부 카메라 앱 영상은 크롬에서 중간에 맨 앞 장면이 번쩍 보이는 구조라, 재생용으로만 고쳐서 씀 (원본·업로드는 그대로)
    v.src = URL.createObjectURL(await fixEditList(file));
    v.load();
    cloudUpload('video', file);
    setMsg({ kind: 'busy', text: '영상 소리 분석 중…' });
    try {
      const mono = await decodeVideoAudio(file, ab => decodeMono(ab));
      const tr = analyzeTrack(mono);
      setMsg({ kind: 'ok', text: '영상 소리 분석 완료' });
      setVTrack(tr);
    } catch {
      setMsg({ kind: 'warn', text: '영상의 소리를 읽지 못했어요. 녹음본을 넣으면 그걸로 BPM을 찾을 수 있어요. 싱크는 수동으로 맞춰주세요.' });
    }
  };

  const loadRec = async (file: File) => {
    const w = wantRef.current;   // 다른 녹음본으로 바꾸면 다시 자동 계산 (다시 연 프로젝트의 원래 파일이면 그대로)
    if ((recName && recName !== file.name) || (w?.recName && w.recName !== file.name)) {
      unlockAuto();
      // 다른 녹음본으로 바꾸면 예전 녹음본을 잘라 둔 조각·줄이기는 정리
      const p = projRef.current, tr = { ...(p.trims || {}) }; delete tr.rec;
      for (const c of p.recClips || []) if (c.src === MAIN_REC) delete tr[recKeyOf(c)];
      if (p.trims?.rec || (p.recClips || []).some(c => c.src === MAIN_REC)) setProject({ trims: tr, recClips: (p.recClips || []).filter(c => c.src !== MAIN_REC) });
    }
    setRecName(file.name);
    setMsg({ kind: 'busy', text: '녹음본 분석 중…' });
    try {
      const [ab1, ab2] = await Promise.all([file.arrayBuffer(), file.arrayBuffer()]);
      const mono = await decodeMono(ab1);
      const tr = analyzeTrack(mono);
      await playerRef.current!.loadRec(ab2);
      setMsg({ kind: 'ok', text: '녹음본 분석 완료' });
      setRTrack(tr);
      cloudUpload('rec', file);
    } catch {
      setRecName('');
      setMsg({ kind: 'warn', text: '이 파일은 읽을 수 없어요. mp3 또는 wav 파일을 넣어주세요.' });
    }
  };

  /** 녹음본 파일 길이 (MAIN_REC = 첫 녹음본) */
  const recDurOf = (src: string) => src === MAIN_REC ? (rTrack?.duration || playerRef.current?.recBuf?.duration || 0) : (xrecRef.current.find(k => k.id === src)?.dur || 0);
  /** 녹음본 조각들: 첫 녹음본('rec') + 추가·잘라낸 조각들 */
  const recPieces = (p: Project) => {
    const out: { key: string; src: string; at: number; dur: number; clip?: RecClip }[] = [];
    if (rTrack) out.push({ key: 'rec', src: MAIN_REC, at: recAtOf(p, masterDur()), dur: rTrack.duration });
    for (const c of p.recClips || []) { const d = recDurOf(c.src); if (d) out.push({ key: recKeyOf(c), src: c.src, at: c.at, dur: d, clip: c }); }
    return out;
  };
  /** 재생 위치에서 녹음본 자르기 (고른 조각 우선, 없으면 그 자리의 맨 위 조각) → 새 조각 키 */
  const splitRec = (t: number, key: string | null): string | null => {
    const p = projRef.current;
    const hits = recPieces(p).filter(x => { const tr = trimOf(p, x.key, x.dur); return t > x.at + tr.in + 0.05 && t < x.at + tr.out - 0.05; });
    const h = hits.find(x => x.key === key) || hits[hits.length - 1];
    if (!h) return null;
    const tr = trimOf(p, h.key, h.dur), s = Math.round((t - h.at) * 1000) / 1000;
    const id = 'r' + Date.now().toString(36), nc: RecClip = { id, src: h.src, at: h.at };
    setProject({ trims: { ...(p.trims || {}), [h.key]: { in: tr.in, out: s }, [recKeyOf(nc)]: { in: s, out: tr.out } }, recClips: [...(p.recClips || []), nc] });
    return recKeyOf(nc);
  };
  /** 녹음본 조각 지우기 (첫 녹음본의 첫 조각은 길이 0으로 숨김 — 되돌리기로 살릴 수 있음) */
  const deleteRecPiece = (key: string) => {
    const p = projRef.current;
    if (key === 'rec') {
      if (!rTrack) return;
      const tr = trimOf(p, 'rec', rTrack.duration);
      setProject({ trims: { ...(p.trims || {}), rec: { in: tr.out, out: tr.out } } });
    } else {
      const c = (p.recClips || []).find(x => recKeyOf(x) === key); if (!c) return;
      // 추가 녹음본의 마지막 조각이면 목록에서 빼지 않고 조각만 지움 (다시 넣으려면 '녹음본 추가')
      const tr = { ...(p.trims || {}) }; delete tr[key];
      setProject({ recClips: (p.recClips || []).filter(x => x !== c), trims: tr });
    }
    setMsg({ kind: 'ok', text: '녹음본 조각을 지웠어요. 되돌리려면 Ctrl+Z' });
  };
  /** 녹음본 추가: 영상 소리와 맞는 곳이 있으면 거기에, 없으면 앞 녹음본 뒤에 이어 붙임 */
  const addRec = async (file: File, restoring = false) => {
    if (!recName && !restoring) return loadRec(file);
    const id = file.name;
    if (id === recName || xrecRef.current.some(x => x.id === id)) { setMsg({ kind: 'info', text: `${file.name}은 이미 들어가 있어요. 다른 이름의 파일을 넣어주세요.` }); return; }
    setMsg({ kind: 'busy', text: `${file.name} 분석 중…` });
    let tr: Track | null = null, dur = 0;
    try {
      const [ab1, ab2] = await Promise.all([file.arrayBuffer(), file.arrayBuffer()]);
      dur = await playerRef.current!.addRec(id, ab2);
      try { tr = analyzeTrack(await decodeMono(ab1)); } catch { /* 파형 없이 */ }
    } catch { setMsg({ kind: 'warn', text: `${file.name}: 읽을 수 없는 파일이에요. mp3 또는 wav 파일을 넣어주세요.` }); return; }
    setExtraRecs(xs => [...xs.filter(x => x.id !== id), { id, track: tr, dur, file }]);
    cloudUpload('recx:' + id, file);
    if (restoring || (projRef.current.recClips || []).some(c => c.src === id)) { setMsg({ kind: 'ok', text: `${file.name}을 불러왔어요.` }); return; }
    // 놓을 자리: 영상 소리와 비교해서 가장 잘 맞는 영상에 맞춤
    const p = projRef.current, cs = clipsOf(p, masterDur());
    let at = NaN, how = '앞 녹음본 뒤에 이어 붙였어요', best = 1.1;
    if (tr) {
      const cands: { track: Track; v0: number }[] = [];
      const m = cs.find(c => !c.src); if (vTrack && m) cands.push({ track: vTrack, v0: m.start - m.srcIn });
      for (const x of sourcesRef.current) { const c = cs.find(k => k.src === x.id); if (x.track && c) cands.push({ track: x.track, v0: c.start - c.srcIn }); }
      for (const c of cands) {
        const r = syncOffset(c.track, tr, Math.min(900, Math.max(c.track.duration, tr.duration) + 5));
        console.info('[녹음본 추가] 영상과 비교', file.name, 'offset', r.offset.toFixed(3), 'confidence', r.confidence.toFixed(2));
        if (r.confidence > best) { best = r.confidence; at = c.v0 - r.offset; how = '영상 소리에 맞춰 놓았어요'; }
      }
    }
    if (!isFinite(at)) {
      const ends = [rTrack ? recAtOf(p, masterDur()) + trimOf(p, 'rec', rTrack.duration).out : 0,
        ...(p.recClips || []).map(c => { const d = recDurOf(c.src); return d ? c.at + trimOf(p, recKeyOf(c), d).out : 0; })];
      at = Math.max(0, ...ends);
    }
    setProject({ recClips: [...(p.recClips || []).filter(c => c.src !== id), { src: id, at: Math.round(at * 1000) / 1000 }] });
    setMsg({ kind: 'ok', text: `${file.name}: ${how}. 타임라인 '녹음본' 줄에서 끌어서 옮기고 양 끝을 줄일 수 있어요.` });
  };
  const removeRec = (id: string) => {
    setExtraRecs(xs => xs.filter(x => x.id !== id));
    playerRef.current?.removeRec(id);
    const p = projRef.current;
    if (p.recClips) { const tr = { ...(p.trims || {}) }; for (const c of p.recClips) if (c.src === id) delete tr[recKeyOf(c)]; setProject({ recClips: p.recClips.filter(c => c.src !== id), trims: tr }); }
    if (cloud?.storage && currentRef.current) {
      const pid = currentRef.current;
      queue(async () => {
        const cur = filesRef.current, r = cur.recs?.[id];
        if (!r) return;
        const rs = { ...(cur.recs || {}) }; delete rs[id];
        const next = { ...cur, recs: rs };
        filesRef.current = next;
        await cloud.setFiles(pid, next);
        if (!refsOf(next).some(y => y.path === r.path) && isOrphan(r.path, pid)) await cloud.deleteFile(r.path);
      });
    }
  };
  /** 추가 녹음본을 영상 소리에 다시 맞추기 */
  const resyncRec = (id: string) => {
    const x = xrecRef.current.find(k => k.id === id), p = projRef.current, cs = clipsOf(p, masterDur());
    if (!x?.track) return;
    let best = 1.1, at = NaN;
    const m = cs.find(c => !c.src);
    const cands: { track: Track; v0: number }[] = [];
    if (vTrack && m) cands.push({ track: vTrack, v0: m.start - m.srcIn });
    for (const s of sourcesRef.current) { const c = cs.find(k => k.src === s.id); if (s.track && c) cands.push({ track: s.track, v0: c.start - c.srcIn }); }
    for (const c of cands) { const r = syncOffset(c.track, x.track, Math.min(900, Math.max(c.track.duration, x.track.duration) + 5)); if (r.confidence > best) { best = r.confidence; at = c.v0 - r.offset; } }
    if (!isFinite(at)) { setMsg({ kind: 'warn', text: '영상 소리와 비슷한 곳을 확실히 찾지 못했어요. 녹음본 줄에서 끌어서 맞춰 주세요.' }); return; }
    setProject({ recClips: (p.recClips || []).map(c => c.src === id ? { ...c, at: Math.round(at * 1000) / 1000 } : c) });
    setMsg({ kind: 'ok', text: `${id}을 영상 소리에 맞췄어요.` });
  };

  const loadSheet = async (file: File) => {
    const w = wantRef.current;
    if ((sheet && sheet.name !== file.name) || (w?.sheetName && w.sheetName !== file.name)) unlockAuto();
    setMsg({ kind: 'busy', text: '악보 줄과 마디선 찾는 중…' });
    try {
      const pages = await fileToPages(file);
      const s = detectSheet(pages, file.name);
      setSheetPages(pages.length);
      if (!s.bars.length) {
        setSheet(null);
        setMsg({ kind: 'warn', text: '악보에서 오선을 찾지 못했어요. 비뚤어지지 않은 선명한 PDF나 이미지를 넣어주세요.' });
        return;
      }
      // 다른 악보로 바꾸거나, 타임라인에서 악보를 다 지운 뒤 다시 넣으면 1마디부터 악보 전체로 새로 깔기
      // (저장된 프로젝트를 다시 열면서 원래 악보가 들어오는 경우는 편집해 둔 악보 조각 그대로)
      const restoring = !sheet && !!w?.sheetName && w.sheetName === file.name;
      const cl = projRef.current.sheetClips;
      if (!restoring && cl && (cl.length === 0 || !sheet || sheet.name !== file.name)) {
        // 추가로 넣은 다른 악보 조각은 그대로 두고, 첫 악보만 1마디부터 새로
        const others = cl.filter(c => c.sheet && c.sheet !== sheet?.name && extraRef.current.some(x => x.name === c.sheet));
        setProject({ sheetClips: others.length ? [{ id: 'k' + Date.now().toString(36), start: sheetHome(projRef.current), barIn: 0, barOut: s.bars.length }, ...others] : undefined });
      }
      setSheet(s);
      cloudUpload('sheet', file);
      setMsg({ kind: 'ok', text: `악보 ${s.systems.length}줄 · ${s.bars.length}마디를 찾았어요.` });
    } catch (e: any) {
      setMsg({ kind: 'warn', text: e?.message || '악보를 읽지 못했어요.' });
    }
  };

  /** 악보 추가: 앞 악보가 끝나는 곳 뒤에 붙임 (템포가 다르면 타임라인에서 그 악보를 누르고 BPM 입력) */
  const addSheet = async (file: File, restoring = false) => {
    if (!sheet && !restoring) return loadSheet(file);
    if (file.name === sheet?.name || extraRef.current.some(x => x.name === file.name)) { setMsg({ kind: 'info', text: `${file.name}은 이미 들어가 있어요. 다른 이름의 파일을 넣어주세요.` }); return; }
    setMsg({ kind: 'busy', text: `${file.name}: 악보 줄과 마디선 찾는 중…` });
    try {
      const s = detectSheet(await fileToPages(file), file.name);
      if (!s.bars.length) { setMsg({ kind: 'warn', text: `${file.name}에서 오선을 찾지 못했어요.` }); return; }
      setExtraSheets(ss => [...ss.filter(x => x.name !== s.name), s]);
      cloudUpload('sheetx:' + file.name, file);
      if (restoring) { setMsg({ kind: 'ok', text: `${file.name}을 불러왔어요.` }); return; }
      const p = projRef.current, list = sheetClipsOf(p, sheet?.bars.length || 0);
      const start = list.length ? Math.max(...list.map(c => sheetClipEnd(p, c))) : sheetHome(p);
      const clip: SheetClip = { id: 'k' + Date.now().toString(36), start: Math.round(start * 1000) / 1000, barIn: 0, barOut: s.bars.length, sheet: s.name };
      setProject({ sheetClips: [...list, clip] });
      setMsg({ kind: 'ok', text: `${file.name}: ${s.bars.length}마디를 앞 악보 뒤에 붙였어요. 템포가 다르면 왼쪽 악보 목록의 '이 악보부터' 칸에 BPM을 넣거나 '소리로 찾기'를 눌러 주세요.` });
    } catch (e: any) { setMsg({ kind: 'warn', text: e?.message || '악보를 읽지 못했어요.' }); }
  };
  const removeSheet = (name: string) => {
    setExtraSheets(ss => ss.filter(x => x.name !== name));
    const p = projRef.current;
    if (p.sheetClips) setProject({ sheetClips: p.sheetClips.filter(c => c.sheet !== name) });
    if (cloud?.storage && currentRef.current) {
      const pid = currentRef.current;
      queue(async () => {
        const cur = filesRef.current, r = cur.sheets?.[name];
        if (!r) return;
        const ss = { ...(cur.sheets || {}) }; delete ss[name];
        const next = { ...cur, sheets: ss };
        filesRef.current = next;
        await cloud.setFiles(pid, next);
        if (!refsOf(next).some(y => y.path === r.path) && isOrphan(r.path, pid)) await cloud.deleteFile(r.path);
      });
    }
  };
  /** 고른 악보 조각과 같은 악보의 모든 조각에 템포 넣기 (비우면 앞 템포 그대로) */
  const setSheetBpm = (clipId: string, bpm: number | undefined) => {
    const p = projRef.current, list = sheetClipsOf(p, sheet?.bars.length || 0), c = list.find(x => x.id === clipId);
    if (!c) return;
    const keyOf = (x: SheetClip) => x.sheet && x.sheet !== sheet?.name ? x.sheet : '';
    const key = keyOf(c), first = Math.min(...list.filter(x => keyOf(x) === key).map(x => x.start));
    // 뒤에 오는 다른 악보는 지금 템포를 그대로 유지 (이 악보의 템포가 뒤로 번지지 않게)
    let next = list.map(x => keyOf(x) === key ? { ...x, bpm } : (!x.bpm && x.start > first + 1e-3) ? { ...x, bpm: Math.round(bpmAt(p, x.start + 1e-3) * 100) / 100 } : x);
    // 이어 붙어 있던 뒤 악보들은 이 악보 길이가 바뀐 만큼 같이 밀거나 당김 (사이가 벌어지거나 겹치지 않게)
    const order = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < order.length; i++) {
      const prevOld = order[i - 1];
      if (Math.abs(order[i].start - sheetClipEnd(p, prevOld)) > 0.02) continue;
      const pp = { ...p, sheetClips: next }, prevNew = next.find(x => x.id === prevOld.id)!;
      const ns = Math.round(sheetClipEnd(pp, prevNew) * 1000) / 1000;
      next = next.map(x => x.id === order[i].id ? { ...x, start: ns } : x);
    }
    setProject({ sheetClips: next });
    setMsg({ kind: 'ok', text: bpm ? `이 악보부터 ${bpm} BPM으로 맞췄어요.` : '이 악보의 템포를 앞 템포 그대로로 되돌렸어요.' });
  };

  /** 녹음본(없으면 영상 소리)에서 그 악보 구간의 템포를 찾아 넣기 */
  const findSheetTempo = (clipId: string) => {
    const p = projRef.current, list = sheetClipsOf(p, sheet?.bars.length || 0), c = list.find(x => x.id === clipId);
    if (!c) return;
    const tr = rTrack || vTrack;
    if (!tr) { setMsg({ kind: 'info', text: '녹음본이나 영상 소리가 있어야 템포를 찾을 수 있어요.' }); return; }
    const shift = rTrack ? recAtOf(p, masterDur()) : mainShift(p, masterDur());   // 타임라인 = 소리 시간 + shift
    const nextStart = Math.min(...list.filter(x => x.start > c.start + 0.05).map(x => x.start), shift + tr.duration);
    const r = estimateTempoRange(tr, c.start - shift, nextStart - shift, { bpb: p.beatsPerBar, sheetBars: c.barOut - c.barIn });
    if (!r) { setMsg({ kind: 'warn', text: '이 악보 구간의 소리가 너무 짧아서 템포를 찾지 못했어요. 직접 넣어 주세요.' }); return; }
    const bpm = Math.round(r.suggested * 10) / 10;
    setSheetBpm(clipId, bpm);
    setMsg({ kind: 'ok', text: `${rTrack ? '녹음본' : '영상 소리'}에서 이 악보 구간을 들어보니 ${bpm} BPM 같아요. 다르면 숫자를 고쳐 주세요.` });
  };

  // ---------- 멀티 앵글 ----------
  const updateAngle = (id: string, patch: Partial<Angle>) =>
    setAngles(as => as.map(a => a.id === id ? { ...a, ...patch } : a));

  // ---------- 이어 붙이는 영상 ----------
  /** 영상 추가: 녹음본이 있으면 소리로 녹음본에 맞춰 놓고, 아니면 맨 뒤에 이어 붙임 */
  const addSource = async (file: File, restoring = false, force = false) => {
    const id = file.name;
    if (!videoName && !restoring && !force) return loadVideo(file);
    if (id === videoName || sourcesRef.current.some(x => x.id === id)) { setMsg({ kind: 'info', text: `${file.name}은 이미 들어가 있어요.` }); return; }
    const video = makeAngleVideo();
    video.src = URL.createObjectURL(await fixEditList(file));
    playerRef.current?.guard(video);
    const src: VSource = { id, name: file.name, video, track: null, dur: 0, file };
    setSources(ss => [...ss, src]);
    cloudUpload('source:' + id, file);
    const dur = await new Promise<number>(res => {
      if (video.readyState >= 1) return res(video.duration || 0);
      video.addEventListener('loadedmetadata', () => res(video.duration || 0), { once: true });
      video.addEventListener('error', () => res(0), { once: true });
    });
    if (!video.videoWidth && dur) setMsg({ kind: 'warn', text: `${file.name}: 이 PC의 크롬에서 재생할 수 없는 영상 형식이에요 (HEVC일 가능성이 커요).` });
    setSources(ss => ss.map(x => x.id === id ? { ...x, dur } : x));
    setMsg({ kind: 'busy', text: `${file.name} 소리 분석 중…` });
    let tr: Track | null = null;
    try { tr = analyzeTrack(await decodeVideoAudio(file, ab => decodeMono(ab))); setSources(ss => ss.map(x => x.id === id ? { ...x, track: tr } : x)); } catch { /* 소리 없는 영상 */ }
    if (restoring) { setMsg({ kind: 'ok', text: `${file.name}을 불러왔어요.` }); return; }
    // 첫 영상을 같이 넣었으면 그 길이를 알 때까지 기다림 (첫 영상 조각이 빠지지 않게)
    for (let i = 0; i < 100 && videoRef.current?.src && !(masterDur() > 0); i++) await new Promise(r => setTimeout(r, 100));
    // 타임라인에 놓기
    const p = projRef.current, base = clipsOf(p, masterDur());
    let start = Math.max(0, ...base.map(clipEnd)), how = '맨 뒤에 이어 붙였어요';
    if (tr && rTrack && dur) {
      const r = syncOffset(tr, rTrack, Math.min(900, Math.max(rTrack.duration, dur) + 5));
      if (r.confidence > 1.2) { start = recAtOf(p, masterDur()) + r.offset; how = '녹음본 소리에 맞춰 놓았어요'; }
    }
    const clip: Clip = { id: 'c' + Date.now().toString(36), start: Math.round(start * 1000) / 1000, srcIn: 0, srcOut: dur || 1, src: id };
    setProject({ clips: [...base, clip], skips: [] });
    setMsg({ kind: 'ok', text: `${file.name}: ${how}. 타임라인 '영상' 줄에서 자르고 옮길 수 있어요.` });
  };
  /** 영상을 녹음본 소리에 다시 맞추기 (그 영상의 모든 조각을 같이 옮김) */
  const resyncSource = (id: string) => {
    const x = sourcesRef.current.find(v => v.id === id);
    if (!x?.track || !rTrack) { setMsg({ kind: 'info', text: '녹음본과 그 영상의 소리가 있어야 맞출 수 있어요.' }); return; }
    const r = syncOffset(x.track, rTrack, Math.min(900, Math.max(rTrack.duration, x.dur) + 5));
    if (r.confidence <= 1.1) { setMsg({ kind: 'warn', text: '소리가 비슷한 곳을 확실히 찾지 못했어요. 영상 조각을 끌어서 맞춰 주세요.' }); return; }
    const p = projRef.current, recAt = recAtOf(p, masterDur());
    setProject({ clips: clipsOf(p, masterDur()).map(c => c.src === id ? { ...c, start: Math.round((recAt + r.offset + c.srcIn) * 1000) / 1000 } : c), skips: [] });
    setMsg({ kind: 'ok', text: `${x.name}을 녹음본에 맞췄어요.` });
  };
  const removeSource = (id: string) => {
    const x = sourcesRef.current.find(v => v.id === id); if (!x) return;
    x.video.pause(); URL.revokeObjectURL(x.video.src); x.video.remove();
    setSources(ss => ss.filter(v => v.id !== id));
    const p = projRef.current;
    if (p.clips) setProject({ clips: p.clips.filter(c => c.src !== id) });
    if (cloud?.storage && currentRef.current) {
      const pid = currentRef.current;
      queue(async () => {
        const cur = filesRef.current, r = cur.sources?.[id];
        if (!r) return;
        const srcs = { ...(cur.sources || {}) }; delete srcs[id];
        const next = { ...cur, sources: srcs };
        filesRef.current = next;
        await cloud.setFiles(pid, next);
        if (!refsOf(next).some(y => y.path === r.path) && isOrphan(r.path, pid)) await cloud.deleteFile(r.path);
      });
    }
  };

  const loadAngle = async (file: File) => {
    let id = file.name;
    if (anglesRef.current.some(a => a.id === id)) { setMsg({ kind: 'info', text: `${file.name}은 이미 들어가 있어요.` }); return; }
    const video = makeAngleVideo();
    video.src = URL.createObjectURL(await fixEditList(file));
    const angle: Angle = { id, name: file.name, video, track: null, confidence: null, ready: false };
    video.addEventListener('loadedmetadata', () => {
      if (!video.videoWidth) setMsg({ kind: 'warn', text: `${file.name}: 이 PC의 크롬에서 재생할 수 없는 영상 형식이에요 (HEVC일 가능성이 커요).` });
      else updateAngle(id, { ready: true });
    }, { once: true });
    setAngles(as => [...as, angle]);
    cloudUpload('angle:' + id, file);
    setMsg({ kind: 'busy', text: `${file.name} 소리 분석 중… (기준 영상과 싱크 맞추기)` });
    try {
      const tr = analyzeTrack(await decodeVideoAudio(file, ab => decodeMono(ab)));
      updateAngle(id, { track: tr });
      setMsg({ kind: 'ok', text: `${file.name} 앵글을 추가했어요.` });
    } catch {
      setMsg({ kind: 'warn', text: `${file.name}의 소리를 읽지 못했어요. 싱크를 손으로 맞춰주세요.` });
    }
  };

  // 기준 영상과 앵글 소리가 둘 다 있으면 자동 싱크 (저장된 값이 있으면 그 값을 씀)
  useEffect(() => {
    if (!vTrack) return;
    const p = projRef.current;
    const offs = { ...p.angleOffsets };
    let changed = false;
    for (const a of angles) {
      if (!a.track || a.confidence !== null) continue;
      if (offs[a.id] === undefined) {
        const r = syncOffset(vTrack, a.track, 120);
        offs[a.id] = r.offset; changed = true;
        updateAngle(a.id, { confidence: r.confidence });
      } else updateAngle(a.id, { confidence: -1 });
    }
    if (changed) setProjectAuto({ angleOffsets: offs });
    // eslint-disable-next-line
  }, [vTrack, angles]);

  const resyncAngle = (a: Angle) => {
    if (!vTrack || !a.track) return;
    const r = syncOffset(vTrack, a.track, 120);
    setProject({ angleOffsets: { ...projRef.current.angleOffsets, [a.id]: r.offset } });
    updateAngle(a.id, { confidence: r.confidence });
  };

  const removeAngle = (a: Angle) => {
    a.video.pause();
    URL.revokeObjectURL(a.video.src);
    a.video.remove();
    setAngles(as => as.filter(x => x.id !== a.id));
    const p = projRef.current;
    setProject({ cuts: normalizeCuts(p.cuts.filter(c => c.angle !== a.id)) });
    if (cloud?.storage && currentRef.current) {
      const id = currentRef.current;
      queue(async () => {
        const cur = filesRef.current, r = cur.angles?.[a.id];
        if (!r) return;
        const angles = { ...(cur.angles || {}) }; delete angles[a.id];
        const next = { ...cur, angles };
        filesRef.current = next;
        await cloud.setFiles(id, next);
        if (!refsOf(next).some(x => x.path === r.path) && isOrphan(r.path, id)) await cloud.deleteFile(r.path);
      });
    }
  };

  const angleIds = [MAIN, ...angles.map(a => a.id)];
  const LAYOUT_COLOR: Record<string, string> = { split2: '#c9b8ff', quad: '#9fe0ff', pip: '#ffb8d6' };
  const angleInfo = (id: string) => {
    if (LAYOUT_LABEL[id]) return { color: LAYOUT_COLOR[id], num: 0, label: LAYOUT_LABEL[id] };
    const i = Math.max(0, angleIds.indexOf(id));
    return { color: ANGLE_COLORS[i % ANGLE_COLORS.length], num: i + 1, label: String(i + 1) };
  };
  /** 분할·PIP를 지금 위치부터 결과물에 넣기 */
  const insertLayout = (id: string) => {
    const p = projRef.current;
    const t = Math.max(0, snapTime(p, tnow()));
    setProject({ cuts: setCutAt(p.cuts, t, id) });
    setMsg({ kind: 'ok', text: `${fmtTime(t)}부터 ${LAYOUT_LABEL[id]}` });
  };
  const [autoN, setAutoN] = useState(4);
  /** N마디마다 앵글을 차례로 바꾸기 */
  // 앵글 색 맞추기: 기준 영상에 맞춰 각 앵글의 색·밝기 보정값 계산
  const matchColors = async () => {
    const mv = videoRef.current; if (!mv?.src || cmBusy) return;
    setCmBusy(true);
    try {
      const m: Record<string, number[]> = {};
      for (const a of anglesRef.current) {
        if (a.id === MAIN || !a.video.src) continue;
        const r = await computeColorMatch(mv.src, a.video.src, projRef.current.angleOffsets[a.id] || 0, mv.duration || duration);
        if (r) m[a.id] = r;
      }
      if (Object.keys(m).length) { setFx({ colorMatch: { on: true, m } }); setMsg({ kind: 'ok', text: '앵글 색을 기준 영상에 맞췄어요.' }); }
      else setMsg({ kind: 'warn', text: '색을 비교할 장면을 찾지 못했어요.' });
    } catch { setMsg({ kind: 'warn', text: '색 맞추기 중 문제가 생겼어요.' }); }
    setCmBusy(false);
  };
  const autoSwitch = () => {
    const p = projRef.current, ids = [MAIN, ...anglesRef.current.map(a => a.id)];
    if (ids.length < 2 || !duration) return;
    const cuts: Cut[] = [];
    let k = 0;
    for (let n = 1; ; n += autoN, k++) {
      const t = barStart(p, n);
      if (t >= duration - 0.2) break;
      if (t < 0) continue;
      cuts.push({ t, angle: ids[k % ids.length] });
    }
    setProject({ cuts: normalizeCuts(cuts) });
    setMsg({ kind: 'ok', text: `${autoN}마디마다 앵글이 바뀌게 넣었어요 (${cuts.length}곳)` });
  };

  const switchAngle = (idx: number) => {
    const ids = [MAIN, ...anglesRef.current.map(a => a.id)];
    if (idx >= ids.length || !hasVideo) return;
    const p = projRef.current;
    const t = Math.max(0, snapTime(p, tnow()));
    setProject({ cuts: setCutAt(p.cuts, t, ids[idx]) });
    const { bar, beat } = barBeat(p, t + 1e-4);
    setMsg({ kind: 'ok', text: `${bar >= 1 ? `${bar}마디 ${beat + 1}박` : fmtTime(t)}부터 ${idx + 1}번 앵글` });
  };

  const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
  /** 영상 파일 배정: 다시 여는 프로젝트면 이름으로 기준 영상/앵글을 가르고, 아니면 첫 영상이 기준 */
  const routeVideo = (file: File, masterTaken: boolean) => {
    const w = wantRef.current;
    if (w) {
      if (file.name === w.videoName) return loadVideo(file, true);
      if (w.angleNames.includes(file.name)) return loadAngle(file);
      if ((w.sourceNames || []).includes(file.name)) return addSource(file, true);
      if (!masterTaken) return loadVideo(file, true); // 이름이 바뀐 기준 영상으로 보고 설정 유지
      return addSource(file, false, true);
    }
    // 첫 영상 다음부터는 타임라인 '영상' 줄에 이어 붙임 (같은 연주의 다른 각도는 '앵글 추가'로)
    return masterTaken ? addSource(file, false, true) : loadVideo(file);
  };

  const route = (file: File) => {
    const n = file.name.toLowerCase();
    if (isVideoFile(file)) return routeVideo(file, !!videoName);
    if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac)$/.test(n)) {
      // 다시 여는 프로젝트의 두 번째 녹음본 · 이미 녹음본이 있으면 추가 (바꾸려면 왼쪽 '녹음본' 칸의 바꾸기)
      if (wantRef.current?.recNames?.includes(file.name)) return addRec(file, true);
      if (recName && recName !== file.name && wantRef.current?.recName !== file.name) return addRec(file);
      return loadRec(file);
    }
    if (file.type === 'application/pdf' || file.type.startsWith('image/') || /\.(pdf|png|jpe?g)$/.test(n)) {
      // 다시 여는 프로젝트의 두 번째 악보 · 이미 악보가 타임라인에 있으면 뒤에 추가 (바꾸려면 왼쪽 '악보' 칸의 바꾸기)
      if (wantRef.current?.sheetNames?.includes(file.name)) return addSheet(file, true);
      if (sheet && sheet.name !== file.name && (projRef.current.sheetClips?.length ?? 1) > 0 && wantRef.current?.sheetName !== file.name) return addSheet(file);
      return loadSheet(file);
    }
    setMsg({ kind: 'warn', text: `${file.name}: 영상(mov, mp4), 녹음본(mp3, wav), 악보(pdf, jpg, png)만 넣을 수 있어요.` });
  };

  // 화면 어디에 끌어다 놓아도 종류별로 들어감
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      const w = wantRef.current;
      // 다시 여는 프로젝트의 기준 영상을 맨 앞으로
      const vids = files.filter(isVideoFile).sort((a, b) => (w && b.name === w.videoName ? 1 : 0) - (w && a.name === w.videoName ? 1 : 0));
      let taken = !!videoName;
      for (const f of vids) {
        const becomesMaster = !taken && (!w || f.name === w.videoName || !w.angleNames.includes(f.name));
        routeVideo(f, taken);
        if (becomesMaster) taken = true;
      }
      files.filter(f => !isVideoFile(f)).forEach(route);
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  });

  // ---------- 클라우드: 목록·템플릿 구독, 자동 저장, 열기 ----------
  useEffect(() => cloud ? cloud.watchProjects(setProjects) : undefined, []);
  projectsRef.current = projects;
  // 업로드 중에 창을 닫으려 하면 경고
  useEffect(() => {
    if (!transfer || transfer.kind !== 'up') return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [transfer?.kind]);
  useEffect(() => cloud ? cloud.watchTemplates(setCloudTemplates) : undefined, []);

  const currentDoc = projects.find(d => d.id === currentId) || null;
  // ---------- 여러 컴퓨터에서 같은 프로젝트 함께 고치기 ----------
  // 다른 컴퓨터가 저장하면: 이 창에 아직 저장 안 된 변경이 없으면 바로 받아오고, 있으면 어느 쪽을 쓸지 묻는다 (덮어쓰기 방지)
  const [remoteEdit, setRemoteEdit] = useState<{ by: string; at: number } | null>(null);
  const syncedAt = useRef(0);          // 마지막으로 맞춘 클라우드 저장 시각
  const adoptKey = useRef(false);      // 받아온 내용은 다시 저장하지 않음
  const stable = (v: any): string => v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`) : JSON.stringify(v);
  const contentOf = (x: { title?: string; project?: any; layouts?: any; ratio?: any }) => stable({ title: x.title || '', project: { ...defaultProject(), ...(x.project || {}) }, layouts: x.layouts || null, ratio: x.ratio || null });
  const adoptRemote = (d: ProjectDoc) => {
    const sameFiles = (d.videoName || '') === (videoName || wantRef.current?.videoName || '') && (d.recName || '') === (recName || wantRef.current?.recName || '') && (d.sheetName || '') === (sheet?.name || wantRef.current?.sheetName || '')
      && (d.sourceNames || []).every(n => sourcesRef.current.some(x => x.id === n)) && (d.sheetNames || []).every(n => extraRef.current.some(x => x.name === n))
      && (d.recNames || []).every(n => xrecRef.current.some(x => x.id === n));
    syncedAt.current = d.updatedAt; setRemoteEdit(null);
    if (!sameFiles) { openProject(d, false); return; }   // 영상·녹음본·악보가 바뀌었으면 파일까지 새로 불러옴
    const proj = { ...defaultProject(), ...(d.project || {}) };
    adoptKey.current = true;
    setProjectState(proj); lockAuto(proj);
    if (d.layouts) setLayouts(d.layouts);
    if (d.ratio) setRatio(d.ratio);
    if (d.title) setTitle(d.title);
    setMsg({ kind: 'info', text: `${d.editedByName || '다른 선생님'}이(가) 다른 컴퓨터에서 고친 내용을 받아왔어요.` });
  };
  useEffect(() => {
    const d = currentDoc;
    if (!d || !d.editSession || d.editSession === EDIT_SESSION || d.updatedAt <= syncedAt.current) return;
    const mine = savePayload();
    if (contentOf(d) === contentOf(mine)) { syncedAt.current = d.updatedAt; return; }   // 내용이 같으면 그냥 맞춤
    const dirty = JSON.stringify(mine) !== lastSaved.current;
    if (!dirty) adoptRemote(d);
    else setRemoteEdit({ by: d.editedByName || '다른 선생님', at: d.updatedAt });
    // eslint-disable-next-line
  }, [currentDoc?.updatedAt, currentDoc?.editSession]);
  const keepMine = () => { if (currentDoc) syncedAt.current = currentDoc.updatedAt; setRemoteEdit(null); saveNow(); };
  const savePayload = () => {
    const w = wantRef.current;
    const angleNames = Array.from(new Set([...(w?.angleNames || []), ...anglesRef.current.map(a => a.id)]));
    return {
      title: title || videoName.replace(/\.[^.]+$/, '') || '제목 없음',
      videoName: videoName || w?.videoName || '',
      recName: recName || w?.recName || '',
      sheetName: sheet?.name || w?.sheetName || '',
      angleNames, project: projRef.current, layouts: layoutsRef.current, ratio,
      sourceNames: Array.from(new Set([...(w?.sourceNames || []).filter(n => sourcesRef.current.some(x => x.id === n) || (projRef.current.clips || []).some(c => c.src === n)), ...sourcesRef.current.map(x => x.id)])),
      recNames: Array.from(new Set([...(w?.recNames || []).filter(n => (projRef.current.recClips || []).some(c => c.src === n)), ...xrecRef.current.map(x => x.id)])),
      sheetNames: Array.from(new Set([...(w?.sheetNames || []).filter(n => (projRef.current.sheetClips || []).some(c => c.sheet === n)), ...extraRef.current.map(x => x.name)])),
    };
  };
  /** 지금 바로 저장 (수동 저장 버튼 · Ctrl+S) */
  const saveNow = async () => {
    const id = currentRef.current;
    if (!cloud || !user) return;
    if (!id) { setMsg({ kind: 'info', text: '연주 영상을 넣으면 프로젝트가 만들어져요.' }); return; }
    const payload = savePayload();
    if (remoteEdit) { const d = projectsRef.current.find(x => x.id === id); if (d) syncedAt.current = d.updatedAt; setRemoteEdit(null); }   // 직접 저장 = 이 컴퓨터 내용으로
    setSaveState({ s: 'saving', at: Date.now() });
    try { await cloud.saveProject(id, payload); lastSaved.current = JSON.stringify(payload); setSaveState({ s: 'saved', at: Date.now() }); }
    catch { setSaveState({ s: 'error', at: Date.now() }); }
  };

  // 아직 클라우드에 안 올라간 변경이 있는데 창을 닫으려 하면: 바로 저장을 시작하고 한 번 물어봄
  const unsavedRef = useRef<() => boolean>(() => false);
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  const hasWorkRef = useRef(false);
  hasWorkRef.current = !!(videoName || recName || sheet);
  unsavedRef.current = () => !!(cloud && currentId && user && JSON.stringify(savePayload()) !== lastSaved.current);
  useEffect(() => {
    // 작업 중에 페이지를 나가려 하면 (뒤로 가기 · 새로고침 · 창 닫기) "나가시겠습니까?" 확인
    const h = (e: BeforeUnloadEvent) => {
      const unsaved = unsavedRef.current();
      if (!unsaved && !hasWorkRef.current) return;
      if (unsaved) saveNowRef.current();
      e.preventDefault(); e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
  useEffect(() => {
    if (!cloud || !currentId || !user) return;
    if (remoteEdit) return;   // 다른 컴퓨터에서 고친 내용이 있으면 고르기 전까지 자동 저장 멈춤 (덮어쓰기 방지)
    const payload = savePayload();
    const key = JSON.stringify(payload);
    if (adoptKey.current) { adoptKey.current = false; lastSaved.current = key; return; }   // 클라우드에서 받아온 그대로 → 다시 저장 안 함
    if (key === lastSaved.current) return;
    const t = setTimeout(async () => {
      setSaveState({ s: 'saving', at: Date.now() });
      try { await cloud.saveProject(currentId, payload); lastSaved.current = key; setSaveState({ s: 'saved', at: Date.now() }); }
      catch { setSaveState({ s: 'error', at: Date.now() }); }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [project, layouts, ratio, videoName, recName, sheet, angles.length, title, currentId]);

  /** 화면의 영상·녹음본·악보·앵글을 모두 비운다 */
  const clearMedia = () => {
    const v = videoRef.current!;
    transportRef.current?.pause(); v.pause();
    if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); }
    masterFile.current = null;
    setVideoName(''); setHasVideo(false); setDuration(0); setVTrack(null);
    setRecName(''); setRTrack(null); playerRef.current?.clearRec();
    setSheet(null); setSheetPages(0);
    anglesRef.current.forEach(a => { a.video.pause(); URL.revokeObjectURL(a.video.src); a.video.remove(); });
    setAngles([]);
    sourcesRef.current.forEach(x => { x.video.pause(); URL.revokeObjectURL(x.video.src); x.video.remove(); });
    setSources([]); sourceAudio.current.clear();
    setExtraSheets([]); setExtraRecs([]);
    setTempoInfo(null); setSyncInfo(null); setAutoReason('');
    resetHistory();
  };

  const openProject = async (d: ProjectDoc, copy: boolean) => {
    if (!cloud) return;
    setProjectsOpen(false);
    openToken.current++; pending.current.clear();
    clearMedia();
    const proj = { ...defaultProject(), ...(d.project || {}) };
    setProjectState(proj);
    if (d.project && (d.project as any).bpm) lockAuto(proj); else unlockAuto();
    if (d.layouts) setLayouts(d.layouts);
    if (d.ratio) setRatio(d.ratio);
    const w: Want = { videoName: d.videoName || '', recName: d.recName || '', sheetName: d.sheetName || '', angleNames: d.angleNames || [],
      sourceNames: d.sourceNames || [], sheetNames: d.sheetNames || [], recNames: d.recNames || [] };
    setWant(w.videoName || w.recName || w.sheetName || w.angleNames.length || w.sourceNames!.length || w.sheetNames!.length || w.recNames!.length ? w : null);
    if (copy) {
      const t = `${d.title} (복사본)`;
      setTitle(t);
      setCurrentId(null);
      try {
        const id = await cloud.createProject({ title: t, videoName: w.videoName, recName: w.recName, sheetName: w.sheetName, angleNames: w.angleNames, sourceNames: w.sourceNames, sheetNames: w.sheetNames, recNames: w.recNames, project: proj, layouts: d.layouts, ratio: d.ratio, files: d.files || {} });
        setCurrentId(id);
      } catch { setMsg({ kind: 'warn', text: '복사본을 만들지 못했어요.' }); }
    } else {
      setTitle(d.title);
      lastSaved.current = '';
      adoptKey.current = true;          // 연 그대로는 다시 저장하지 않음 (다른 컴퓨터에 "고침"으로 보이지 않게)
      syncedAt.current = d.updatedAt; setRemoteEdit(null);
      setCurrentId(d.id);
    }
    // 클라우드에 있는 파일은 자동으로 내려받아 넣기
    const f = d.files || {};
    filesRef.current = f;
    const token = ++openToken.current;
    const jobs: [string, FileRef][] = [];
    if (f.video) jobs.push(['video', f.video]);
    for (const n of w.angleNames) if (f.angles?.[n]) jobs.push(['angle', f.angles[n]]);
    if (f.rec) jobs.push(['rec', f.rec]);
    if (f.sheet) jobs.push(['sheet', f.sheet]);
    for (const n of w.sourceNames || []) if (f.sources?.[n]) jobs.push(['source', f.sources[n]]);
    for (const n of w.sheetNames || []) if (f.sheets?.[n]) jobs.push(['sheetx', f.sheets[n]]);
    for (const n of w.recNames || []) if (f.recs?.[n]) jobs.push(['recx', f.recs[n]]);
    const n = [w.videoName, w.recName, w.sheetName, ...w.angleNames, ...(w.sourceNames || []), ...(w.sheetNames || []), ...(w.recNames || [])].filter(Boolean).length;
    const missing = n - jobs.length;
    setMsg({ kind: 'info', text: `"${d.title}" 프로젝트를 열었어요.${missing > 0 ? ` 클라우드에 없는 파일 ${missing}개는 직접 넣어주세요.` : ''}` });
    if (!cloud.storage) return;
    for (const [role, r] of jobs) {
      if (openToken.current !== token) return;
      setTransfer({ kind: 'down', name: r.name, pct: 0 });
      try {
        const file = await cloud.downloadFile(r, pct => setTransfer({ kind: 'down', name: r.name, pct }));
        if (openToken.current !== token) return;
        fromCloud.current.add(file);
        if (role === 'video') loadVideo(file, true);
        else if (role === 'angle') loadAngle(file);
        else if (role === 'rec') loadRec(file);
        else if (role === 'source') await addSource(file, true);
        else if (role === 'sheetx') await addSheet(file, true);
        else if (role === 'recx') await addRec(file, true);
        else await loadSheet(file);
      } catch {
        setMsg({ kind: 'warn', text: `${r.name}을(를) 클라우드에서 내려받지 못했어요. 직접 넣어주세요.` });
      }
    }
    setTransfer(null);
  };

  const deleteProjectFull = async (d: ProjectDoc) => {
    if (!cloud) return;
    for (const r of refsOf(d.files)) if (isOrphan(r.path, d.id)) await cloud.deleteFile(r.path).catch(() => {});
    await cloud.deleteProject(d.id);
    if (currentRef.current === d.id) newProject();
  };
  const clearProjectFiles = async (d: ProjectDoc) => {
    if (!cloud) return;
    for (const r of refsOf(d.files)) if (isOrphan(r.path, d.id)) await cloud.deleteFile(r.path).catch(() => {});
    await cloud.setFiles(d.id, {});
    if (currentRef.current === d.id) filesRef.current = {};
    setMsg({ kind: 'ok', text: `"${d.title}"의 클라우드 파일을 지웠어요. 설정은 남아 있어요.` });
  };

  const newProject = () => {
    setProjectsOpen(false);
    clearMedia();
    setProjectState(defaultProject());
    setWant(null); setTitle(''); setCurrentId(null);
    filesRef.current = {}; openToken.current++; pending.current.clear();
    setMsg({ kind: 'info', text: '새 프로젝트' });
  };

  const needList = want ? [
    ...(want.videoName ? [{ label: '연주 영상', name: want.videoName, ok: !!videoName }] : []),
    // 이름이 다른 파일로 바꿔 넣어도(예: 녹음본2.mp3) 그 칸은 채운 것으로
    ...(want.recName ? [{ label: '녹음본', name: recName && recName !== want.recName ? `${recName} (바꿈)` : want.recName, ok: !!recName }] : []),
    ...(want.sheetName ? [{ label: '악보', name: sheet && sheet.name !== want.sheetName ? `${sheet.name} (바꿈)` : want.sheetName, ok: !!sheet }] : []),
    ...want.angleNames.map((n, i) => ({ label: `${i + 2}번 앵글`, name: n, ok: angles.some(a => a.id === n) })),
    ...(want.sourceNames || []).map((n, i) => ({ label: `영상 ${i + 2}`, name: n, ok: sources.some(x => x.id === n) })),
    ...(want.sheetNames || []).map((n, i) => ({ label: `악보 ${i + 2}`, name: n, ok: extraSheets.some(x => x.name === n) })),
    ...(want.recNames || []).map((n, i) => ({ label: `녹음본 ${i + 2}`, name: n, ok: extraRecs.some(x => x.id === n) })),
  ] : [];

  // ---------- 자동 분석 ----------
  /** 지금 재생 위치를 악보 첫 소리 마디의 1박으로 (가까운 타격에 살짝 붙임) */
  const setFirstBeatHere = () => {
    const p = projRef.current, v = videoRef.current; if (!v) return;
    let t = tnow();
    const src = rTrack || vTrack, shift = rTrack ? recAtNow() : mainShift(p, masterDur());   // 녹음본(또는 첫 영상) 시간 → 타임라인 시간
    if (src) {
      let best: number | null = null, bd = 0.08;
      for (const o of src.onsets) { const ot = o.t + shift, d = Math.abs(ot - t); if (o.s > 0.15 && d < bd) { bd = d; best = ot; } }
      if (best !== null) t = best;
    }
    const R = sheet ? leadingRests(sheet) : 0;
    const bar = 1 + p.sheetOffset + R;           // 악보에서 처음 소리 나는 마디
    setProject({ anchorTime: t - (bar - p.anchorBar) * barLen(p), anchorTouched: true });
    setMsg({ kind: 'ok', text: `${fmtTime(t)}를 ${bar}마디 1박으로 맞췄어요.` });
  };
  /** 녹음본 위치를 바꾸면 악보 마디 눈금도 같이 움직임 (박자는 녹음본 소리 기준이라서) */
  /** 녹음본 위치(타임라인)를 at으로 — 마디 눈금도 녹음본 소리 기준이라 같이 움직임 */
  const recPatch = (at: number) => {
    const p = projRef.current, cur = recAtOf(p, masterDur());
    return rTrack ? { recAt: at, anchorTime: p.anchorTime + (at - cur) } : { recAt: at };
  };
  /** 첫 영상 기준 녹음본 어긋남 (녹음본 시간 = 영상 시간 + 이 값) — 화면 표시용 */
  const recOff = () => mainShift(projRef.current, masterDur()) - recAtNow();
  const runSync = (auto = true) => {
    if (!vTrack || !rTrack) return;
    const r = syncOffset(vTrack, rTrack);
    setSyncInfo(r);
    (auto ? setProjectAuto : setProject)(recPatch(mainShift(projRef.current, masterDur()) - r.offset));
    return r;
  };

  // 싱크 + 템포 — 파일이 들어올 때마다 아직 손대지 않은 값만 채운다
  const [autoTick, setAutoTick] = useState(0);
  const [autoReason, setAutoReason] = useState('');
  useEffect(() => {
    if (!vTrack && !rTrack) return;
    const p = projRef.current;
    const locked = !!autoLock.current;   // 다시 연 프로젝트: 저장된 템포·싱크 그대로 (감지값은 참고로만 보여줌)
    let offset = mainShift(p, masterDur()) - recAtOf(p, masterDur());
    if (vTrack && rTrack && !p.syncTouched && !locked) { const r = runSync(); if (r) offset = r.offset; }
    const src = rTrack || vTrack!;
    const tempo = estimateTempo(src.env, { onsets: src.onsets, low: src.low, mid: src.mid, sheetBars: sheet?.bars.length, bpb: p.beatsPerBar });
    setTempoInfo({ bpm: tempo.bpm, suggested: tempo.suggested });
    if (!p.bpmTouched && !locked) setProjectAuto({ bpm: tempo.suggested });
    if (locked) { setAutoTick(n => n + 1); return; }
    const parts: string[] = [`BPM ${p.bpmTouched ? p.bpm : tempo.suggested}`];
    if (vTrack && rTrack) parts.push(`싱크 ${offset >= 0 ? '+' : ''}${offset.toFixed(3)}초`);
    setMsg({ kind: 'ok', text: `자동 감지: ${parts.join(' · ')}` });
    setAutoTick(n => n + 1);
    // eslint-disable-next-line
  }, [vTrack, rTrack, sheet]);   // 악보가 들어오면 악보 길이로 템포를 한 번 더 확인

  /**
   * 마디 위치 자동 판단 (1마디 1박이 영상 몇 초인지)
   * - 악보 앞에 쉼표 마디가 R개면: 첫 소리 = R+1마디 1박
   * - 그 외: 첫 소리 = 1마디 1박 (악보가 없으면 킥이 확실히 다른 박에 몰릴 때만 옮김)
   * 못갖춘마디는 사용자가 "악보 표기 ±1마디"로 맞춘다.
   */
  useEffect(() => {
    const p = projRef.current;
    const src = rTrack || vTrack;
    if (!src || p.anchorTouched) return;   // 손으로 옮긴 마디 눈금은 그대로
    const L = autoLock.current;
    if (L) {
      if (L.bpm === p.bpm && L.bpb === p.beatsPerBar) return;   // 다시 연 프로젝트: 저장된 마디 위치 그대로
      unlockAuto();                                              // 템포·박자를 바꾸면 그때부터 다시 자동
    }
    const shift = rTrack ? recAtOf(p, masterDur()) : mainShift(p, masterDur());   // 녹음본(또는 첫 영상) 시간 → 타임라인 시간
    const f0 = firstStrongBeat(src.onsets, 60 / p.bpm);
    if (f0 === null) return;
    const beat = 60 / p.bpm, bar = beat * p.beatsPerBar;
    // 드럼 킥(1·3박)·스네어(2·4박) 격자로 첫 박 확인: 첫 센 소리가 2박 스네어거나 박 사이(뒷박)면 그 앞 킥 박이 마디 첫 박
    // (첫 박 킥이 작게 녹음되면 2박 스네어부터 잡혀서 늘 한 박 늦게 잡히던 문제)
    const g = p.beatsPerBar % 2 === 0 ? kickGrid(src, p.bpm) : { phase: 0, conf: -1 };
    let fs = f0, back = 0;
    if (g.conf > 0.3) {
      let a = g.phase + Math.floor((f0 + 0.1 * beat - g.phase) / (2 * beat)) * 2 * beat;
      if (f0 - a > 1.9 * beat) a += 2 * beat;
      const d = (f0 - a) / beat;
      if (d >= 0.25) { fs = a; back = d; }
    }
    const f = fs + shift;
    const lead = back >= 0.75 ? '첫 센 소리가 2박(스네어)이라서 한 박 앞을 1박으로 · ' : back > 0 ? '드럼 킥 위치에 맞춰 첫 박을 살짝 앞으로 · ' : '';
    let anchor = f, reason = '';
    if (sheet) {
      const R = leadingRests(sheet);
      if (R > 0) { anchor = f - R * bar; reason = `${lead}악보 1~${R}마디가 쉼표라서 첫 소리를 ${R + 1}마디로 맞췄어요`; }
      else reason = `${lead}첫 소리를 1마디 1박으로 맞췄어요`;
    } else {
      let j = downbeatShift(src, fs, p.bpm, p.beatsPerBar);
      if (g.conf > 0.3 && j % 2 === 1) j = 0;   // 킥·스네어 격자와 어긋나는 쪽으로는 옮기지 않음
      anchor = f + j * beat;
      reason = j > 0 ? `${lead}소리로 판단: 첫 소리 ${j}박 뒤가 1박` : `${lead}첫 소리를 1마디 1박으로 맞췄어요`;
    }
    // 곡 전체 타격에 맞춰 미세 위치 보정
    anchor = refinePhase(src.onsets.map(o => ({ t: o.t + shift, s: o.s })), anchor, beat);
    setProjectAuto({ anchorTime: anchor, anchorBar: 1, anchorTouched: false });
    setAutoReason(reason);
    // eslint-disable-next-line
  }, [autoTick, sheet, project.bpm, project.beatsPerBar]);

  // ---------- 추출 ----------
  const getExportInput = async (r: Ratio = ratio) => {
    let mAudio: AudioBuffer | null = null;
    const f = masterFile.current;
    if (f && !projRef.current.videoMuted) {
      if (masterAudio.current?.file !== f) {
        try { masterAudio.current = { file: f, buf: await decodeVideoAudio(f, ab => new OfflineAudioContext(2, 1, 48000).decodeAudioData(ab)) }; }
        catch { masterAudio.current = null; }
      }
      mAudio = masterAudio.current?.buf || null;
    }
    const sAudio = new Map<string, AudioBuffer | null>();
    if (!projRef.current.videoMuted) for (const x of sourcesRef.current) {
      if (!sourceAudio.current.has(x.file)) {
        let b: AudioBuffer | null = null;
        try { b = await decodeVideoAudio(x.file, ab => new OfflineAudioContext(2, 1, 48000).decodeAudioData(ab)); } catch { /* 소리 없음 */ }
        sourceAudio.current.set(x.file, b);
      }
      sAudio.set(x.id, sourceAudio.current.get(x.file) || null);
    }
    return {
      master: videoRef.current!, angles: anglesRef.current, project: projRef.current, sheet,
      layout: layoutFor(layouts, r), masterAudio: mAudio, recAudio: playerRef.current?.recBuf || null,
      sources: srcMap, sourceAudio: sAudio, sheets: sheetMap, extraRecs: playerRef.current?.extraBufs,
    };
  };

  // ---------- 동작 ----------
  const seek = (t: number) => {
    const tr = transportRef.current!;
    tr.seek(Math.max(0, Math.min(tlEnd || duration || 0, t)));
    setNow(tr.time());
  };

  /** 박(또는 마디) 그리드 단위로 앞뒤 이동 — 그리드 사이에 있으면 가까운 쪽 선부터 */
  const step = (k: number, unit: 'beat' | 'bar') => {
    const p = projRef.current;
    const u = unit === 'beat' ? 1 / p.beatsPerBar : 1;      // 마디 단위 (템포가 바뀌는 곳도 맞게)
    const f = (barAt(p, tnow()) - p.anchorBar) / u;
    const idx = k > 0 ? Math.floor(f + 0.02) + k : Math.ceil(f - 0.02) + k;
    seek(barStart(p, p.anchorBar + idx * u));
  };
  const stepBeats = (k: number) => step(k, 'beat');
  const stepBars = (k: number) => step(k, 'bar');

  const tap = () => {
    const tNow = performance.now();
    const arr = taps.current;
    if (arr.length && tNow - arr[arr.length - 1] > 2000) arr.length = 0;
    arr.push(tNow);
    if (arr.length > 8) arr.shift();
    if (arr.length >= 3) {
      const iv = (arr[arr.length - 1] - arr[0]) / (arr.length - 1);
      setProject({ bpm: Math.round(60000 / iv * 10) / 10, bpmTouched: true });
    }
  };

  const canPlay = hasVideo || !!recName;   // 녹음본만 있어도 재생 (악보·메트로놈 맞춰보기)
  const togglePlay = () => { if (canPlay) { playerRef.current!.ensureCtx(); transportRef.current!.toggle(); } };

  // 잘라낸 구간은 재생할 때 건너뜀
  // (예전 '잘라낸 구간 건너뛰기'는 이제 재생 시계가 조각 단위로 처리)

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); saveNow(); return; }
      if (document.querySelector('.modal-back')) return;
      const el = e.target as HTMLElement;
      const typing = !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'number', 'search'].includes((el as HTMLInputElement).type)));
      // Ctrl+Z 되돌리기, Ctrl+Shift+Z / Ctrl+Y 다시 실행 (한글 입력 상태에서도 되도록 e.code 사용)
      if ((e.ctrlKey || e.metaKey) && !typing && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) redo(); else undo();
        return;
      }
      // Space는 글자 입력 칸만 아니면 어디에 포커스가 있든 재생/정지 (슬라이더·버튼·타임라인 포함)
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        if (!e.repeat) togglePlay();
        if (el && el.tagName !== 'BODY') el.blur?.();
        return;
      }
      if (typing || (el && el.tagName === 'SELECT')) return;
      // Enter = 타임라인 1마디로
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('.modal')) {
        e.preventDefault(); const t1 = Math.max(0, barStart(projRef.current, 1)); transportRef.current?.seek(t1); setNow(t1); if (el && el.tagName !== 'BODY') el.blur?.(); return;
      }
      const p = projRef.current;
      // 녹음본·앵글을 고른 상태에서 Alt+←/→ = 10ms씩 (Shift를 같이 누르면 1ms)
      if (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && selTrack !== 'program' && selTrack !== 'main') {
        e.preventDefault();
        const d = (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.001 : 0.01);
        if (selTrack === 'rec') setProject({ ...recPatch(Math.round((recAtNow() + d) * 1000) / 1000), syncTouched: true });
        else setProject({ angleOffsets: { ...projRef.current.angleOffsets, [selTrack]: Math.round(((projRef.current.angleOffsets[selTrack] || 0) - d) * 1000) / 1000 } });
        return;
      }
      if (e.code === 'Escape' && pickRange) { setPickRange(null); setExportOpen(true); return; }
      if (e.code === 'Escape' && cropMode) { setCropMode(false); return; }
      if (e.code === 'Escape' && selTrack !== 'program') { setSelTrack('program'); setInOut({ a: null, b: null }); return; }
      if (e.code === 'KeyC' && e.shiftKey && !e.ctrlKey && !e.metaKey && hasVideo) { e.preventDefault(); addCaption(); return; }
      if ((e.code === 'KeyP' || e.code === 'KeyF' || e.code === 'KeyH') && !e.ctrlKey && !e.metaKey && !e.altKey && hasVideo) {
        addPunchAt(tnow(), e.code === 'KeyP' ? 'punch' : e.code === 'KeyF' ? 'flash' : 'shake'); return;
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && selFx && !selCaption) {
        const f = getFx(projRef.current);
        if (selFx.kind === 'punch') setFx({ punches: f.punches.filter(x => x.id !== selFx.id) }); else setFx({ zooms: f.zooms.filter(x => x.id !== selFx.id) });
        setSelFx(null); return;
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && selCaption) { deleteCaption(selCaption); return; }
      if ((e.ctrlKey || e.metaKey) && e.code.startsWith('Arrow')) return;   // Cmd/Ctrl+화살표는 타임라인 확대·축소
      if (e.code === 'ArrowRight') { e.preventDefault(); e.shiftKey ? stepBars(1) : stepBeats(1); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? stepBars(-1) : stepBeats(-1); }
      else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.code === 'KeyT') tap();
      else if (e.code === 'KeyB' && hasVideo) setFirstBeatHere();
      else if (e.code === 'KeyM') setProject({ clickOn: !p.clickOn });
      else if (/^Digit[1-9]$/.test(e.code) || /^Numpad[1-9]$/.test(e.code)) switchAngle(parseInt(e.code.slice(-1), 10) - 1);
    };
    // 버튼에 포커스가 있을 때 Space를 떼면 버튼이 눌리는 기본 동작 막기 (재생이 두 번 토글되는 문제)
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space' && (e.target as HTMLElement)?.tagName === 'BUTTON') e.preventDefault(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); };
  });

  const tplView = cloud
    ? cloudTemplates.map(t => ({ key: t.id, name: t.name, layouts: t.layouts, by: t.createdByName, canDelete: admin || t.createdByUid === user?.uid, remove: () => { cloud.deleteTemplate(t.id); } }))
    : templates.map(t => ({ key: t.name, name: t.name, layouts: t.layouts, by: '', canDelete: true, remove: () => setTemplates(ts => ts.filter(x => x.name !== t.name)) }));

  // 지금 보이는 앵글의 영상 배치
  const viewTrack = selTrack === 'main' || angles.some(a => a.id === selTrack) ? selTrack : null; // 미리보기에서 단독으로 볼 영상
  // 크기·자르기를 맞출 영상: 영상 줄에서 조각을 골랐으면 그 조각의 영상 (이어 붙인 영상마다 따로), 앵글을 골랐으면 그 앵글, 아니면 지금 화면의 영상
  const pickedSrc = selTrack === 'main' && selClipSrc && sources.some(x => x.id === selClipSrc) ? selClipSrc : null;
  const curSrcId = pickedSrc || viewTrack || (hasVideo ? activeSource(videoRef.current!, angles, project, now, srcMap).id : MAIN);
  const curXf = getXf(project, ratio, curSrcId);
  const curNum = curSrcId === MAIN ? 1 : angles.findIndex(a => a.id === curSrcId) + 2;
  const curSrcName = sources.find(x => x.id === curSrcId)?.name;
  const setCurXf = (xf: VideoXf) => setProject({ frames: withXf(projRef.current, ratio, curSrcId, xf) });

  // ---------- 효과 ----------
  const fx = getFx(project);
  // 타임라인 길이: 영상 조각들 끝 · 녹음본 끝 중 늦은 쪽 (녹음본이 메인이라 영상보다 길 수 있음)
  const recEnd = rTrack ? recAtOf(project, duration) + Math.min(rTrack.duration, project.trims?.rec?.out ?? rTrack.duration) : 0;
  // 악보를 여러 개 넣었으면 뒤 악보가 끝나는 곳까지 (영상·녹음본보다 길게 이어 놓았을 때도 보이게)
  const sheetsEnd = extraSheets.length && sheet ? Math.max(0, ...sheetClipsOf(project, sheet.bars.length).map(c => sheetClipEnd(project, c))) : 0;
  const xrecEnd = Math.max(0, ...(project.recClips || []).map(c => { const d = recDurOf(c.src); return d ? c.at + trimOf(project, recKeyOf(c), d).out : 0; }));
  const tlEnd = Math.max(timelineEnd(project, duration), recEnd, sheetsEnd, xrecEnd);

  // ---------- 타임라인 앞쪽 빈 구간 없애기 ----------
  // 모든 요소가 0초보다 뒤에서 시작하면(예: 전체를 오른쪽으로 옮긴 뒤) 전체를 같이 당겨서 맨 앞 요소가 0초에 오게 (서로의 위치는 그대로)
  const ptrDown = useRef(false);
  const [normTick, setNormTick] = useState(0);
  const [viewShift, setViewShift] = useState({ n: 0, dt: 0 });
  useEffect(() => {
    const d = () => { ptrDown.current = true; };
    const u = () => { if (ptrDown.current) { ptrDown.current = false; setNormTick(n => n + 1); } };
    window.addEventListener('pointerdown', d, true); window.addEventListener('pointerup', u, true); window.addEventListener('pointercancel', u, true);
    return () => { window.removeEventListener('pointerdown', d, true); window.removeEventListener('pointerup', u, true); window.removeEventListener('pointercancel', u, true); };
  }, []);
  /** 맨 앞 요소 시각: media = 영상·녹음본만, all = 자막·효과·악보까지 */
  const contentFirst = (p: Project) => {
    const xs: number[] = [];
    if (videoName || p.clips?.length) for (const c of clipsOf(p, masterDur())) if (clipEnd(c) - c.start > 0.01) xs.push(c.start);
    if (rTrack) { const tr = trimOf(p, 'rec', rTrack.duration); if (tr.out - tr.in > 0.01) xs.push(recAtOf(p, masterDur()) + tr.in); }
    for (const c of p.recClips || []) { const d = recDurOf(c.src); if (d) { const tr = trimOf(p, recKeyOf(c), d); if (tr.out - tr.in > 0.01) xs.push(c.at + tr.in); } }
    const media = xs.length ? Math.min(...xs) : NaN;
    if (sheet) for (const c of sheetClipsOf(p, sheet.bars.length)) xs.push(c.start);
    for (const c of p.captions || []) xs.push(c.start);
    const fx = getFx(p);
    for (const z of fx.zooms) xs.push(z.start);
    for (const u of fx.punches) xs.push(u.t);
    return { media, all: xs.length ? Math.min(...xs) : NaN };
  };
  const filesReady = !want || needList.every(x => x.ok);
  useEffect(() => {
    if (ptrDown.current || playing || transfer || !filesReady) return;
    const id = setTimeout(() => {
      if (ptrDown.current || transportRef.current?.playing) return;
      const p = projRef.current, f = contentFirst(p);
      // 앞에 빈 구간이 있으면 당기고, 녹음본·영상이 0초보다 앞에서 시작하면(들을 수 없는 부분) 그만큼 뒤로 밀어서 처음부터 다 보이게
      const first = f.all > 0.05 ? f.all : f.media < -0.05 ? f.media : NaN;
      if (!isFinite(first)) return;
      const dt = Math.round(first * 1000) / 1000;
      setProjectAuto(shiftProject(p, masterDur(), -dt));
      const tr = transportRef.current; if (tr) tr.seek(Math.max(0, tr.time() - dt));
      setViewShift(v => ({ n: v.n + 1, dt }));
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line
  }, [project, normTick, playing, transfer, filesReady, rTrack, extraRecs.length, duration, sheet]);
  endRef.current = tlEnd;
  const setFx = (patch: Partial<Fx>) => setProject({ fx: { ...getFx(projRef.current), ...patch } });
  const [rightTab, setRightTab] = useState<'screen' | 'fx'>('screen');
  const [selCut, setSelCut] = useState<number | null>(null);
  const [selFx, setSelFx] = useState<{ kind: 'zoom' | 'punch'; id: string } | null>(null);
  const [stampKind, setStampKind] = useState<MarkKind>('punch');
  const addPunchAt = (t: number, kind?: MarkKind) => {
    const f = getFx(projRef.current), k = kind || stampKind;
    const pu: Punch = { id: 'p' + Date.now().toString(36), t: Math.max(0, t), amt: MARK_AMT[k].def, kind: k };
    setFx({ punches: [...f.punches, pu].sort((a, b) => a.t - b.t) });
    setSelFx({ kind: 'punch', id: pu.id }); setStampKind(k);
  };
  /** 지금 위치부터 n마디 구간 (타임라인 끝을 넘으면 끝에 맞춰 앞으로 당김 · 템포가 바뀌는 곳도 맞게) */
  const spanHere = (bars: number): [number, number] => {
    const p = projRef.current, end = endRef.current || tlEnd || duration || 0;
    let a = Math.max(0, snapTime(p, tnow()));
    let b = barStart(p, barAt(p, a) + bars);
    if (end > 0 && b > end) { b = end; a = Math.max(0, Math.min(a, snapTime(p, barStart(p, barAt(p, end) - bars)))); if (b - a < 0.5) a = Math.max(0, b - bars * barLen(p, b)); }
    return [a, b];
  };
  const addZoom = () => {
    const p = projRef.current, f = getFx(p);
    const [t0, t1] = spanHere(2);
    const z = { id: 'z' + Date.now().toString(36), start: t0, end: t1, from: 1, to: 1.12 };
    // 예전에 영상 끝 뒤에서 넣어서 길이가 0 이하로 저장된(타임라인에 안 보이던) 구간은 정리
    setFx({ zooms: [...f.zooms.filter(x => x.end - x.start > 0.05), z].sort((a, b) => a.start - b.start) });
    setSelFx({ kind: 'zoom', id: z.id }); setRightTab('fx');
  };
  useEffect(() => { if (selCut !== null && selCut >= project.cuts.length) setSelCut(null); }, [project.cuts.length]);
  const onLogo = async (f: File) => {
    try {
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      setFx({ logo: c.toDataURL('image/png'), watermark: { ...fx.watermark, on: true } });
    } catch { setMsg({ kind: 'warn', text: '이미지를 읽지 못했어요. png나 jpg 파일을 넣어주세요.' }); }
  };
  const selCutInfo = selCut !== null && project.cuts[selCut] ? (() => {
    const c = project.cuts[selCut]; const { bar, beat } = barBeat(project, c.t + 1e-4);
    return { cut: c, where: bar >= 1 ? `${bar}마디 ${beat + 1}박` : fmtTime(c.t) };
  })() : null;
  const setCutTr = (tr: Cut['tr'] | null) => {
    if (selCut === null) return;
    setProject({ cuts: projRef.current.cuts.map((c, i) => i === selCut ? (tr ? { ...c, tr } : { t: c.t, angle: c.angle }) : c) });
  };

  // ---------- 자막 ----------
  const captions = project.captions || [];
  const capStyle = captionStyleOf(project, ratio);
  const setCaptions = (list: Caption[]) => setProject({ captions: [...list].sort((a, b) => a.start - b.start) });
  const setCapStyle = (st: CaptionStyle) => setProject({ captionStyles: { ...(projRef.current.captionStyles || {} as any), [ratio]: st } });
  const addCaption = (text?: string) => {
    const p = projRef.current;
    const [t0, t1] = spanHere(1);
    const c: Caption = { id: 'c' + Date.now().toString(36), start: t0, end: t1, text: typeof text === 'string' ? text : '' };
    // 등장 효과 기본값은 팝: 예전에 저장된 프로젝트(기본이 '없음')에서도 새로 넣는 자막은 팝으로
    if (captionStyleOf(p, ratio).anim === 'none') c.style = { anim: 'pop' };
    setCaptions([...(p.captions || []), c]);
    setSelCaption(c.id);
    setStudioOpen(true);
    if (typeof text !== 'string') setCapFocus(k => k + 1);   // 입력창에 바로 쓰는 중이면 포커스 그대로
  };
  const updateCaption = (id: string, patch: Partial<Caption>) => setCaptions((projRef.current.captions || []).map(c => c.id === id ? { ...c, ...patch } : c));
  const deleteCaption = (id: string) => { setCaptions((projRef.current.captions || []).filter(c => c.id !== id)); setSelCaption(null); };
  const editCaption = (id: string) => { setSelCaption(id); setStudioOpen(true); setCapFocus(k => k + 1); };
  const selCap = captions.find(c => c.id === selCaption) || null;
  useEffect(() => { setCapScope('one'); setPosScope('one'); }, [selCaption]);   // 다른 자막을 고르면 다시 '이 자막만'
  const capEditStyle = selCap ? styleFor(project, ratio, selCap) : capStyle;
  /** 글꼴·위치는 늘 공통, 나머지(색·테두리·그림자·상자·등장 효과)는 capScope대로 — 기본은 이 자막만 */
  const applyCapPatch = (patch: Partial<CaptionStyle>, id: string | null) => {
    const p = projRef.current, shared: any = {}, look: any = {};
    for (const k of Object.keys(patch) as (keyof CaptionStyle)[]) ((CAP_SHARED.includes(k) ? shared : look) as any)[k] = patch[k];
    let common = captionStyleOf(p, ratio), caps = p.captions || [];
    // 위치: '이 자막만'이면 그 자막에만 (화면 비율별), '모든 자막에'면 공통 위치로 하고 자막마다 따로 둔 위치는 지움
    if ('x' in shared || 'y' in shared) {
      const pos: { x?: number; y?: number } = {};
      if ('x' in shared) pos.x = shared.x; if ('y' in shared) pos.y = shared.y;
      delete shared.x; delete shared.y;
      if (id && posScope === 'one') {
        caps = caps.map(c => { if (c.id !== id) return c; const cur = ownPos(c, ratio) || { x: common.x, y: common.y }; return { ...c, pos: { ...(c.pos || {}), [ratio]: { ...cur, ...pos } } }; });
      } else {
        common = { ...common, ...pos };
        caps = caps.map(c => { if (!c.pos?.[ratio]) return c; const np = { ...c.pos }; delete np[ratio]; return Object.keys(np).length ? { ...c, pos: np } : (({ pos: _p, ...r }) => r as Caption)(c); });
      }
    }
    common = { ...common, ...shared };
    if (Object.keys(look).length) {
      if (id && capScope === 'one') caps = caps.map(c => c.id === id ? { ...c, style: { ...(ownLook(c) || {}), ...look } } : c);
      else {
        common = { ...common, ...look };
        if (id) caps = caps.map(c => {
          const o: any = ownLook(c); if (!o) return c.style ? (({ style, ...r }) => r as Caption)(c) : c;
          for (const k of Object.keys(look)) delete o[k];
          if (!Object.keys(o).length) { const { style, ...r } = c; return r as Caption; }
          return { ...c, style: o };
        });
      }
    }
    setProject({ captionStyles: { ...(p.captionStyles || {} as any), [ratio]: common }, captions: caps });
  };
  const setCapPatch = (patch: Partial<CaptionStyle>) => {
    applyCapPatch(patch, selCap?.id || null);
    if (patch.font || patch.weight) (document as any).fonts?.load?.(`${patch.weight || capEditStyle.weight} 40px "${patch.font || capEditStyle.font}"`, '가나다').catch(() => {});
  };
  /** 이 자막만의 꾸미기를 지우고 공통 꾸미기로 */
  const resetCapLook = () => {
    if (!selCap) return;
    const { style, ...rest } = selCap; setCaptions((projRef.current.captions || []).map(c => c.id === selCap.id ? rest as Caption : c));
  };
  /** 이 자막만의 위치를 지우고 공통 위치로 (지금 화면 비율) */
  const resetCapPos = () => {
    if (!selCap?.pos) return;
    const np = { ...selCap.pos }; delete np[ratio]; if (ratio === '9:16') delete np['4:5'];
    setCaptions((projRef.current.captions || []).map(c => c.id === selCap.id ? (Object.keys(np).length ? { ...c, pos: np } : (({ pos: _p, ...r }) => r as Caption)(c)) : c));
  };
  /** 미리보기에서 자막을 끌어 옮김 — 개별 스타일이 있으면 그 자막만, 아니면 공통 */
  const moveCaption = (id: string, x: number, y: number) => {
    applyCapPatch({ x, y }, id);
  };

  const viewNum = viewTrack ? (viewTrack === MAIN ? 1 : angles.findIndex(a => a.id === viewTrack) + 2) : 0;
  const setMark = (k: 'a' | 'b') => {
    const t = Math.max(0, snapTime(projRef.current, tnow()));
    setInOut(io => ({ ...io, [k]: t }));
  };
  /** 보고 있는 앵글을 지금 위치부터 결과물에 넣기 */
  const insertHere = () => {
    if (!viewTrack) return;
    const p = projRef.current;
    const t = Math.max(0, snapTime(p, tnow()));
    setProject({ cuts: setCutAt(p.cuts, t, viewTrack) });
    setMsg({ kind: 'ok', text: `${fmtTime(t)}부터 ${viewNum}번 앵글을 넣었어요` });
  };
  /** 보고 있는 앵글을 시작~끝 구간에만 넣고, 끝난 뒤엔 원래 앵글로 */
  const insertRange = () => {
    if (!viewTrack || inOut.a === null || inOut.b === null) return;
    const a = Math.min(inOut.a, inOut.b), b = Math.max(inOut.a, inOut.b);
    if (b - a < 0.05) return;
    const p = projRef.current;
    const after = angleAt(p.cuts, b + 1e-4);
    const rest = p.cuts.filter(c => c.t < a - 1e-3 || c.t > b + 1e-3);
    const cuts = normalizeCuts([...rest, { t: a, angle: viewTrack }, ...(b < duration - 0.05 ? [{ t: b, angle: after }] : [])]);
    setProject({ cuts });
    setInOut({ a: null, b: null });
    setMsg({ kind: 'ok', text: `${fmtTime(a)}~${fmtTime(b)} 구간에 ${viewNum}번 앵글을 넣었어요` });
  };

  const layout = layoutFor(layouts, ratio);
  const setLayout = (l: CardLayout) => { record(); setLayouts(ls => ({ ...ls, [ratio]: l })); };

  const bb = barBeat(project, now);
  const nBars = sheet?.bars.length || 0;
  const sheetSpan = nBars ? [sheetStart(project, nBars), sheetEnd(project, nBars)] : null;
  const nudgeSync = (d: number) => setProject({ ...recPatch(Math.round((recAtNow() - d) * 1000) / 1000), syncTouched: true });

  return (
    <div className="app">
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        className="hidden-video"
        onLoadedMetadata={e => {
          const v = e.currentTarget;
          setDuration(v.duration || 0);
          if (!v.videoWidth) {
            setMsg({ kind: 'warn', text: '이 PC의 크롬에서는 영상 화면을 재생할 수 없어요 (아이폰 HEVC 형식일 가능성이 커요). 아이폰 설정 › 카메라 › 포맷 › "높은 호환성"으로 찍거나, 다음 업데이트의 자동 변환을 기다려주세요.' });
          } else setHasVideo(true);
        }}
        onError={() => setMsg({ kind: 'warn', text: '영상을 열 수 없어요. 아이폰 HEVC 형식이라면 설정 › 카메라 › 포맷 › "높은 호환성"으로 찍은 영상을 넣어주세요.' })}
      />

      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true"><i /><i /><i /><i /></span>
          <h1>연주 영상 편집기</h1>
        </div>
        {cloud && user && (
          <div className="cloudbar">
            <button type="button" className="btn sm" onClick={() => setProjectsOpen(true)}>프로젝트</button>
            <input id="pj-title-input" className="title-input" type="text" value={title} placeholder="제목 없는 프로젝트" aria-label="프로젝트 제목"
              disabled={!currentId}
              onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <span className={`save ${saveState.s}`}>
              {!currentId ? '영상을 넣으면 저장 시작' : remoteEdit ? '다른 컴퓨터에서 고침 · 아래에서 골라 주세요'
                : transfer ? `${transfer.kind === 'up' ? '업로드' : '내려받는 중'} ${Math.round(transfer.pct * 100)}% · ${transfer.name}`
                : saveState.s === 'saving' ? '저장 중…' : saveState.s === 'error' ? '저장 실패 · 인터넷 확인'
                : saveState.s === 'saved' ? `저장됨 · ${new Date(saveState.at).toTimeString().slice(0, 5)}` : '저장됨'}
            </span>
            <button type="button" className="btn sm" onClick={saveNow} disabled={!currentId || saveState.s === 'saving'} title="지금 저장 (Ctrl+S)">저장</button>
          </div>
        )}
        <div className="undo" data-v={histVer}>
          <button type="button" className="btn ghost sm" onClick={undo} disabled={!hist.current.past.length} title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
          <button type="button" className="btn ghost sm" onClick={redo} disabled={!hist.current.future.length} title="다시 실행 (Ctrl+Shift+Z)">↷</button>
        </div>
        {cloud && user && (
          <div className="userchip">
            {user.photo ? <img src={user.photo} alt="" width="24" height="24" referrerPolicy="no-referrer" /> : <span className="avatar">{user.name.slice(0, 1)}</span>}
            <span className="uname">{user.name}{admin && !cloud.open && <small> · 관리자</small>}</span>
            <button type="button" className="link small" onClick={() => cloud.signOut()}>로그아웃</button>
          </div>
        )}
        <div className={`status ${msg?.kind || ''}`} role="status" aria-live="polite">{msg?.text || ''}</div>
      </header>

      <aside className="panel left">
        <section>
          <h2>파일</h2>
          <FileSlot id="f-video" label="연주 영상 1 (앵글 기준)" hint="mov · mp4" accept="video/*,.mov,.mp4,.m4v,.webm" name={videoName || (want ? `필요: ${want.videoName}` : '')} onFile={f => loadVideo(f, !!wantRef.current)} />
          {sources.length > 0 && (
            <div className="src-list">
              {sources.map((x, i) => (
                <div key={x.id} className="src-item">
                  <span className="src-num">영상 {i + 2}</span>
                  <span className="src-name" title={x.name}>{x.name}</span>
                  {!x.track ? <span className="dim small">분석 중</span> : rTrack && <button type="button" className="link small" onClick={() => resyncSource(x.id)} title="이 영상의 소리를 녹음본에 다시 맞춰요">녹음본에 맞추기</button>}
                  <button type="button" className="link small danger" onClick={() => removeSource(x.id)}>빼기</button>
                </div>
              ))}
            </div>
          )}
          <label className="slot" htmlFor="f-source">
            <input id="f-source" type="file" multiple accept="video/*,.mov,.mp4,.m4v,.webm"
              onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; let taken = !!videoName; for (const f of fs) { routeVideo(f, taken); taken = true; } }} />
            <span className="slot-label">영상 추가</span>
            <span className="slot-name">{rTrack ? '녹음본 소리에 맞춰 놓거나, 맨 뒤에 이어 붙여요' : 'mov · mp4 · 여러 개 가능'}</span>
            <span className="slot-act">열기</span>
          </label>
          <FileSlot id="f-rec" label={extraRecs.length ? '녹음본 1 (템포 기준)' : '녹음본'} hint="mp3 · wav" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav" name={recName} onFile={loadRec} />
          {extraRecs.length > 0 && (
            <div className="src-list">
              {extraRecs.map((x, i) => (
                <div key={x.id} className="src-item">
                  <span className="src-num">녹음본 {i + 2}</span>
                  <span className="src-name" title={x.id}>{x.id}</span>
                  {x.track && (vTrack || sources.some(v => v.track)) && <button type="button" className="link small" onClick={() => resyncRec(x.id)} title="이 녹음본을 영상 소리에 다시 맞춰요">영상에 맞추기</button>}
                  <button type="button" className="link small danger" onClick={() => removeRec(x.id)}>빼기</button>
                </div>
              ))}
            </div>
          )}
          {recName && (
            <label className="slot" htmlFor="f-rec2">
              <input id="f-rec2" type="file" multiple accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav"
                onChange={async e => { const fs = Array.from(e.target.files || []); e.target.value = ''; for (const f of fs) await addRec(f); }} />
              <span className="slot-label">녹음본 추가</span>
              <span className="slot-name">영상 소리에 맞춰 놓거나, 앞 녹음본 뒤에 이어 붙여요</span>
              <span className="slot-act">열기</span>
            </label>
          )}
          <FileSlot id="f-sheet" label="악보" hint="pdf · 캡처 이미지(여러 장 가능)" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" name={sheet?.name || ''} onFile={loadSheet}
            onFiles={async fs => {
              const imgs = fs.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name));
              if (imgs.length < 2) { loadSheet(fs[0]); return; }
              setMsg({ kind: 'busy', text: `캡처 ${imgs.length}장을 순서대로 이어 붙이는 중…` });
              try { loadSheet(await stitchImages(imgs.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })))); }
              catch (e: any) { setMsg({ kind: 'warn', text: e?.message || '이미지를 읽지 못했어요.' }); }
            }} />
          {extraSheets.length > 0 && (
            <div className="src-list">
              {extraSheets.map((x, i) => {
                const c = (project.sheetClips || []).find(k => k.sheet === x.name);
                return (
                  <div key={x.name} className="src-item">
                    <span className="src-num">악보 {i + 2}</span>
                    <span className="src-name" title={x.name}>{x.name}</span>
                    <span className="dim small">{x.bars.length}마디</span>
                    <button type="button" className="link small danger" onClick={() => removeSheet(x.name)}>빼기</button>
                    {c && (
                      <div className="src-bpm">
                        <BpmBox id={`sheet-bpm-${i + 2}`} label="이 악보부터" bpm={c.bpm} base={bpmAt(project, c.start - 1e-3)} onBpm={b => setSheetBpm(c.id, b)} />
                        <button type="button" className="btn ghost sm" onClick={() => findSheetTempo(c.id)} disabled={!rTrack && !vTrack} title="녹음본에서 이 악보 구간의 소리를 듣고 템포를 찾아 넣어요">소리로 찾기</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {sheet && (
            <label className="slot" htmlFor="f-sheet2">
              <input id="f-sheet2" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addSheet(f); }} />
              <span className="slot-label">악보 추가</span>
              <span className="slot-name">앞 악보 뒤에 이어 붙여요 · 템포가 다르면 아래 목록에서 BPM 입력</span>
              <span className="slot-act">열기</span>
            </label>
          )}
        </section>

        <section>
          <h2>멀티 앵글</h2>
          {videoName && (
            <div className="angles">
              <AngleCard num={1} color={ANGLE_COLORS[0]} name={videoName} video={videoRef.current} active={angleAt(project.cuts, now) === MAIN}
                onPick={() => switchAngle(0)} main />
              {angles.map((a, i) => (
                <AngleCard key={a.id} num={i + 2} color={ANGLE_COLORS[(i + 1) % ANGLE_COLORS.length]} name={a.name} video={a.video}
                  active={angleAt(project.cuts, now) === a.id} onPick={() => switchAngle(i + 1)}
                  offset={project.angleOffsets[a.id]} confidence={a.confidence} analyzing={!a.track}
                  onNudge={d => setProject({ angleOffsets: { ...project.angleOffsets, [a.id]: (project.angleOffsets[a.id] || 0) + d } })}
                  onResync={() => resyncAngle(a)} onRemove={() => removeAngle(a)} />
              ))}
            </div>
          )}
          <label className="slot" htmlFor="f-angle">
            <input id="f-angle" type="file" multiple accept="video/*,.mov,.mp4,.m4v,.webm" disabled={!videoName}
              onChange={e => { Array.from(e.target.files || []).forEach(loadAngle); e.target.value = ''; }} />
            <span className="slot-label">앵글 추가</span>
            <span className="slot-name">{videoName ? 'mov · mp4' : '연주 영상을 먼저 넣어주세요'}</span>
            <span className="slot-act">열기</span>
          </label>
          {angles.length > 0 && (
            <>
              <div className="field">
                <label>바뀌는 위치 맞춤</label>
                <div className="seg small">
                  {([['bar', '마디'], ['beat', '박'], ['off', '그대로']] as [CutSnap, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={project.cutSnap === k ? 'on' : ''} onClick={() => setProject({ cutSnap: k })}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>화면 구성 넣기 (지금 위치부터)</label>
                <div className="chips">
                  {(['split2', 'quad', 'pip'] as const).map(id => <button key={id} type="button" onClick={() => insertLayout(id)} disabled={!hasVideo}>{LAYOUT_LABEL[id]}</button>)}
                </div>
              </div>
              <div className="row tight">
                <select id="auto-n" aria-label="자동 전환 간격" value={autoN} onChange={e => setAutoN(parseInt(e.target.value, 10))}>
                  {[1, 2, 4, 8].map(n => <option key={n} value={n}>{n}마디마다</option>)}
                </select>
                <button type="button" className="btn sm" onClick={autoSwitch}>자동 전환</button>
              </div>
              <div className="row tight">
                <button type="button" className="btn sm" disabled={cmBusy || !hasVideo} onClick={matchColors} title="기준 영상의 밝기·색에 다른 앵글을 맞춰요">{cmBusy ? '색 비교 중…' : fx.colorMatch.on ? '색 다시 맞추기' : '앵글 색 맞추기'}</button>
                {Object.keys(fx.colorMatch.m).length > 0 && (
                  <label className="switch"><input id="cm-on" type="checkbox" checked={fx.colorMatch.on} onChange={e => setFx({ colorMatch: { ...fx.colorMatch, on: e.target.checked } })} /><span>색 맞춤 켜기</span></label>
                )}
              </div>
              <div className="row">
                <span className="note">앵글 전환 {project.cuts.length}곳</span>
                <button type="button" className="btn ghost sm" disabled={!project.cuts.length} onClick={() => setProject({ cuts: [] })}>모두 지우기</button>
              </div>
            </>
          )}
        </section>

        <section>
          <h2>소리</h2>
          <TrackRow label="영상 소리" color="var(--wave-v)" on={!project.videoMuted} vol={project.videoVol} disabled={!videoName}
            onToggle={() => setProject({ videoMuted: !project.videoMuted })} onVol={v => setProject({ videoVol: v })} id="vol-v" />
          <TrackRow label="녹음본" color="var(--wave-r)" on={!project.recMuted} vol={project.recVol} disabled={!recName}
            onToggle={() => setProject({ recMuted: !project.recMuted })} onVol={v => setProject({ recVol: v })} id="vol-r" />
          <div className="field">
            <label>녹음본 싱크</label>
            <div className="row">
              <button type="button" className="btn ghost sm" onClick={() => nudgeSync(-0.01)} disabled={!recName}>−10ms</button>
              <output className="mono big">{recOff() >= 0 ? '+' : ''}{recOff().toFixed(3)}초</output>
              <button type="button" className="btn ghost sm" onClick={() => nudgeSync(0.01)} disabled={!recName}>+10ms</button>
            </div>
            <div className="row">
              <button type="button" className="btn sm" disabled={!vTrack || !rTrack} onClick={() => { const r = runSync(false); setProjectAuto({ syncTouched: false }); if (r) setMsg({ kind: 'ok', text: `자동 싱크: 녹음본이 영상보다 ${Math.abs(r.offset).toFixed(3)}초 ${r.offset >= 0 ? '늦게' : '먼저'} 시작해요.` }); }}>자동 맞춤</button>
              {syncInfo && <span className={`chip ${syncInfo.confidence > 1.5 ? 'good' : 'warn'}`}>{syncInfo.confidence > 1.5 ? '확실함' : '확인 필요'}</span>}
            </div>
          </div>
        </section>

        <section>
          <h2>템포</h2>
          <div className="field">
            <label htmlFor="bpm">BPM</label>
            <div className="row">
              <input id="bpm" className="mono big-input" type="number" step="0.1" min="30" max="300" value={bpmText ?? String(project.bpm)}
                onChange={e => { const t = e.target.value; setBpmText(t); const v = parseFloat(t); if (v >= 30 && v <= 300) setProject({ bpm: v, bpmTouched: true }); }}
                onBlur={() => setBpmText(null)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
              <button type="button" className="btn sm" onClick={tap} title="박자에 맞춰 여러 번 누르세요 (T)">탭</button>
              <select id="bpb" aria-label="박자" value={project.beatsPerBar} onChange={e => setProject({ beatsPerBar: parseInt(e.target.value, 10) })}>
                {[2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}/4</option>)}
              </select>
            </div>
            {tempoInfo && tempoInfo.suggested !== project.bpm && <p className="note">감지 {tempoInfo.bpm.toFixed(2)} → <button type="button" className="link" onClick={() => setProject({ bpm: tempoInfo.suggested, bpmTouched: false })}>{tempoInfo.suggested} 적용</button></p>}
            <div className="row tight">
              <span className="small dim">2배·절반으로 잡혔으면</span>
              <button type="button" className="btn ghost xs" onClick={() => setProject({ bpm: Math.round(project.bpm / 2 * 100) / 100, bpmTouched: true })} title="템포 절반으로">½</button>
              <button type="button" className="btn ghost xs" onClick={() => setProject({ bpm: Math.round(project.bpm * 2 * 100) / 100, bpmTouched: true })} title="템포 2배로">×2</button>
              <button type="button" className="btn ghost xs" onClick={() => setProject({ bpm: Math.round(project.bpm * 3 / 4 * 100) / 100, bpmTouched: true })} title="템포 3/4로 (셋잇단을 16분으로 잘못 잡았을 때)">¾</button>
            </div>
          </div>
          <label className="switch">
            <input id="click" type="checkbox" checked={project.clickOn} onChange={e => setProject({ clickOn: e.target.checked })} />
            <span>메트로놈 미리듣기 <em>(M)</em></span>
          </label>
        </section>

        <section>
          <h2>마디 위치</h2>
          <div className="anchor-now">
            <span className="mono">1마디 1박 = {project.anchorTime < 0 ? `영상 시작 ${(-project.anchorTime).toFixed(2)}초 전` : fmtTime(project.anchorTime)}</span>
          </div>
          <div className="field">
            <label>악보 박자 맞추기 <span className="dim small">악보가 소리보다 빠르면 +, 느리면 −</span></label>
            <div className="row tight wrap">
              <button type="button" className="btn ghost sm" onClick={() => setProject({ anchorTime: project.anchorTime - 60 / project.bpm, anchorTouched: true })} title="한 박 당기기">−1박</button>
              <button type="button" className="btn ghost sm" onClick={() => setProject({ anchorTime: Math.round((project.anchorTime - 0.01) * 1000) / 1000, anchorTouched: true })}>−10ms</button>
              <button type="button" className="btn ghost sm" onClick={() => setProject({ anchorTime: Math.round((project.anchorTime + 0.01) * 1000) / 1000, anchorTouched: true })}>+10ms</button>
              <button type="button" className="btn ghost sm" onClick={() => setProject({ anchorTime: project.anchorTime + 60 / project.bpm, anchorTouched: true })} title="한 박 미루기">+1박</button>
            </div>
            <button type="button" className="btn sm accent" disabled={!hasVideo} onClick={setFirstBeatHere} title="연주가 시작되는 첫 박에 재생 위치를 두고 누르세요 (B)">지금 위치가 첫 박 (B)</button>
            <button type="button" className="link small" disabled={!vTrack && !rTrack} onClick={() => { unlockAuto(); setProjectAuto({ anchorTouched: false }); projRef.current = { ...projRef.current, anchorTouched: false }; setAutoTick(n => n + 1); setMsg({ kind: 'ok', text: '마디 위치를 소리에 맞춰 다시 찾았어요.' }); }}>소리에 맞춰 자동으로 다시 찾기</button>
          </div>
          {nBars > 0 && sheetSpan && (
            duration && sheetSpan[1] > duration + barLen(project) ? <p className="note warn-text">영상보다 악보가 길어요</p> : null
          )}
        </section>
      </aside>

      <main className="center">
        <div className="center-row">
        {studioOpen ? (
          <CaptionStudio captions={captions} sel={selCap} onSelect={setSelCaption} onAdd={addCaption} onUpdate={updateCaption} onDelete={deleteCaption}
            onSeek={seek} now={tnow} style={capEditStyle} scope={capScope} setScope={setCapScope} posScope={posScope} setPosScope={setPosScope} hasOwnPos={!!(selCap && ownPos(selCap, ratio))} onResetPos={resetCapPos} hasOwn={!!(selCap && ownLook(selCap))} onResetLook={resetCapLook} setStyle={setCapPatch}
            onClose={() => setStudioOpen(false)} focusKey={capFocus} disabled={!hasVideo} />
        ) : null}
        <div className="stage-wrap" ref={stageRef}>
          {!studioOpen && !fsOn && (
            <button type="button" className="studio-tab" onClick={() => setStudioOpen(true)} aria-expanded={false} aria-controls="cap-studio" title="자막 패널 열기">
              <span className="st-ico" aria-hidden="true">T</span>자막{captions.length > 0 && <span className="st-n">{captions.length}</span>}<span className="st-arr" aria-hidden="true">▾</span>
            </button>
          )}
          {fsOn && <button type="button" className="fs-exit" onClick={() => document.exitFullscreen?.()}>전체화면 끝내기 (Esc)</button>}
          <Preview clean={fsOn} now={tnow} tlEnd={tlEnd} onPause={() => transportRef.current?.pause()} video={videoRef.current || document.createElement('video')} project={project} sheet={sheet}
            ratio={ratio} layout={layout} onLayout={setLayout} showSafe={showSafe} hasVideo={hasVideo} angles={angles} sources={srcMap} sheets={sheetMap}
            onCaptionMove={moveCaption}
            onCardStyle={(k, patch) => { const f = getFx(projRef.current); setFx({ [k]: { ...f[k], style: { ...(f[k].style || {}), ...patch } } } as Partial<Fx>); }}
            onEditCard={(k, page) => { setSelCard(k); setRightTab('fx'); setTimeout(() => { const el = document.getElementById(page && page !== FIRST_PAGE ? `outro-page-${page}-title` : k + '-title') as HTMLTextAreaElement | null; el?.focus(); el?.select(); }, 60); }}
            selCaption={selCaption} onSelectCaption={setSelCaption} onCaptionText={(id, text) => updateCaption(id, { text })}
            cropMode={cropMode} viewTrack={viewTrack} viewLabel={viewTrack ? `${viewNum}번 앵글 보는 중` : ''} onXf={(id, xf) => setProject({ frames: withXf(projRef.current, ratio, id, xf) })}
            levelGrid={levelGrid}
            onPip={pos => { const pp = { ...(projRef.current.pip || {}) }; if (pos) pp[ratio] = pos; else delete pp[ratio]; setProject({ pip: pp }); }} />
          <NeededFiles need={needList} onClose={() => setWant(null)} />
          {remoteEdit && (
            <div className="remote-edit" role="alert">
              <span><b>{remoteEdit.by}</b>이(가) 다른 컴퓨터에서 이 프로젝트를 고쳤어요 ({new Date(remoteEdit.at).toTimeString().slice(0, 5)}). 이 컴퓨터에도 아직 저장 안 된 변경이 있어요.</span>
              <div className="row tight">
                <button type="button" className="btn accent sm" onClick={() => currentDoc && adoptRemote(currentDoc)}>그 내용 불러오기</button>
                <button type="button" className="btn ghost sm" onClick={keepMine}>이 컴퓨터 내용으로 저장</button>
              </div>
            </div>
          )}

        </div>
        </div>
        <div className="transport">
          <button type="button" className="btn ghost" onClick={() => stepBars(-1)} disabled={!canPlay} aria-label="이전 마디">⏮</button>
          <button type="button" className="btn play" onClick={togglePlay} disabled={!canPlay} aria-label={playing ? '일시정지' : '재생'}>{playing ? '❚❚' : '▶'}</button>
          <button type="button" className="btn ghost" onClick={() => stepBars(1)} disabled={!canPlay} aria-label="다음 마디">⏭</button>
          <div className="clock">
            <span className="mono now-t">{fmtTime(now)}</span>
            <span className="mono dim">/ {fmtTime(tlEnd)}</span>
          </div>
          <button type="button" className="btn accent export-btn" onClick={() => { transportRef.current?.pause(); setExportOpen(true); }} disabled={!hasVideo}>MP4 추출</button>
          <button type="button" className="btn ghost fs-btn" onClick={toggleFs} disabled={!hasVideo} title="미리보기 전체화면" aria-label="전체화면">⛶</button>
          <button type="button" className="btn thumb-btn" onClick={() => { transportRef.current?.pause(); setThumbOpen(true); }} disabled={!hasVideo}>썸네일</button>
          <div className="barpos">
            {bb.bar >= 1 ? <><b className="mono">{bb.bar}</b><span>마디</span><b className="mono">{bb.beat + 1}</b><span>박</span></>
              : <span>카운트인 <b className="mono">{bb.beat + 1}</b></span>}
          </div>
        </div>
      </main>

      <aside className="panel right">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={rightTab === 'screen'} className={rightTab === 'screen' ? 'on' : ''} onClick={() => setRightTab('screen')}>화면</button>
          <button type="button" role="tab" aria-selected={rightTab === 'fx'} className={rightTab === 'fx' ? 'on' : ''} onClick={() => setRightTab('fx')}>효과</button>
        </div>
        {rightTab === 'screen' ? (<>
        <section>
          <h2>화면 비율</h2>
          <div className="seg" role="radiogroup" aria-label="화면 비율">
            {RATIOS.map(r => (
              <button key={r} type="button" role="radio" aria-checked={ratio === r} className={ratio === r ? 'on' : ''} onClick={() => setRatio(r)}>
                {r}<small>{RATIO_LABEL[r]}</small>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>영상 화면 <span className="dim small">{curSrcName ? curSrcName.replace(/\.[^.]+$/, '') : sources.length && curSrcId === MAIN ? `${(videoName || '첫 영상').replace(/\.[^.]+$/, '')}` : `${curNum}번 앵글`}</span></h2>
          <div className="field">
            <label htmlFor="vscale">크기 <span className="mono dim">{Math.round(curXf.scale * 100)}%</span></label>
            <input id="vscale" type="range" min="0.2" max="3" step="0.01" value={curXf.scale} disabled={!hasVideo}
              onChange={e => setCurXf({ ...curXf, scale: parseFloat(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="vrot">회전 (수평 맞추기) <span className="mono dim">{(curXf.rot || 0).toFixed(1)}°</span></label>
            <div className="row tight rot-row">
              <button type="button" className="btn ghost sm" disabled={!hasVideo} aria-label="왼쪽으로 0.1도" onClick={() => setCurXf({ ...curXf, rot: Math.round(((curXf.rot || 0) - 0.1) * 10) / 10 })}>−</button>
              <input id="vrot" type="range" min="-20" max="20" step="0.1" value={curXf.rot || 0} disabled={!hasVideo}
                onFocus={() => setLevelGrid(true)} onBlur={() => setLevelGrid(false)} onDoubleClick={() => setCurXf({ ...curXf, rot: 0 })}
                onChange={e => setCurXf({ ...curXf, rot: Math.abs(parseFloat(e.target.value)) < 0.05 ? 0 : parseFloat(e.target.value) })} />
              <button type="button" className="btn ghost sm" disabled={!hasVideo} aria-label="오른쪽으로 0.1도" onClick={() => setCurXf({ ...curXf, rot: Math.round(((curXf.rot || 0) + 0.1) * 10) / 10 })}>+</button>
            </div>
            <label className="row tight small dim" htmlFor="vrot-fill">
              <input id="vrot-fill" type="checkbox" checked={curXf.rotFill !== false} disabled={!hasVideo} onChange={e => setCurXf({ ...curXf, rotFill: e.target.checked })} />
              돌려서 생긴 빈 모서리가 안 보이게 자동 확대
            </label>
          </div>
          <div className="row">
            <button type="button" className={`btn sm ${cropMode ? 'accent' : ''}`} disabled={!hasVideo} onClick={() => setCropMode(m => !m)}>{cropMode ? '자르기 완료' : '자르기'}</button>
            <button type="button" className="btn ghost sm" disabled={!hasVideo || (curXf.crop.l + curXf.crop.t + curXf.crop.r + curXf.crop.b === 0)}
              onClick={() => setCurXf({ ...curXf, crop: { l: 0, t: 0, r: 0, b: 0 } })}>자르기 취소</button>
            <button type="button" className="btn ghost sm" disabled={!hasVideo} onClick={() => setCurXf(defaultXf())}>초기화</button>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <h2><label htmlFor="sheet-show">악보 카드</label></h2>
            <label className="switch"><input id="sheet-show" type="checkbox" role="switch" checked={!fx.sheetHidden} onChange={e => setFx({ sheetHidden: !e.target.checked })} aria-label="악보를 영상에 보이기" /></label>
          </div>
          {fx.sheetHidden && <p className="note">악보가 꺼져 있어요. 미리보기와 추출 영상에 악보가 나오지 않아요.</p>}
          {sheet && (
            <div className="row between">
              <span className="small dim">미리보기에서 악보 카드 위·아래 가운데 막대를 끌면 흰 여백을 자를 수 있어요</span>
              {(layout.cropT || layout.cropB) ? <button type="button" className="link small" onClick={() => setLayout({ ...layout, cropT: 0, cropB: 0 })}>여백 처음대로</button> : null}
            </div>
          )}
          <div className="field">
            <label htmlFor="opacity">배경 불투명도 <span className="mono dim">{Math.round(layout.opacity * 100)}%</span></label>
            <input id="opacity" type="range" min="0.2" max="1" step="0.01" value={layout.opacity} onChange={e => setLayout({ ...layout, opacity: parseFloat(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="width">크기 <span className="mono dim">{Math.round(layout.w * 100)}%</span></label>
            <input id="width" type="range" min="0.3" max="1" step="0.01" value={layout.w} onChange={e => setLayout({ ...layout, w: parseFloat(e.target.value), x: Math.min(layout.x, 1 - parseFloat(e.target.value)) })} />
          </div>
          <div className="field">
            <label>보여줄 줄</label>
            <div className="seg small">
              <button type="button" className={layout.lines === 1 ? 'on' : ''} onClick={() => setLayout({ ...layout, lines: 1 })}>현재 줄만</button>
              <button type="button" className={layout.lines === 2 ? 'on' : ''} onClick={() => setLayout({ ...layout, lines: 2 })}>+ 다음 줄</button>
            </div>
          </div>
          <label className="switch">
            <input id="sheet-cursor" type="checkbox" checked={fx.sheetCursor} onChange={e => setFx({ sheetCursor: e.target.checked })} />
            <span>악보 위 진행 커서</span>
          </label>
          <label className="switch">
            <input id="sheet-follow" type="checkbox" checked={fx.sheetFollow} onChange={e => setFx({ sheetFollow: e.target.checked })} />
            <span>따라가기 (크게 확대해서 연주 위치를 따라감)</span>
          </label>
          {fx.sheetFollow && (
            <div className="field">
              <label htmlFor="follow-bars">한 화면에 보이는 마디 <span className="mono dim">{fx.sheetFollowBars.toFixed(1)}마디</span></label>
              <input id="follow-bars" type="range" min={1.5} max={4} step={0.5} value={fx.sheetFollowBars} onChange={e => setFx({ sheetFollowBars: parseFloat(e.target.value) })} />
            </div>
          )}
          <label className="switch">
            <input id="sheet-bold" type="checkbox" checked={fx.sheetBold} onChange={e => setFx({ sheetBold: e.target.checked })} />
            <span>음표 진하게</span>
          </label>
          <label className="switch">
            <input id="safe" type="checkbox" checked={showSafe} onChange={e => setShowSafe(e.target.checked)} />
            <span>안전 영역 보기</span>
          </label>
          <button type="button" className="btn ghost sm" onClick={() => setLayout(defaultLayouts()[ratio])}>위치 초기화</button>
        </section>

        <section>
          <h2>레이아웃 템플릿</h2>
          <div className="row">
            <input id="tpl-name" type="text" placeholder="예: 연습실 정면" value={tplName} onChange={e => setTplName(e.target.value)} />
            <button type="button" className="btn sm" disabled={!tplName.trim()} onClick={() => {
              const name = tplName.trim();
              if (cloud) cloud.addTemplate(name, layouts).catch(() => setMsg({ kind: 'warn', text: '템플릿을 저장하지 못했어요.' }));
              else setTemplates(ts => [...ts.filter(t => t.name !== name), { name, layouts }]);
              setTplName('');
              setMsg({ kind: 'ok', text: `"${name}" 템플릿을 저장했어요.` });
            }}>저장</button>
          </div>
          {tplView.length === 0 ? null : (
            <ul className="tpl-list">
              {tplView.map(t => (
                <li key={t.key}>
                  <button type="button" className="tpl-apply" onClick={() => { record(); setLayouts(ls => ({ ...ls, ...t.layouts })); setMsg({ kind: 'ok', text: `"${t.name}" 적용` }); }}>
                    {t.name}{t.by && <small className="tpl-by"> · {t.by}</small>}
                  </button>
                  {t.canDelete && <button type="button" className="btn ghost sm" aria-label={`${t.name} 삭제`} onClick={t.remove}>삭제</button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>찾은 악보</h2>
          {!sheet ? null : (
            <div className="sheet-list">
              <p className="note">{sheetPages}쪽 · {sheet.systems.length}줄 · {sheet.bars.length}마디</p>
              {sheet.systems.map((s, i) => <SystemThumb key={i} sys={s} idx={i} bars={sheet.bars} currentIdx={sheetIndex(project, bb.bar)} label={(k: number) => barOfSheet(project, k)} />)}
            </div>
          )}
        </section>
        </>) : (
          <FxPanel fx={fx} setFx={setFx} selCard={selCard} selFx={selFx} setSelFx={setSelFx} onAddZoom={addZoom} onAddPunch={() => addPunchAt(tnow())} stampKind={stampKind} setStampKind={setStampKind} canAdd={hasVideo} selCut={selCutInfo} setCutTr={setCutTr} onLogo={onLogo} hasAudio={!!(rTrack || vTrack)}
            outroDt={() => { const f = getFx(projRef.current); const [a, b] = cardSpan(f, 'outro', 0, Math.max(videoRef.current?.duration || 0, endRef.current || 0)); const t = tnow(); return t >= a && t < b ? t - a : null; }} />
        )}
      </aside>

      {projectsOpen && cloud && user && (
        <ProjectsPanel cloud={cloud} user={user} admin={admin} projects={projects} currentId={currentId}
          onOpen={openProject} onNew={newProject} onClose={() => setProjectsOpen(false)}
          onDelete={deleteProjectFull} onClearFiles={clearProjectFiles} />
      )}

      {thumbOpen && videoRef.current && (
        <ThumbDialog cloud={cloud && user ? cloud : null} onClose={() => setThumbOpen(false)} src={videoRef.current.src} time={videoRef.current.currentTime || 0}
          duration={duration} project={project} ratio={ratio} videoName={videoName} projectTitle={title} />
      )}

      {exportOpen && (
        <ExportDialog onClose={() => setExportOpen(false)} getInput={getExportInput}
          picked={exportRange} onPickStart={() => { setExportOpen(false); setPickRange(exportRange ? { a: exportRange[0], b: exportRange[1] } : { a: null, b: null }); }}
          setSilent={on => { if (playerRef.current) playerRef.current.silent = on; }}
          duration={tlEnd} project={project} sheetRange={sheetSpan as [number, number] | null}
          ratio={ratio} setRatio={setRatio} videoName={videoName} projectTitle={title} />
      )}

      <footer className="bottom">
        {pickRange && (
          <div className="srcbar pickbar">
            <span className="src-tag" style={{ ['--c' as any]: '#ff8a1f' }}>구간 지정</span>
            <span className="small">타임라인을 끌어서 추출할 구간을 고르세요</span>
            <span className="mono small">{pickRange.a !== null && pickRange.b !== null && pickRange.b > pickRange.a ? `${fmtTime(pickRange.a)} ~ ${fmtTime(pickRange.b)} · ${(pickRange.b - pickRange.a).toFixed(1)}초` : '--'}</span>
            <button type="button" className="btn accent sm" disabled={!(pickRange.a !== null && pickRange.b !== null && pickRange.b - pickRange.a >= 0.2)}
              onClick={() => { setExportRange([pickRange.a!, pickRange.b!]); setPickRange(null); transportRef.current?.pause(); setExportOpen(true); }}>이 구간 추출하기</button>
            <button type="button" className="btn ghost sm" onClick={() => { setPickRange(null); setExportOpen(true); }}>취소</button>
          </div>
        )}
        {viewTrack && (
          <div className="srcbar">
            <span className="src-tag" style={{ ['--c' as any]: angleInfo(viewTrack).color }}>{viewNum}번 앵글</span>
            <button type="button" className="btn ghost sm" onClick={() => setMark('a')} title="시작 표시">시작 <span className="mono">{inOut.a !== null ? fmtTime(inOut.a) : '--'}</span></button>
            <button type="button" className="btn ghost sm" onClick={() => setMark('b')} title="끝 표시">끝 <span className="mono">{inOut.b !== null ? fmtTime(inOut.b) : '--'}</span></button>
            <button type="button" className="btn accent sm" disabled={inOut.a === null || inOut.b === null} onClick={insertRange}>구간 넣기</button>
            <button type="button" className="btn sm" onClick={insertHere}>여기부터 넣기</button>
            <button type="button" className="btn ghost sm" onClick={() => { setSelTrack('program'); setInOut({ a: null, b: null }); }}>결과물 보기 (Esc)</button>
          </div>
        )}
        <Timeline viewShift={viewShift} video={videoRef.current || document.createElement('video')} duration={tlEnd} srcDur={duration} now={tnow} project={project}
          vTrack={vTrack} rTrack={rTrack} nBars={nBars} onSeek={seek}
          onPlayFrom={t => { if (!canPlay) return; playerRef.current?.ensureCtx(); transportRef.current?.play(Math.max(0, Math.min(tlEnd || duration || 0, t))); }}
          angleInfo={angleInfo} multi={angles.length > 0}
          selCard={selCard} onCard={(k, patch) => setFx({ [k]: { ...getFx(projRef.current)[k], ...patch } } as any)}
          onSelectCard={(k, edit) => { setSelCard(k); if (k) { setRightTab('fx'); if (edit) setTimeout(() => (document.getElementById(k + '-title') as HTMLInputElement | null)?.focus(), 60); } }}
          pick={pickRange} onPick={(a, b) => setPickRange({ a, b })}
          onSheetClips={list => setProject({ sheetClips: list || undefined })} hasSheet={!!sheet}
          onSlip={(id, off) => id === 'rec' ? setProject({ ...recPatch(off), syncTouched: true })
            : id.startsWith('recx:') ? setProject({ recClips: (projRef.current.recClips || []).map(c => recKeyOf(c) === id ? { ...c, at: off } : c) })
            : setProject({ angleOffsets: { ...projRef.current.angleOffsets, [id]: off } })}
          recAt={recAtOf(project, duration)}
          srcTrackOf={src => !src ? vTrack : (sources.find(x => x.id === src)?.track || null)}
          srcDurOf={srcDurOf}
          srcLabelOf={sources.length ? (src => (src ? src : videoName).replace(/\.[^.]+$/, '')) : undefined}
          onGrid={g => setProject({ ...(g.anchorTime !== undefined ? { anchorTime: g.anchorTime, anchorTouched: true } : {}), ...(g.bpm !== undefined ? { bpm: g.bpm, bpmTouched: true } : {}) })}
          onSkips={list => setProject({ skips: list })}
          playing={playing}
          onClips={list => setProject({ clips: list, skips: [], trims: { ...(projRef.current.trims || {}), main: undefined as any } })}
          onCycle={c => setProject({ cycle: c || undefined })}
          onTrim={(id, tr) => setProject({ trims: { ...(projRef.current.trims || {}), [id]: tr } })}
          onFade={(key, f) => {
            const p = projRef.current;
            if (key.startsWith('clip:')) setProject({ clips: clipsOf(p, masterDur()).map(c => c.id === key.slice(5) ? { ...c, fadeIn: f.in, fadeOut: f.out } : c), skips: [] });
            else setProject({ recFades: { ...(p.recFades || {}), [key]: f } });
          }}
          selFx={selFx} onSelectFx={sf => { setSelFx(sf); if (sf) setRightTab('fx'); }} onFxItems={patch => setFx(patch)} onAddPunch={(t: number) => addPunchAt(t)}
          onSelectClip={c => {
            setSelClipSrc(c ? c.src || MAIN : null);
            // 고른 조각이 지금 화면에 보이도록 재생 위치를 그 조각 안으로 (멈춰 있을 때만)
            if (c && !transportRef.current?.playing) { const t = tnow(); if (t < c.start || t >= clipEnd(c)) seek(c.start + 0.01); }
          }}
          selected={selTrack} onSelect={setSelTrack} inOut={inOut} selCut={selCut} onSelectCut={i => { setSelCut(i); if (i !== null) setRightTab('fx'); }}
          selCaption={selCaption} onCaptions={setCaptions} onSelectCaption={setSelCaption} onEditCaption={editCaption}
          angleTracks={angles.map((a, i) => ({ id: a.id, num: i + 2, color: ANGLE_COLORS[(i + 1) % ANGLE_COLORS.length], track: a.track, offset: project.angleOffsets[a.id] || 0 }))} onCuts={(c: Cut[]) => setProject({ cuts: c })} onGroup={patch => setProject(patch)} sheetNames={sheetNames} nBarsOf={nBarsOf} onSheetBpm={setSheetBpm} recName={recName} recExtras={(project.recClips || []).flatMap(c => {
            if (c.src === MAIN_REC) return rTrack ? [{ key: recKeyOf(c), src: c.src, name: recName, at: c.at, track: rTrack, dur: rTrack.duration }] : [];
            const x = extraRecs.find(k => k.id === c.src); return x ? [{ key: recKeyOf(c), src: c.src, name: c.src, at: c.at, track: x.track, dur: x.dur }] : []; })}
          onSplitRec={splitRec} onDeleteRec={deleteRecPiece} sheetHidden={!!fx.sheetHidden} onSheetHidden={v => setFx({ sheetHidden: v })} snap={(t: number) => snapTime(projRef.current, t)} />
      </footer>
    </div>
  );
}

function FileSlot(p: { id: string; label: string; hint: string; accept: string; name: string; onFile: (f: File) => void; onFiles?: (fs: File[]) => void }) {
  return (
    <label className={`slot ${p.name ? 'filled' : ''}`} htmlFor={p.id}>
      <input id={p.id} type="file" accept={p.accept} multiple={!!p.onFiles}
        onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length > 1 && p.onFiles) p.onFiles(fs); else if (fs[0]) p.onFile(fs[0]); e.target.value = ''; }} />
      <span className="slot-label">{p.label}</span>
      <span className="slot-name">{p.name || p.hint}</span>
      <span className="slot-act">{p.name ? '바꾸기' : '열기'}</span>
    </label>
  );
}

function TrackRow(p: { id: string; label: string; color: string; on: boolean; vol: number; disabled: boolean; onToggle: () => void; onVol: (v: number) => void }) {
  return (
    <div className={`track ${p.disabled ? 'off' : ''}`}>
      <button type="button" className={`tbtn ${p.on ? 'on' : ''}`} style={{ ['--c' as any]: p.color }} onClick={p.onToggle} disabled={p.disabled} aria-pressed={p.on}>
        {p.on ? '켜짐' : '꺼짐'}
      </button>
      <label htmlFor={p.id} className="tlabel">{p.label}</label>
      <input id={p.id} type="range" min="0" max="1" step="0.01" value={p.vol} onChange={e => p.onVol(parseFloat(e.target.value))} disabled={p.disabled || !p.on} aria-label={`${p.label} 볼륨`} />
    </div>
  );
}

function SystemThumb(p: { sys: { canvas: HTMLCanvasElement; firstBar: number; barXs: number[] }; idx: number; bars: { sys: number }[]; currentIdx: number; label: (k: number) => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = p.sys.barXs.length - 1;
  const i0 = p.sys.firstBar - 1;
  const active = p.currentIdx >= i0 && p.currentIdx < i0 + n;
  const la = p.label(i0), lb = p.label(i0 + n - 1);
  useEffect(() => {
    const c = ref.current!;
    const s = p.sys.canvas;
    c.width = s.width; c.height = s.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(s, 0, 0);
    ctx.strokeStyle = 'rgba(255,122,18,0.9)'; ctx.lineWidth = 4;
    for (const x of p.sys.barXs) { ctx.beginPath(); ctx.moveTo(x, c.height * 0.25); ctx.lineTo(x, c.height * 0.75); ctx.stroke(); }
  }, [p.sys]);
  return (
    <figure className={`sys ${active ? 'active' : ''}`}>
      <canvas ref={ref} />
      <figcaption><span>{p.idx + 1}줄</span><span className="mono">{la < 1 ? '못갖춘' : la}–{lb}마디 ({n})</span></figcaption>
    </figure>
  );
}

function AngleCard(p: {
  num: number; color: string; name: string; video: HTMLVideoElement | null; active: boolean; onPick: () => void; main?: boolean;
  offset?: number; confidence?: number | null; analyzing?: boolean; onNudge?: (d: number) => void; onResync?: () => void; onRemove?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 120) return;
      last = ts;
      const c = ref.current, v = live.current.video;
      if (!c || !v || !v.videoWidth) return;
      const ctx = c.getContext('2d')!;
      const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
      ctx.drawImage(v, (c.width - v.videoWidth * s) / 2, (c.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`angle ${p.active ? 'active' : ''}`} style={{ ['--c' as any]: p.color }}>
      <button type="button" className="angle-thumb" onClick={p.onPick} aria-label={`${p.num}번 앵글로 전환`}>
        <canvas ref={ref} width={96} height={128} />
        <span className="angle-num mono">{p.num}</span>
      </button>
      <div className="angle-body">
        <span className="angle-name">{p.main ? '기준 영상' : p.name}</span>
        {p.main ? null : (
          <>
            <div className="row tight">
              <button type="button" className="btn ghost xs" onClick={() => p.onNudge!(-0.01)}>−10ms</button>
              <span className="mono small">{p.analyzing ? '분석 중' : `${(p.offset || 0) >= 0 ? '+' : ''}${(p.offset || 0).toFixed(3)}초`}</span>
              <button type="button" className="btn ghost xs" onClick={() => p.onNudge!(0.01)}>+10ms</button>
            </div>
            <div className="row tight">
              {p.confidence !== null && p.confidence !== undefined && p.confidence >= 0 && <span className={`chip ${p.confidence > 1.5 ? 'good' : 'warn'}`}>{p.confidence > 1.5 ? '싱크 확실' : '싱크 확인'}</span>}
              <button type="button" className="link small" onClick={p.onResync}>자동 맞춤</button>
              <button type="button" className="link small danger" onClick={p.onRemove}>빼기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
