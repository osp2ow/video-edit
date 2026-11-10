// 같은 이름 다른 내용의 영상으로 바꾸기: 기준 영상(빨강→파랑) · 추가 영상/PIP(초록→노랑)이 미리보기·추출에 새 내용으로 나오는지
// 사용법: node test/samename.mjs <a 폴더(clip.mp4 빨강, pip.mp4 초록)> <b 폴더(clip.mp4 파랑, pip.mp4 노랑)>  (MP4BOX·OUT 주면 추출 확인)
import { chromium } from 'playwright-core';
const [A, B] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', ...(process.env.MP4BOX ? { 'mp4box.all.min.js': process.env.MP4BOX } : {}) };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const st = () => page.textContent('.status');
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
const COLORS = { red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], yellow: [255, 255, 0] };
const nameOf = ([r, g, b]) => Object.entries(COLORS).map(([n, c]) => [n, (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2]).sort((a, b) => a[1] - b[1])[0][0];
const px = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
// 9:16 PIP 기본 자리: 폭 0.4W, 16:9 영상 → 높이 0.225W, 아래 끝 0.74H → 가운데 (0.76W, 0.74H - 0.1125W)
const pipPt = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); return [0.76, 0.74 - 0.1125 * c.width / c.height]; });
const look = async (t) => { await page.evaluate(t => window.__pveTransport.seek(t), t); await page.waitForTimeout(900); const [px1, py1] = await pipPt(); return { main: nameOf(await px(0.3, 0.5)), pip: nameOf(await px(px1, py1)) }; };

await page.setInputFiles('#f-video', A + '/clip.mp4'); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-source', A + '/pip.mp4'); await waitMsg(/옮길 수 있어요|붙였어요/); await page.waitForTimeout(800);
await page.evaluate(() => window.__pveTransport.seek(2)); await page.waitForTimeout(400);
await page.click('.src-item >> text=PIP로'); await page.waitForTimeout(900);
let p = await P(); console.log('clips', JSON.stringify(p.clips.map(c => [c.src || 'main', c.start])), 'overlays', JSON.stringify((p.overlays || []).map(o => [o.src, o.start, o.srcOut])));
const ov0 = JSON.stringify(p.overlays), cl0 = JSON.stringify(p.clips);
let s = await look(3); console.log('before', JSON.stringify(s));
if (process.env.SHOT) await page.locator('canvas.stage').screenshot({ path: process.env.SHOT });
ok('before: main red, PIP green', s.main === 'red' && s.pip === 'green');

// 1) 기준 영상을 같은 이름(파랑)으로
await page.setInputFiles('#f-video', B + '/clip.mp4'); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(1200);
console.log('  ', await st());
s = await look(3); console.log('after main replace', JSON.stringify(s));
ok('main video shows NEW content (blue)', s.main === 'blue');
p = await P(); ok('main replace keeps clips & PIP', JSON.stringify(p.clips) === cl0 && JSON.stringify(p.overlays) === ov0);
// 2) PIP 영상을 같은 이름(노랑)으로 '바꾸기'
await page.setInputFiles('#rep-src-0', B + '/pip.mp4'); await waitMsg(/바꿨어요/); await page.waitForTimeout(1200);
console.log('  ', await st());
s = await look(3.5); console.log('after PIP replace', JSON.stringify(s));
ok('PIP shows NEW content (yellow)', s.pip === 'yellow' && s.main === 'blue');
p = await P(); ok('PIP replace keeps PIP position', JSON.stringify(p.overlays) === ov0);
// 2-1) 재생해도 새 내용
await page.evaluate(() => window.__pveTransport.play(2.5)); await page.waitForTimeout(1500);
{ const [x, y] = await pipPt(); const m = nameOf(await px(0.3, 0.5)), q = nameOf(await px(x, y)); await page.evaluate(() => window.__pveTransport.pause()); console.log('playing', m, q); ok('while playing: blue + yellow', m === 'blue' && q === 'yellow'); }
// 3) '영상 추가'로 같은 이름을 또 넣어도 바꾸기로 (PIP 그대로)
await page.setInputFiles('#f-source', A + '/pip.mp4'); await waitMsg(/바꿨어요|이미/); await page.waitForTimeout(1200);
s = await look(3.5); console.log('re-add same name (green)', JSON.stringify(s), await st());
ok('add same name again → PIP replaced back to green', s.pip === 'green' && JSON.stringify((await P()).overlays) === ov0);
// 4) PIP 끄기 → 영상 줄에서 화면 가득 그 영상
await page.click('.src-item >> text=PIP 끄기'); await page.waitForTimeout(900);
s = await look(3.5); console.log('PIP off', JSON.stringify(s));
ok('PIP off → full screen shows the replaced video', s.main === 'green');
await page.click('.src-item >> text=PIP로'); await page.waitForTimeout(900);
// 5) 추출 (OUT): 파랑 화면 + PIP
if (process.env.OUT) {
  await page.click('.export-btn'); await page.click('text=720p');
  const dlP = page.waitForEvent('download', { timeout: 300000 });
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  await page.click('text=추출 시작');
  await page.waitForFunction(() => document.querySelector('.ok-text') || /실패|못 했|오류/.test(document.querySelector('.modal-body')?.textContent || ''), null, { timeout: 300000 });
  console.log('export:', (await page.textContent('.modal-body')).slice(0, 60));
  await (await dlP).saveAs(process.env.OUT);
  p = await P(); console.log('EXPORT_PIP', JSON.stringify(p.overlays.map(o => [o.start, clipEndOf(o)])));
}
function clipEndOf(o) { return o.start + o.srcOut - o.srcIn; }
console.log(logs.join('\n') || 'no page errors');
await browser.close();
