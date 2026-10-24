import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(800);
const P = () => page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test.webm')));
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const d = await page.evaluate(() => document.querySelector('video').duration);
const pps = (tl.width - 2) / (d * 1.02);
const X = t => tl.x + (t + d * 0.01) * pps;
const tl2 = await page.locator('.tl-canvas canvas').boundingBox();
const mainY = tl2.y + 28 + 128 + 25, recY = tl2.y + 28 + 184 + 25;
let p0 = await P(); console.log('rec offset', p0.recOffset);
// 기준 영상 앞부분 줄이기: 왼쪽 끝 손잡이 → 3초
await page.mouse.move(X(0) + 3, mainY); await page.mouse.down(); await page.mouse.move(X(3), mainY, { steps: 6 }); await page.mouse.up();
// 녹음본 뒷부분 줄이기: 오른쪽 끝 → 영상 30초 지점
const recEnd = await page.evaluate(() => 0); 
await page.waitForTimeout(1500);
let p1 = await P(); console.log('main trim', JSON.stringify(p1.trims));
const recDurVid = (t) => t;
// 녹음본 오른쪽 끝 찾기: 영상 시간 = 녹음 길이 - 오프셋
const recLen = await page.evaluate(() => 0);
const rr = await page.evaluate(() => 0);
await page.mouse.move(1832, recY); await page.mouse.down(); await page.mouse.move(X(30), recY, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p2 = await P(); console.log('trims', JSON.stringify(p2.trims), 'rec offset still', p2.recOffset);
// 녹음본 가운데 잡고 옮기기
await page.mouse.move(X(15), recY); await page.mouse.down(); await page.mouse.move(X(15) - 20, recY, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p3 = await P(); console.log('after move rec offset', p3.recOffset, 'trim same', JSON.stringify(p3.trims.rec));
await page.click('.export-btn'); await page.click('text=720p');
console.log('export note', await page.evaluate(() => document.querySelector('.modal .note.mono').textContent));
await page.click('text=추출 시작');
const dl = await page.waitForEvent('download', { timeout: 200000 }); await dl.saveAs('test/out_trim.mp4');
await page.screenshot({ path: 'test/trim_tl.png', clip: { x: 0, y: 780, width: 1920, height: 300 } });
console.log(logs.join('\n')); await browser.close();
