# 연주 영상 편집기 — 작업 인수인계 (2026-10-24)

이 브랜치(`source`)는 편집기의 **소스 코드**입니다. `main` 브랜치에는 빌드된 `index.html`만 있고 GitHub Pages로 배포됩니다.

## 작업 방식 (매 수정마다)
1. 소스 받기: `git clone -b source https://github.com/osp2ow/video-edit pve` → `cd pve && npm install`
2. 수정 후 빌드: `node build.mjs` → `deploy/video-editor/index.html`, `dist/editor.html`, `dist/index.html` 생성
3. 타입 검사: `npx tsc -p . --noEmit`
4. 배포: `deploy/video-editor/index.html`을 `main` 브랜치(`video-edit` 저장소 루트)의 `index.html`로 복사 → 커밋 → push
   - 커밋 작성자: `-c user.name=osp2ow -c user.email=osp2ow@gmail.com`
5. 아티팩트(미리보기) 갱신: `dist/editor.html`을 https://claude.ai/artifact/Ge4k7G9HmJNqfM8g6CoP72 에 다시 게시
6. 소스도 이 `source` 브랜치에 커밋·push (안 하면 다음 세션에서 사라짐)
7. 답변은 한국어로

## 구조 (src/)
- `model.ts` — Project 데이터, 템포 지도(tempoSegs: 악보 조각별 BPM), 영상 조각(Clip.src), 녹음본(recAt, RecClip, MAIN_REC 조각), shiftProject(앞쪽 빈 구간 정리)
- `player.ts` — 소리 엔진: 녹음본(메인 시계)·추가 녹음본·메트로놈을 타임라인 시간에 맞춰 예약
- `transport.ts` — 재생 시계. 영상들(<video>)이 녹음본 시계를 따라감 (드리프트 보정)
- `App.tsx` — 전체 상태·파일 넣기(영상 추가, 녹음본 추가, 악보 추가)·클라우드 저장/열기·자동 분석
- `Timeline.tsx` — 타임라인 (자르기 I, 끌어서 여러 개 선택, Ctrl/Cmd+클릭, Cmd+A, 악보 BPM 입력칸)
- `effects.ts` / `render.ts` — 한 프레임 그리기 (미리보기·추출 공통), 악보 카드, 자막(자막별 위치 Caption.pos)
- `exporter.ts` — MP4 추출 (WebCodecs + mp4-muxer), 소리 합치기
- `sheet.ts` — 악보 오선·마디선 인식 (드럼·기타 타브)
- `analysis.ts` — 템포·첫 박·싱크 분석
- `audiofile.ts` — 큰 영상(mov/mp4)에서 소리 트랙만 골라 작은 m4a로 만들기 (분석·추출 소리에 사용, 안 되면 파일 전체로)
- `cloud.ts` / `CloudUI.tsx` — Firebase(로그인·Firestore·Storage), 모든 선생님 공동 프로젝트
- 테스트: `test/*.mjs` (Playwright, 헤드리스 크롬). 테스트용 영상·악보·녹음 파일은 저장소에 없음

