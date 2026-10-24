import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/main.tsx'], bundle: true, format: 'iife', minify: true, write: false,
  target: 'chrome105', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', charset: 'utf8' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/pretendard.css', 'utf8') + '\n' + fs.readFileSync('src/styles.css', 'utf8');
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';
const FB = 'https://www.gstatic.com/firebasejs/10.14.1';
const head = `<title>연주 영상 편집기</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;700;900&family=Gothic+A1:wght@400;700;900&family=Nanum+Gothic:wght@400;700;800&family=Black+Han+Sans&family=Do+Hyeon&family=Jua&family=Sunflower:wght@500;700&family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Serif+KR:wght@400;700;900&family=Gowun+Batang:wght@400;700&family=Song+Myung&family=Gowun+Dodum&family=Nanum+Pen+Script&family=Gaegu:wght@400;700&family=Dongle:wght@400;700&family=Gasoek+One&family=Bagel+Fat+One&display=swap">
<style>${css}</style>`;
const libs = `<script src="${CDN}/react/18.3.1/umd/react.production.min.js"></script>
<script src="${CDN}/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="${CDN}/pdf.js/3.11.174/pdf.min.js"></script>
<script src="${CDN}/pdf.js/3.11.174/pdf.worker.min.js"></script>`;
const app = `<script>${js}</script>`;

// 1) 아티팩트용 (클라우드 없음, 이 브라우저에만 저장)
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/editor.html', `${head}\n<div id="root"></div>\n${libs}\n${app}\n`);

// 2) GitHub Pages용 (구글 로그인 + Firestore)
const out = 'deploy/video-editor';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/index.html`, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head><body><div id="root"></div>
${libs}
<script src="${FB}/firebase-app-compat.js"></script>
<script src="${FB}/firebase-auth-compat.js"></script>
<script src="${FB}/firebase-firestore-compat.js"></script>
<script src="${FB}/firebase-storage-compat.js"></script>
<script src="config.js"></script>
${app}
</body></html>`);
if (!fs.existsSync(`${out}/config.js`)) fs.copyFileSync('deploy/config.template.js', `${out}/config.js`);
fs.copyFileSync('deploy/firestore.rules', `${out}/firestore.rules`);
fs.copyFileSync('deploy/storage.rules', `${out}/storage.rules`);
// 로컬 테스트용 (클라우드 없이 열기)
fs.writeFileSync('dist/index.html', `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${head}</head><body><div id="root"></div>\n${libs}\n${app}\n</body></html>`);
console.log('built', (js.length / 1024).toFixed(0) + 'KB js');
