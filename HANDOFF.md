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
- `cloud.ts` / `CloudUI.tsx` — Firebase(로그인·Firestore·Storage), 모든 선생님 공동 프로젝트
- 테스트: `test/*.mjs` (Playwright, 헤드리스 크롬). 테스트용 영상·악보·녹음 파일은 저장소에 없음

## 최근 완료
- 영상 여러 개 이어 붙이기, 녹음본 메인 + 각 영상 소리 듣기
- 악보 여러 개 + 악보마다 BPM (템포 지도)
- 녹음본 여러 개, 녹음본 자르기(I)·조각 지우기
- 타임라인 네모 선택 · Ctrl/Cmd+클릭 다중 선택
- 앞쪽 빈 구간 자동 정리, 서서히 확대·자막 추가 위치 버그 수정
- 자막 위치 '이 자막만' 따로

## 진행 중 / 다음 할 일 후보
- **색감 문제**: 추출 영상이 PC와 아이폰(카톡 전송)에서 색이 다름. 추출 설정은 안 바뀜.
  원인 후보: 아이폰 HDR 원본, 결과 파일 색 정보(BT.601/미표기), 카톡 재압축.
  제안한 해결: 결과를 BT.709로 변환·표기(colr), HDR 원본 감지·안내/보정. 사용자 답 대기 중
  (비교한 것이 추출 mp4인지 미리보기인지, 아이폰 HDR 비디오 켜져 있는지)
- 큰 아이폰 영상 불러오기 느림 → 소리만 골라 읽어 분석하는 개선 제안함 (미적용)
- 클라우드 사용량 표시를 "예상 요금"으로 바꾸는 제안 (미적용, Storage 지역 확인 필요)
- 예전부터 남은 것: Boy reels 5–6마디 끊김, 작은 악보 캡처 인식, 기타 타브 마디 번호 어긋남
- 기타 악보 화면(따라가기 보기)은 바꾸기 전에 반드시 사용자에게 보여주고 확인받기 (한 번 롤백한 적 있음)
