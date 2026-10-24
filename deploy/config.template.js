// ===== 연주 영상 편집기 설정 =====
// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) > "SDK 설정 및 구성"의 firebaseConfig 값을 그대로 붙여넣으세요.
window.FIREBASE_CONFIG = {
  apiKey: "여기에-apiKey-붙여넣기",
  authDomain: "video-editor-xxxxx.firebaseapp.com",
  projectId: "video-editor-xxxxx",
  storageBucket: "video-editor-xxxxx.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

// 관리자(선생님 명단을 관리하는 사람) 구글 이메일.
// 바꾸면 firestore.rules 안의 isAdmin() 목록도 똑같이 바꿔야 해요.
window.APP_ADMINS = ["osp2ow@gmail.com"];
