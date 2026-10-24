import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/tab/tab6.png');
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
console.log(await page.evaluate(() => document.querySelector('.status')?.textContent));
await page.waitForTimeout(500);
// 따라가기 마디 수 4로
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '화면')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => { const el = document.querySelector('#follow-bars'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '4'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(300);
const fs = await import('fs');
for (const t of [4, 9, 12, 17, 22]) {
  await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(500);
  const url = await page.evaluate(() => document.querySelector('.stage-box > canvas').toDataURL('image/png'));
  fs.writeFileSync(`test/strip_${t}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log(logs.join('\n')); await browser.close();
