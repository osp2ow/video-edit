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
- 영상 여러 개 이어 붙이기, 녹음본 메인 + 각 영상 소리 듣기
- 악보 여러 개 + 악보마다 BPM (템포 지도)
- 녹음본 여러 개, 녹음본 자르기(I)·조각 지우기
- 타임라인 네모 선택 · Ctrl/Cmd+클릭 다중 선택
- 앞쪽 빈 구간 자동 정리, 서서히 확대·자막 추가 위치 버그 수정
- 자막 위치 '이 자막만' 따로
- (10/24) 큰 영상 불러오기: 소리만 골라 읽음 → 1.7GB 2.9초→0.5초, 4GB 넘는 영상도 이제 분석됨 (예전엔 읽기 실패). 결과는 파일 전체 디코딩과 똑같음 (`test/audiofile.mjs 영상...`)
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
