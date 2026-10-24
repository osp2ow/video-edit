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
const recY = tl2.y + 28 + 184 + 25;
const tl3 = await page.locator('.tl-canvas canvas').boundingBox();
const mainY = tl3.y + 28 + 128 + 25;
const bt = 60 / (await P()).bpm;
// 기준 영상을 왼쪽으로 8박 옮겨 0초보다 앞으로 나가게
await page.mouse.move(X(10), mainY); await page.mouse.down(); await page.mouse.move(X(10) - bt * 8 * pps, mainY, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
console.log('clips', JSON.stringify((await P()).clips));
for (const t of [1, 5, 20]) {
  await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(200);
  const now = await page.evaluate(() => document.querySelector('.mono')?.textContent);
  await page.keyboard.press('KeyI'); await page.waitForTimeout(200);
  console.log('t', t, 'clock', now, 'clips', (await P()).clips.length);
}
// 슬라이더를 만진 뒤 I
const sl = page.locator('input[type=range]').first(); await sl.focus();
await page.mouse.click(X(25), tl.y + 21).catch(() => {}); await sl.focus();
await page.keyboard.press('KeyI'); await page.waitForTimeout(200);
console.log('after slider focus clips', (await P()).clips.length, 'active', await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.type));
// 악보 조각을 고른 뒤 악보 밖(영상만 있는 곳)에서 I
const kY = tl.y + 30 + 6 + 24 + 6 + 26 + 6 + 13;
const sc = (await P()).sheetClips; 
await page.mouse.click(X(30), kY); await page.waitForTimeout(150);
await page.mouse.click(X(2), tl.y + 21); await page.waitForTimeout(150);
const n0 = (await P()).clips.length; await page.keyboard.press('KeyI'); await page.waitForTimeout(200);
console.log('sheet selected, split video', n0, '→', (await P()).clips.length);
console.log(logs.join('\n')); await browser.close();
