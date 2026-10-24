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
await page.setInputFiles('#f-video', 'test/test_onekey.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(800);
const P = () => page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test_onekey.webm')));
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const d = await page.evaluate(() => document.querySelector('video').duration);
const pps = (tl.width - 2) / (d * 1.02);
const X = t => tl.x + (t + d * 0.01) * pps;
const tl2 = await page.locator('.tl-canvas canvas').boundingBox();
const rulerY = tl.y + 21;
// 화면 감시: 미리보기 캔버스 가운데 아래쪽이 빨간지 매 프레임 기록
await page.evaluate(() => {
  const c = document.querySelector('.stage-box > canvas'); const g = c.getContext('2d');
  window.__red = []; const loop = () => { const d = g.getImageData(c.width / 2, c.height * 0.85, 1, 1).data; if (d[0] > 180 && d[1] < 80 && d[2] < 80) window.__red.push(document.querySelector('.now-t').textContent + '/' + document.querySelector('video').currentTime.toFixed(2) + (document.querySelector('video').seeking ? 'S' : '') + (document.querySelector('video').__seekHold ? 'H' : '')); requestAnimationFrame(loop); }; loop();
});
await page.mouse.click(X(5), rulerY); await page.waitForTimeout(1500); await page.evaluate(() => window.__red = []);
// 10초에서 자르기
await page.mouse.click(X(10), rulerY); await page.waitForTimeout(300); await page.keyboard.press('i'); await page.waitForTimeout(500);
console.log('clips', JSON.stringify((await P())?.clips?.map(c => [c.start.toFixed(2), c.srcIn.toFixed(2)])));
await page.evaluate(() => { window.__seeks = 0; document.querySelector('video').addEventListener('seeking', () => window.__seeks++); });
// 8초부터 재생해서 자른 자리 지나가기
await page.mouse.dblclick(X(8), rulerY); await page.waitForTimeout(700); await page.evaluate(() => window.__seeks = 0); await page.waitForTimeout(3800);
await page.keyboard.press('Space');
console.log('seeks during play-through (after start, should be 0):', await page.evaluate(() => window.__seeks)); console.log('red frames while passing split:', await page.evaluate(() => window.__red.length), await page.evaluate(() => [...new Set(window.__red)].slice(0, 12).join(' ')));
// 재생 중에 다른 위치(20초, 30초) 클릭해서 건너뛰기
await page.evaluate(() => window.__red = []);
await page.keyboard.press('Space'); await page.waitForTimeout(500);
for (const t of [20, 30, 15, 25]) { await page.mouse.click(X(t), rulerY); await page.waitForTimeout(900); }
await page.keyboard.press('Space');
console.log('red frames while jumping during playback:', await page.evaluate(() => window.__red.length));
console.log(logs.join('\n')); await browser.close();