## 최근 완료
- 11/10 "영상을 바꿔도 예전 영상이 나옴" 수정 (클라우드): ① 프로젝트를 열면 파일을 차례로 내려받는데, 받는 사이 사용자가 새 파일로 바꾸면 받기가 끝난 예전 파일이 그 위에 다시 들어갔음 → localPick(직접 넣은 자리: cloudUpload 역할 이름 + 바꾸기 함수의 예전 이름)에 있으면 받지도 넣지도 않음, 지워진 예전 파일 받기 실패 안내도 안 띄움. ② 다른 컴퓨터·창에서 같은 이름으로 파일을 바꾸면 이 창은 바뀐 줄 몰라 예전 영상이 남고 예전 파일 목록을 들고 있었음 → syncRemoteFiles: 파일 경로가 바뀐 자리만 받아 replaceX로 교체, filesRef 최신화. 내려받기는 pullFiles로 분리. 시험: `test/samecloud.mjs a b` (python3 -m http.server 8765, 가짜 Firebase에 __fakeDlDelay·__fakeUpDelay 추가)
- 11/10 같은 이름 다른 내용 영상 바꾸기 점검(코드 수정 없음): 기준 영상(#f-video 같은 이름)·추가 영상 '바꾸기'·'영상 추가'로 같은 이름 다시 넣기 모두 미리보기(멈춤·재생)·PIP·PIP 끄기 후 영상 줄·추출 화면/소리까지 새 내용, 타임라인 조각·PIP 위치 유지. 클라우드는 내용 지문(크기+앞뒤 4MB SHA-256)으로 저장해 같은 이름이어도 새로 올라감 (`test/samename.mjs a폴더 b폴더` — clip.mp4 빨강/파랑, pip.mp4 초록/노랑을 ffmpeg로 만들어 씀)
- 11/7 기타 타브 악보(그 여름에 피어나 solo, Juniper Guitar Tab PDF)에서 마디줄 두 개를 놓쳐 4·5마디, 6·7마디가 한 마디로 읽히던 문제: 마디줄 바로 위에 H 글자·이음줄이 닿아 있으면 '오선 밖 반 칸 안 잉크 20%' 규칙에 걸려 탈락했음 → sheet.detectPage: 그 규칙에 걸려도 오선에서 위·아래로 이어진 잉크 길이가 0.45칸+2px 이하면 마디선 (음표 기둥은 쭉 이어짐). 다른 드럼 악보 시험 자료는 결과 동일. 점검용 window.__pveSheet(), `test/solosheet.mjs 악보 [영상]` (SYS=폴더 주면 줄별 그림에 마디선 표시)
- 11/6 추출 영상에서 PIP가 검은 상자로만 나오던 문제: PIP 영상을 파일에서 직접 못 풀면(아이폰 HEVC 등, 미리보기는 브라우저 재생기라 정상) ovDec가 없어 검게 그려졌음 → exporter.ovFrames가 미리보기용 PIP <video>를 그 시각으로 옮겨(seeked 기다림) 장면을 받음(느리지만 정확). 예비 방식(재생하며 받기)에서는 ovFollow로 PIP 영상도 같이 재생(예전엔 매 장면 위치만 옮겨 멈춰 보였음). 재현: PIP 영상을 webm으로 (`MP4BOX=… OUT=… node test/overlay.mjs main2.mp4 second.webm`)
- 11/6 PIP 영상 줄 (두 영상 동시 재생): Project.overlays(Overlay = Clip + box(비율별 PipPos) + sound). 왼쪽 '영상 추가' 목록의 'PIP로'/'PIP 끄기'(App.toggleOverlay: 영상 줄의 그 영상 조각들을 같은 시각 그대로 옮김, 다른 영상과 안 겹치면 재생 위치로) + '소리' 체크. 그리기 effects.drawOverlays(ovBox: 그 영상 비율, 기본 자리 오른쪽 아래쪽 · 둥근 모서리 흰 테두리 · 조각 페이드만큼 투명)를 영상 페이드 뒤·비네트 앞에. 미리보기: 조각별 전용 <video>(App.ovElsRef, makeAngleVideo, 원본과 같은 주소) → Transport.syncOv/follow로 시계 따라 재생, Preview pipNow가 PIP 영상 먼저(끌기·모서리 크기·더블클릭 기본 자리, 같은 영상 조각들 같이). 타임라인: 영상 줄 아래 'PIP' 줄(rowIds) — 누르기 고르기, 끌기 옮기기(박자 단위, Alt 자유), 양 끝 줄이기, 페이드 손잡이·칸('ov:'키), Delete, I 자르기. 추출: 조각별 디코더(ovDec)로 'ov:'+id 장면, 소리 켠 조각은 mixAudio에 (`test/overlay.mjs 영상1 영상2 [폴더]`, MP4BOX·OUT 주면 추출까지)
- 11/6 첫 녹음본을 끌면(타임라인 끌기·Alt+방향키·영상 끌 때 따라오기) 마디 눈금까지 같이 옮겨지던 것 → 녹음본 위치(recAt)만 바꿈, 마디 눈금은 영상 옮기기처럼 그대로. recPatch(마디 같이)는 자동 싱크(runSync)·싱크 미세 조정(nudgeSync)에만 남김 (`test/linkrec.mjs`)
- 11/4 녹음본 추가했는데 타임라인에 안 보이던 경우 수정: ① 영상 소리와 안 맞아 앞 녹음본 뒤에 붙으면 화면 밖(타임라인은 영상 넣을 때만 전체 보기 맞춤) → App.reveal → Timeline이 보이게 옮기고(전체 보기 중이면 다시 맞춤) 새 조각을 골라 둠 ② 조각을 모두 지운 추가 녹음본을 같은 파일로 다시 넣으면 replaceRec→addRec(restoring)이라 조각이 안 생겼음 → addRec(file, true, ensure) ③ 첫 녹음본을 지운 뒤(trims.rec 길이 0) 같은 이름으로 다시 넣으면 그대로 0 → loadRec에서 줄이기 초기화. 다른 녹음본과 50% 넘게 겹치면 알림 문구 (`test/addrecshow.mjs 영상 녹음본1 녹음본2`)
- 11/3 붙여넣은 녹음본(·모든 요소) 페이드 안 되던 문제: 붙여넣으면 여러 개 선택(msel) 상태라 누르기를 groupDrag가 먼저 가져가서 ① 한 번 눌러도 그 조각이 안 골라져 페이드 칸이 안 뜨고 ② 위쪽 모서리 페이드 손잡이를 끌면 조각이 옮겨졌음. 이제 페이드 손잡이 판정을 msel보다 먼저, 끌지 않고 놓으면 selectOne(그 요소 하나 고르기) (`test/pastefade.mjs 영상 녹음본`). 소리 쪽 페이드 예약은 원래 정상 (`test/fadeaudio.mjs`, `test/fade2.mjs`, `test/vidfade.mjs`, `test/fadehandle.mjs`)
- 11/3 미리보기 기본 = 효과 넣은 화면: 영상 줄·앵글 줄을 골라도 단독 보기로 바뀌지 않음 (App: pickTrack = 고른 줄, viewTrack = soloOn일 때만). 앵글이 있을 때 앵글 도구 막대에 '이 앵글만 보기' 토글 (`test/anglesolo.mjs 영상 앵글`)
- 11/3 영상 조각을 끌면 맞춰 둔 녹음본이 같이 이동 (Timeline.linkedRecs: 녹음본 조각마다 가장 많이 겹치는 영상 조각이 끈 조각이면 따라감 · App.onClipsRec로 한 번에 저장, 첫 녹음본은 recPatch라 마디 눈금도 같이). 녹음본을 끌면 녹음본만 (`test/linkrec.mjs 영상1 녹음본 영상2` — 앞쪽 빈 구간 자동 정리 때문에 위치는 상대값으로 비교)
- 11/3 재생 중 다른 영상 조각으로 넘어갈 때 미리보기 멈춤 수정 (transport.tick: 새 영상이 위치 찾는 중이면 다시 지정하지 않고 play()를 걸어 둠 · 위치 찾는 데 걸린 시간 __seekLat만큼 앞을 찾음, `test/switchplay.mjs 영상1 무거운영상2`)
- 11/3 추가한 영상 조각을 I로 자르면 뒤 조각이 첫 영상으로 바뀌던 버그 수정 (splitAtPlayhead가 src를 빠뜨렸음 · 이제 앞 조각=페이드 인/전환, 뒤 조각=페이드 아웃 이어받음, `test/splitsrc.mjs`)
- 영상 여러 개 이어 붙이기, 녹음본 메인 + 각 영상 소리 듣기
- 악보 여러 개 + 악보마다 BPM (템포 지도)
- 녹음본 여러 개, 녹음본 자르기(I)·조각 지우기
- 타임라인 네모 선택 · Ctrl/Cmd+클릭 다중 선택
- 앞쪽 빈 구간 자동 정리, 서서히 확대·자막 추가 위치 버그 수정
- 자막 위치 '이 자막만' 따로
- (10/24) 큰 영상 불러오기: 소리만 골라 읽음 → 1.7GB 2.9초→0.5초, 4GB 넘는 영상도 이제 분석됨 (예전엔 읽기 실패). 결과는 파일 전체 디코딩과 똑같음 (`test/audiofile.mjs 영상...`)
- (11/3) 다른 컴퓨터에서 연 프로젝트에 기준 영상을 직접 넣으면 새 프로젝트가 생기던 문제: '필요한 파일' 안내를 닫았거나(want=null) 이름이 다르면 loadVideo가 새 프로젝트를 만들고 설정을 초기화했음 → 프로젝트가 열려 있고 기준 영상이 아직 없거나 같은 이름이면 항상 그 프로젝트에 넣음(keep), 템포·싱크 다시 찾지 않음. 클라우드 내려받기 2번 재시도 + 실패 이유 표시, 4GB 이상 파일은 올리기 전에 안내(Storage 규칙 4GB 제한) (`test/reopen_missing.mjs`, CLOSE=1)
- (11/2) 자른 조각 사이 장면 전환: Clip.trIn {type, dur} = 바로 앞(맞닿은) 조각에서 이 조각으로 넘어갈 때 전환 (없으면 효과 탭 기본값, 'cut'이면 없음 · effects.clipTrOf). 타임라인 영상 줄 맞닿은 경계에 동그란 나비 버튼(전환 있으면 채움, 조각별로 정했으면 보라) → 누르면 ClipTrMenu(기본/바로/디졸브…/길이). 고른 조각 위쪽 '앞 조각과 전환' 칸도 같음
  - 같은 영상 파일 두 조각: 미리보기는 숨은 복사 영상(effects.peekOf)에서 재생 중이 아닌 쪽 장면을 꺼냄(1.5초 전부터 미리 위치 잡음). 추출은 기존 framesFrom 복사본으로 정확 (`test/cuttrans.mjs` 빨강→파랑 영상으로 확인)
- (10/31 밤) 기타 코드표 = 직접 만들기 (정해진 코드 목록은 사용자 요청으로 화면에서 뺌). Caption.chord = ChordData {name, frets[6줄, 6번줄부터: 1+ 프렛 · 0 O · -1 X · -2 표시 없음], base(시작 프렛), span(칸 수 4~6), barre(자동 바레 그리기 on/off)}. 코드표 패널(ChordPanel): '+ 새 코드표'(재생 위치, 다른 코드표 가운데면 그 코드표를 거기서 끊음) → 이름 입력, 지판 칸 눌러 점(다시 누르면 지움), 줄 왼쪽 O→X→없음, 시작 프렛 ±, 칸 수, 바레. '내 코드표'에 저장(localStorage pve.chordLib + 로그인 시 cloud pref 'chordLib')해 두고 눌러서 넣기
  - 위치·크기는 Project.chordPos(비율별, 모든 코드표 공통), 미리보기에서 끌기·네 모서리로 크기. 그리기 render.paintChord/chordGeom (가로 표, 위 = 1번줄)
  - 예전 목록(src/chordLegacy.ts)은 이미 넣은 {name, v}만 있는 코드표를 그리고, 고칠 때 editableOf로 점 데이터로 바꾸는 데만 씀
  - 패널 안 설명 문구는 사용자가 싫어함 (빼 달라고 함) — 조작 안내는 title 툴팁으로만
  - (`test/chords_ui.mjs`, `test/chords_check.mjs`=예전 목록 검사)
- (10/29) 연주 위치 네모 칸: 여유를 오선 한 칸의 0.6배로, 줄 아래 여백(inkExtent)은 1칸으로 → 손 순서 RL 글씨를 가리지 않고 감쌈 (`test/hlbox2.mjs`)
- (10/29) 추가 파일 바꾸기: 영상 추가·녹음본 추가·악보 추가·앵글 목록에 '바꾸기'(App.ReplaceBtn) + 같은 이름을 다시 넣으면 거절 대신 그 항목을 새 파일로 바꿈(replaceSource/replaceRec/replaceSheet/replaceAngle). 타임라인 설정 유지, 다른 이름이면 그 이름을 쓰던 조각·줄이기·페이드·싱크·전환점 키를 새 이름으로 (`test/replace.mjs`)
- (10/29) 악보 카드 높이: render.sheetMetrics가 줄 그림 전체 대신 inkExtent(오선에 붙은 잉크 + 바로 위·아래 글씨 한 줄, 멀리 떨어진 제목은 뺌)로 계산 → 첫 줄 제목 때문에 모든 줄 카드가 커지던 문제 해결
- (10/29) 악보 흰 여백 직접 자르기: CardLayout.cropT/cropB (비율별 카드 설정, 줄 그림 폭 대비). 미리보기 카드 위·아래 가운데 막대 끌기(위는 카드 위쪽이 따라오고 악보 줄은 제자리), 더블클릭하면 처음대로, 패널 '여백 처음대로'. 줄이기는 오선까지, 늘리기는 오선 3개 높이만큼 더 (render.cardMetrics) (`test/sheetcrop3.mjs`)
- (10/28 밤) 영상 조각별 페이드: Clip.fadeIn/fadeOut (화면은 검게 effects.drawClipFade · 소리는 transport에서 볼륨, 추출은 mixAudio). 타임라인 영상 조각 클릭 → 위쪽 페이드 칸 / 조각 위쪽 네모 끌기 (`test/clipfade_copy.mjs`)
- (10/28 밤) 타임라인 복사·붙여넣기: Ctrl/Cmd+C·V 또는 타임라인 위 '복사'·'붙여넣기' 버튼. 영상 조각·녹음본 조각·악보 조각·자막·확대 구간·펀치 지점. 재생 위치에 맨 앞 요소가 오고 간격 유지, 붙여넣은 것들이 골라진 상태가 됨. 클립보드는 Timeline.tsx 모듈 변수(창 안에서만). 인트로/엔딩 카드·앵글 전환점은 대상 아님
- (10/28 밤) 영상 회전(수평 맞추기): VideoXf.rot(도, ±20) · rotFill(빈 모서리 자동 확대, 기본 켜짐). 오른쪽 '영상 화면'에 슬라이더·±0.1 버튼, 슬라이더를 만지는 동안 미리보기에 수평 격자 (render.drawVideo)
- (10/28 밤) 이어 붙인 영상 사이 장면 전환: effects.clipTransitionAt — 맞닿은 두 조각 경계에 효과 탭 전역 장면 전환(trType·trDur) 적용, 앞 조각은 끝 장면·뒤 조각은 첫 장면에서 멈춘 채 섞임. 추출은 framesFrom(앞 조각 장면 복사본) 사용 (`test/cliptrans.mjs`, MP4BOX 환경변수로 mp4box 파일 지정)
  - 한계: 경계마다 따로 전환 종류를 고르는 기능은 없음(앵글 전환점만 개별 설정). 소리는 경계에서 섞이지 않음
- (10/28) 녹음본 조각별 페이드 인·아웃: Project.recFades (키 = trims와 같음 'rec'·'recx:…'). 타임라인 녹음본 조각 클릭 → 위쪽 '페이드 인/아웃' 칸, 또는 조각 위쪽 작은 네모 끌기. 재생(player)·추출(exporter.mixAudio) 모두 model.scheduleFade 사용 (`test/fade.mjs`, `test/recfade_ui.mjs`)
- (10/28) 이어 붙인 영상마다 크기·자르기 따로: 영상 줄에서 조각 클릭 → 오른쪽 '영상 화면'이 그 영상 대상 (예전엔 activeSource에 sources를 안 넘겨서 항상 첫 영상). 조각 밖이면 재생 위치를 조각 안으로 옮김
- (10/28) 악보 2부터 템포: 왼쪽 악보 목록에 '이 악보부터 템포' 칸 + '소리로 찾기'(analysis.estimateTempoRange로 그 악보 구간만 분석). 템포 바꾸면 이어 붙어 있던 뒤 악보들이 같이 밀리고 당겨짐 (`test/sheettempo.mjs`)
  - 알려진 한계: 처음 자동 감지는 녹음 전체로 템포를 찾아서, 곡 중간에 템포가 크게 바뀌면 첫 악보 템포가 틀릴 수 있음 (첫 악보용 '소리로 찾기'는 아직 없음)
- (10/25) 엔딩 카드 문구 여러 개: Fx.outro.pages (at = 카드 시작부터 초, 첫 문구는 title/sub). 효과 탭 '+ 문구 추가'(재생 위치가 카드 안이면 그 자리), 타임라인 자막 줄에서 경계선 끌기, 미리보기 더블클릭 → 그 문구 입력칸. 배경은 그대로·글자만 교차 페이드 (`test/outropages.mjs`)
- (10/24) PIP 작은 화면: 미리보기에서 끌어서 옮기기, 오른쪽 아래 분홍 손잡이로 크기, 더블클릭하면 기본 자리. 화면 비율별로 Project.pip에 저장 (`test/pipdrag.mjs`)
- (10/24) '앵글 영상이 재생 안 됨' 문의: 세로·4K 앵글 PIP 재생은 정상 확인 (`test/pipangle.mjs`). 사용자 쪽 원인(싱크 어긋남·HEVC·이어 붙인 구간) 답 대기 중
- (10/24) 프로젝트 창 '클라우드 사용량' → '이번 달 예상 요금' (보관 + 이 컴퓨터에서 내려받은 양, Storage 위치 선택: 미국 무료 한도 / 서울·도쿄). 실제 버킷은 video-edit-7816d.firebasestorage.app, 위치는 사용자 확인 필요 (`test/cost.mjs`)

## 진행 중 / 다음 할 일 후보
- **색감 문제**: 추출 영상이 PC와 아이폰(카톡 전송)에서 색이 다름. 추출 설정은 안 바뀜.
  원인 후보: 아이폰 HDR 원본, 결과 파일 색 정보(BT.601/미표기), 카톡 재압축.
  제안한 해결: 결과를 BT.709로 변환·표기(colr), HDR 원본 감지·안내/보정. 사용자 답 대기 중
  (비교한 것이 추출 mp4인지 미리보기인지, 아이폰 HDR 비디오 켜져 있는지)
- 예상 요금: 내려받은 양은 이 컴퓨터 것만 셈. 모든 선생님 합계가 필요하면 Firestore 카운터 + 규칙 수정 필요
- 예전부터 남은 것: Boy reels 5–6마디 끊김, 작은 악보 캡처 인식, 기타 타브 마디 번호 어긋남
- 기타 악보 화면(따라가기 보기)은 바꾸기 전에 반드시 사용자에게 보여주고 확인받기 (한 번 롤백한 적 있음)
