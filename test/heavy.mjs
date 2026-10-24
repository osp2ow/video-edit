import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const page = await ctx.newPage(); page.on('console', m => { if (m.text().includes('[추출]')) console.log('LOG', m.text()); });
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
const THR = +(process.env.THR || 4);
// 자막 10개 (그림자 · 테두리 기본)
const rulerY = tl.y + 21;
for (let i = 0; i < 10; i++) {
  await page.mouse.click(X(2 + i * 0.8), rulerY); await page.waitForTimeout(120);
  await page.keyboard.press('Shift+KeyC'); await page.waitForTimeout(150);
  await page.fill('#cap-text', `가스펠 필인 ${i + 1}번\n손손발 트리플렛으로 굴리기`); await page.evaluate(() => document.activeElement.blur());
}
await page.waitForTimeout(1500);
console.log('captions', (await P()).captions.length);
// 반복 구간 2~10초
const cycY = tl.y + 5;
await page.mouse.move(X(2), cycY); await page.mouse.down(); await page.mouse.move(X(10), cycY, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1300);
const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
await page.click('.export-btn');
const dlP = page.waitForEvent('download', { timeout: 400000 });
const t0 = Date.now();
await page.click('text=추출 시작');
await page.waitForFunction(() => document.querySelector('.ok-text') || document.querySelector('.modal-body > .warn-text'), null, { timeout: 400000, polling: 1000 });
console.log('export took', (Date.now() - t0) / 1000, 's');
const dl = await dlP; await dl.saveAs(process.env.OUT || 'test/heavy.mp4');
console.log(logs.join('\n')); await browser.close();
