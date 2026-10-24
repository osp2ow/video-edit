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
let p0 = await P(); console.log('start', 'rec', p0.recOffset, 'anchor', p0.anchorTime.toFixed(3), 'bpm', p0.bpm);
// 1) 녹음본 줄 끌기 (오른쪽 30px)
const tl2 = await page.locator('.tl-canvas canvas').boundingBox(); const recY = tl2.y + 28 + 128 + 56 + 25; console.log('canvas h', tl2.height);
await page.mouse.move(X(20), recY); await page.mouse.down(); await page.mouse.move(X(20) + 30, recY, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(1600); let p1 = await P(); console.log('rec after slip', p1.recOffset, 'expected ~', (p0.recOffset - 30 / pps).toFixed(3));
// 2) 1마디 손잡이 끌기 (+20px)
const L1 = p1.beatsPerBar * 60 / p1.bpm, hb = Math.max(0, Math.ceil(1 + (0 - p1.anchorTime) / L1 - 1e-6)), th = p1.anchorTime + (hb - 1) * L1;
await page.mouse.move(X(th), tl.y + 6); await page.mouse.down(); await page.mouse.move(X(th) + 20, tl.y + 6, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(1600); let p2 = await P(); console.log('anchor', p1.anchorTime.toFixed(3), '->', p2.anchorTime.toFixed(3), 'touched', p2.anchorTouched);
// 3) Shift + 5마디선 끌기 → BPM
const L2 = p2.beatsPerBar * 60 / p2.bpm, hb2 = Math.max(0, Math.ceil(1 + (0 - p2.anchorTime) / L2 - 1e-6)), bar5 = p2.anchorTime + (hb2 + 4 - 1) * L2;
await page.keyboard.down('Shift'); await page.mouse.move(X(bar5), tl.y + 6); await page.mouse.down(); await page.mouse.move(X(bar5) + 15, tl.y + 6, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
await page.waitForTimeout(1600); let p3 = await P(); console.log('bpm', p2.bpm, '->', p3.bpm, 'handle bar time', (p2.anchorTime + (hb2-1)*L2).toFixed(3), '->', (p3.anchorTime + (hb2-1)*p3.beatsPerBar*60/p3.bpm).toFixed(3));
// 4) 자르기
await page.click('.tl-cut');
await page.mouse.move(X(10), tl.y + 80); await page.mouse.down(); await page.mouse.move(X(14), tl.y + 80, { steps: 8 }); await page.mouse.up();
await page.keyboard.press('Escape');
let p4 = await P(); console.log('skips', JSON.stringify(p4.skips.map(k => [k.start.toFixed(3), k.end.toFixed(3)])), 'beat', (60 / p4.bpm).toFixed(3));
await page.screenshot({ path: 'test/sync_tl.png', clip: { x: 0, y: 820, width: 1920, height: 260 } });
// 5) 재생하면 건너뛰기
await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 9.3; }); await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('video').play()); await page.waitForTimeout(1600);
console.log('time after play over cut', (await page.evaluate(() => document.querySelector('video').currentTime)).toFixed(2));
await page.evaluate(() => document.querySelector('video').pause());
// 6) Alt+→ 녹음본 10ms
await page.mouse.click(X(30), recY); await page.waitForTimeout(1500); const r0 = (await P()).recOffset; await page.keyboard.press('Alt+ArrowRight'); await page.waitForTimeout(1600);
console.log('alt nudge', r0, '->', (await P()).recOffset);
console.log(logs.join('\n')); await browser.close();
