import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message)); page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE: ' + m.text()); });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.setInputFiles('#f-source', 'test/angle2.webm');
await page.waitForFunction(() => /영상 줄|이어 붙였|맞춰 놓았/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
const st = await page.evaluate(() => document.querySelector('.status').textContent); console.log('status:', st);
const P = () => page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test.webm')));
await page.waitForTimeout(1200);
let p = await P();
console.log('clips', JSON.stringify(p.clips), 'recAt', p.recAt);
console.log('src list', await page.evaluate(() => [...document.querySelectorAll('.src-item')].map(e => e.textContent).join(' | ')));
// add second sheet
await page.setInputFiles('#f-sheet2', '/tmp/claude-0/sheet2.pdf');
await page.waitForFunction(() => /앞 악보 뒤에 붙였어요/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1200);
p = await P();
console.log('sheetClips', JSON.stringify(p.sheetClips));
// play from just before the source clip
const sc = p.clips.find(c => c.src);
const t0 = sc.start - 1.5;
const res = await page.evaluate(async (t0) => {
  const out = [];
  const vids = [...document.querySelectorAll('video')];
  // seek via keyboard is hard; use the exposed transport if any
  return vids.map(v => ({ src: v.src.slice(-20), dur: v.duration }));
}, t0);
console.log('videos', JSON.stringify(res));
await page.screenshot({ path: 'test/multisrc.png' });
console.log(logs.join('\n')); await browser.close();
