// 같은 이름 파일로 바꾸기: 영상 추가 · 녹음본 추가 · 악보 추가 · 앵글 · 기준 영상 (타임라인 설정 유지)
// 사용법: node test/replace.mjs <av 폴더> <sheets 폴더> <같은 이름 새 파일 폴더>
import { chromium } from 'playwright-core';
const [A, S, ALT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const st = () => page.textContent('.status');
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', A + '/main2.mp4'); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(600);
await page.setInputFiles('#f-rec', A + '/rec2.mp3'); await waitMsg(/자동 감지|녹음본 분석 완료/); await page.waitForTimeout(600);
await page.setInputFiles('#f-source', A + '/second.mp4'); await waitMsg(/옮길 수 있어요/); await page.waitForTimeout(600);
await page.setInputFiles('#f-rec2', A + '/rec3.mp3'); await waitMsg(/양 끝을 줄일 수/); await page.waitForTimeout(600);
await page.setInputFiles('#f-sheet', S + '/sheetA.png'); await page.waitForTimeout(1500);
await page.setInputFiles('#f-sheet2', S + '/sheetB.png'); await waitMsg(/붙였어요/); await page.waitForTimeout(400);
await page.setInputFiles('#f-angle', A + '/angle.mov'); await waitMsg(/앵글을 추가했어요/); await page.waitForTimeout(800);
// 설정을 좀 바꿔 둠: 두 번째 영상 페이드 · 추가 녹음본 줄이기 · 앵글 싱크
let p = await P();
const c2 = p.clips.find(c => c.src === 'second.mp4');
await page.evaluate(() => 0);
const vidDur = () => page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => [decodeURIComponent(v.src).slice(-6), +v.duration.toFixed(2)]));
console.log('videos before', JSON.stringify(await vidDur()));
const before = JSON.stringify({ clips: p.clips, recClips: p.recClips, sheetClips: p.sheetClips, off: p.angleOffsets });
// 1) 영상 2 '바꾸기' (같은 이름, 내용 다름 6초)
await page.setInputFiles('#rep-src-0', ALT + '/second.mp4'); await waitMsg(/바꿨어요/); await page.waitForTimeout(800);
console.log('  ', await st());
let v = await vidDur(); console.log('videos after', JSON.stringify(v));
ok('second video replaced (6s)', v.some(([, d]) => d === 6));
p = await P(); ok('clip kept', JSON.stringify(p.clips) === JSON.stringify(JSON.parse(before).clips));
ok('only one source entry', await page.locator('.src-item', { hasText: '영상 2' }).count() === 1 && await page.locator('.src-item', { hasText: '영상 3' }).count() === 0);
// 2) '영상 추가'로 같은 이름 → 거절 대신 바꾸기
await page.setInputFiles('#f-source', A + '/second.mp4'); await waitMsg(/바꿨어요|이미/); console.log('  ', await st());
ok('add same name → replaced', /바꿨어요/.test(await st()));
// 3) 녹음본 2 바꾸기
await page.setInputFiles('#rep-rec-0', ALT + '/rec3.mp3'); await waitMsg(/바꿨어요/); await page.waitForTimeout(400);
p = await P(); ok('rec clip kept', JSON.stringify(p.recClips) === JSON.stringify(JSON.parse(before).recClips));
await page.setInputFiles('#f-rec2', A + '/rec3.mp3'); await waitMsg(/바꿨어요|이미/); ok('add same rec name → replaced', /바꿨어요/.test(await st()));
// 4) 악보 2 바꾸기
await page.setInputFiles('#rep-sheet-0', ALT + '/sheetB.png'); await waitMsg(/바꿨어요|찾지 못/); await page.waitForTimeout(300);
p = await P(); ok('sheet clips kept', JSON.stringify(p.sheetClips) === JSON.stringify(JSON.parse(before).sheetClips) && await page.locator('.src-item', { hasText: '악보 2' }).count() === 1);
// 5) 앵글 바꾸기
await page.setInputFiles('#rep-angle-2', ALT + '/angle.mov'); await waitMsg(/앵글을 추가했어요/); await page.waitForTimeout(600);
p = await P(); ok('angle offset kept', JSON.stringify(p.angleOffsets) === JSON.stringify(JSON.parse(before).off));
v = await vidDur(); console.log('videos', JSON.stringify(v));
// 6) 기준 영상 같은 이름 다시
await page.setInputFiles('#f-video', A + '/main2.mp4'); await waitMsg(/분석 완료/); await page.waitForTimeout(600);
p = await P(); ok('main replace keeps clips', p.clips?.length === 2);
// 7) 다른 이름으로 바꾸기 → 조각이 새 이름을 씀
await page.setInputFiles('#rep-src-0', A + '/main.mp4'); await waitMsg(/바꿨어요|이미/); await page.waitForTimeout(600);
p = await P(); console.log('  ', await st()); ok('rename source → clips use new name', p.clips.some(c => c.src === 'main.mp4') && !p.clips.some(c => c.src === 'second.mp4'));
console.log(logs.join('\n') || 'no page errors');
await browser.close();
