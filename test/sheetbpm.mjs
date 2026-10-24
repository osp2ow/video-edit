import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.setInputFiles('#f-sheet2', '/tmp/claude-0/sheet2.pdf');
await page.waitForFunction(() => /앞 악보 뒤에 붙였어요/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
const P = () => page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test.webm')));
await page.click('text=전체 보기'); await page.waitForTimeout(300);
const box = await page.locator('.tl-canvas canvas').boundingBox();
let found = false;
for (let y = box.y + 30; y < box.y + box.height && !found; y += 10) {
  await page.mouse.click(box.x + box.width - 30, y);
  await page.waitForTimeout(60);
  if (await page.$('#sheet-bpm')) { found = true; console.log('sheet clip at y', y - box.y); }
}
console.log('label:', await page.evaluate(() => document.querySelector('.tl-bpm')?.textContent));
let p = await P(); const s2 = p.sheetClips.find(c => c.sheet);
const bar = t => page.evaluate(t => 0, t);
await page.fill('#sheet-bpm', '120'); await page.press('#sheet-bpm', 'Enter'); await page.waitForTimeout(800);
p = await P();
console.log('base bpm', p.bpm, 'clips', JSON.stringify(p.sheetClips.map(c => [c.sheet || '1', c.start.toFixed(2), c.bpm])));
console.log('status', await page.evaluate(() => document.querySelector('.status').textContent));
await page.screenshot({ path: 'test/sheetbpm.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
console.log(logs.join('\n')); await browser.close();
