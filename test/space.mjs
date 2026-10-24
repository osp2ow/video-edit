import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = []; page.on('console', m => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
const paused = () => page.evaluate(() => document.querySelector('video').paused);
const tryCase = async (label, prep) => {
  await page.evaluate(() => document.querySelector('video').pause()); await page.waitForTimeout(200);
  await prep();
  await page.keyboard.press('Space'); await page.waitForTimeout(500);
  console.log(label, '→ playing?', !(await paused()));
  await page.evaluate(() => document.querySelector('video').pause());
};
await tryCase('focus body', async () => { await page.evaluate(() => document.activeElement.blur()); });
await tryCase('after clicking play button', async () => { await page.click('.btn.play'); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('video').pause()); await page.waitForTimeout(200); });
await tryCase('after clicking 전체 보기', async () => { await page.click('text=전체 보기'); });
await tryCase('after slider', async () => { await page.click('#opacity'); });
await tryCase('after timeline click', async () => { const b = await page.locator('.tl-canvas canvas').boundingBox(); await page.mouse.click(b.x + 400, b.y + 120); });
// 연타/빠른 탐색 중 재생
await page.click('.btn.play'); 
for (let i = 0; i < 15; i++) { const b = await page.locator('.tl-canvas canvas').boundingBox(); await page.mouse.click(b.x + 100 + i * 60, b.y + 120); await page.waitForTimeout(60); }
await page.waitForTimeout(1500);
const st = await page.evaluate(() => { const v = document.querySelector('video'); return { paused: v.paused, t: v.currentTime, err: v.error?.code, rs: v.readyState }; });
console.log('after rapid seeks', JSON.stringify(st));
console.log(logs.filter(l => !l.includes('fonts') && !l.includes('ERR_FAILED')).join('\n'));
await browser.close();
