import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message)); page.on('console', m => { if (m.text().includes('녹음본')) logs.push(m.text()); });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.setInputFiles('#f-rec2', '/tmp/claude-0/rec2.mp3');
await page.waitForFunction(() => /맞춰 놓았|이어 붙였/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
console.log('status:', await page.evaluate(() => document.querySelector('.status').textContent));
let p = await page.evaluate(() => window.__pveTransport.getProject());
console.log('recAt', p.recAt.toFixed(3), 'recClips', JSON.stringify(p.recClips), '(expect at ≈ recAt+10 =', (p.recAt + 10).toFixed(3), ')');
console.log('list:', await page.evaluate(() => [...document.querySelectorAll('.src-item')].map(e => e.textContent).join(' | ')));
// drop a third audio by file input on drag? test removal then re-add by drop route
await page.click('.src-item >> text=빼기'); await page.waitForTimeout(400);
p = await page.evaluate(() => window.__pveTransport.getProject());
console.log('after remove recClips', JSON.stringify(p.recClips));
await page.setInputFiles('#f-rec2', '/tmp/claude-0/rec2.mp3');
await page.waitForFunction(() => /맞춰 놓았|이어 붙였/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(500);
// playback: check two buffer sources scheduled
const n = await page.evaluate(async () => { const tr = window.__pveTransport; await tr.play(12); await new Promise(r => setTimeout(r, 800)); const k = tr.player.srcs.length; tr.pause(); return k; });
console.log('scheduled sources at t=12:', n);
await page.click('text=전체 보기'); await page.waitForTimeout(300);
{
  const box = await page.locator('.tl-canvas canvas').boundingBox();
  const p0 = await page.evaluate(() => window.__pveTransport.getProject());
  const end = 46.733 * 1.02, pps = (box.width - 2) / end, X = t => box.x + (t + 46.733 * 0.01) * pps;
  // find rec row y: scan for selection label change is hard; rec row is last row
  const y = box.y + box.height - 30;
  await page.mouse.move(X(15), y); await page.mouse.down(); await page.mouse.move(X(15) + 120, y, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const p1 = await page.evaluate(() => window.__pveTransport.getProject());
  console.log('drag rec2: at', p0.recClips[0].at, '→', p1.recClips[0].at.toFixed(3), '| recAt same', p0.recAt === p1.recAt);
  // trim rec2 end
  const tEnd = p1.recClips[0].at + 15;
  await page.mouse.move(X(tEnd) - 3, y); await page.mouse.down(); await page.mouse.move(X(tEnd) - 150, y, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const p2 = await page.evaluate(() => window.__pveTransport.getProject());
  console.log('trim rec2:', JSON.stringify(p2.trims), 'at', p2.recClips[0].at.toFixed(3));
}
await page.screenshot({ path: 'test/multirec.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
await page.screenshot({ path: 'test/multirec_left.png', clip: { x: 0, y: 60, width: 420, height: 500 } });
console.log(logs.join('\n')); await browser.close();
