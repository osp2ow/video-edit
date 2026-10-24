# 연주 영상 편집기 (video-editor)

주니퍼 실용음악학원 선생님용 악기 연주 영상 편집기.
BPM 마디 그리드, 녹음본·멀티 앵글 자동 싱크, 악보 자동 배치와 현재 마디 하이라이트, 릴스·유튜브용 MP4 추출.

- 주소: https://osp2ow.github.io/video-editor/
- 로그인: 구글 계정 (선생님 명단에 있는 계정만)
- 클라우드 저장: 프로젝트 설정(BPM·싱크·앵글 전환·악보 위치·카드 위치)과 공용 레이아웃 템플릿
- 영상·녹음본·악보 파일은 각자 PC에 두고, 프로젝트를 열 때 다시 넣습니다 (같은 이름이면 설정이 그대로 붙음)

## 파일

| 파일 | 내용 |
|---|---|
| `index.html` | 앱 전체 |
| `config.js` | Firebase 연결 설정 — **여기만 직접 채우면 됩니다** |
| `firestore.rules` | 데이터베이스 보안 규칙 (Firebase 콘솔에 붙여넣기) |
| `source/` | 수정용 원본 코드 (사이트에는 필요 없음) |

## 처음 설정 (한 번만)

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com 에서 **프로젝트 추가**
2. 이름: `video-editor` (Google 애널리틱스는 꺼도 됨)

### 2. 웹 앱 등록 → config.js 채우기
1. 프로젝트 개요 화면에서 **웹(`</>`) 아이콘** → 앱 닉네임 `video-editor` → 앱 등록
2. 나오는 `firebaseConfig = { ... }` 안의 값들을 복사해서 `config.js`의 `window.FIREBASE_CONFIG = { ... }` 에 붙여넣기
3. `window.APP_ADMINS`는 관리자 구글 이메일 (기본: osp2ow@gmail.com)

### 3. 구글 로그인 켜기
1. 왼쪽 메뉴 **Authentication** → 시작하기
2. **Sign-in method** 탭 → **Google** → 사용 설정 → 지원 이메일 선택 → 저장
3. **설정** 탭 → **승인된 도메인** → 도메인 추가 → `osp2ow.github.io`

### 4. 데이터베이스 만들기
1. 왼쪽 메뉴 **Firestore Database** → 데이터베이스 만들기
2. 위치: `asia-northeast3 (서울)` → **프로덕션 모드**로 시작
3. **규칙** 탭 → 내용을 모두 지우고 `firestore.rules` 파일 내용을 붙여넣기 → **게시**

> 관리자 이메일을 바꿨다면 `firestore.rules`의 `isAdmin()` 안 이메일도 똑같이 바꿔주세요.

### 5. GitHub에 올리기
1. GitHub에서 새 저장소 `video-editor` 만들기 (**Public**)
2. `index.html`, `config.js`, `firestore.rules`, `README.md`, `source` 폴더 업로드 (Add file → Upload files)
3. 저장소 **Settings → Pages** → Branch: `main` / `(root)` → Save
4. 1~2분 뒤 https://osp2ow.github.io/video-editor/ 접속

### 6. 선생님 등록
1. 관리자 계정으로 로그인
2. 위쪽 **프로젝트** 버튼 → **선생님 관리** 탭 → 선생님 이름과 구글 이메일 추가
3. 명단에 없는 계정으로 로그인하면 "명단에 없어요" 안내가 나옵니다

## 사용 흐름
1. 연주 영상을 넣으면 프로젝트가 자동으로 만들어지고, 작업할 때마다 클라우드에 저장돼요 (위쪽에 "클라우드에 저장됨")
2. 다음에 이어서 하려면 **프로젝트 → 열기** → 안내에 나오는 파일들을 화면에 한꺼번에 끌어다 놓기
3. 다른 선생님 프로젝트는 **모든 선생님** 탭에서 **복사해서 열기** (원본은 바뀌지 않음)
4. 레이아웃 템플릿(악보 카드 위치)은 학원 공용 — 한 사람이 저장하면 모두가 씀

## 참고
- `config.js`의 apiKey는 공개되어도 괜찮습니다. 실제 보호는 `firestore.rules`(명단에 있는 선생님만 접근)가 합니다.
- 설정만 저장하므로 Firebase **무료(Spark) 요금제**로 충분합니다.
- PC용 크롬에서 쓰는 것을 기준으로 만들었습니다. MP4 추출(H.264/AAC)도 크롬 기준입니다.
- `config.js`를 채우지 않으면 로그인 없이 이 브라우저에만 저장하는 모드로 열립니다.
