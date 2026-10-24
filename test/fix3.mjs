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
// 1) 템포 칸 다 지우고 다시 입력
await page.click('#bpm', { clickCount: 3 }); await page.keyboard.press('Backspace');
console.log('bpm field after clear:', JSON.stringify(await page.inputValue('#bpm')));
await page.keyboard.type('93'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
console.log('bpm now', (await P()).bpm, 'field', await page.inputValue('#bpm'));
// 2) 확대한 상태에서 기준 영상 조각 끌기
await page.mouse.click(X(10), tl.y + 21); await page.waitForTimeout(200);
await page.keyboard.press('i'); await page.waitForTimeout(800);   // 10초에서 자르기
for (let i = 0; i < 5; i++) await page.keyboard.press('Control+ArrowRight');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/f3_before.png', clip: { x: 0, y: tl.y - 40, width: 1920, height: 300 } });
const mainY = tl.y + 30 + 132 + 25;
const c0 = (await P()).clips; console.log('clips', JSON.stringify(c0.map(c => c.start.toFixed(3))));
// 재생 위치(10초)는 화면 가운데쯤 — 오른쪽 조각을 잡고 살짝씩 끌기
const box = await page.locator('.tl-canvas canvas').boundingBox();
const sx = box.x + box.width * 0.6;
await page.mouse.move(sx, mainY); await page.mouse.down();
const tips = [];
for (let dx = 4; dx <= 120; dx += 8) { await page.mouse.move(sx + dx, mainY); await page.waitForTimeout(30); tips.push(await page.evaluate(() => (window).__tip || '')); }
await page.screenshot({ path: 'test/f3_drag.png', clip: { x: 0, y: tl.y - 40, width: 1920, height: 300 } });
await page.mouse.up(); await page.waitForTimeout(1300);
const c1 = (await P()).clips; console.log('after drag', JSON.stringify(c1.map(c => c.start.toFixed(3))), 'beat', (60 / (await P()).bpm).toFixed(3));
await page.screenshot({ path: 'test/f3_after.png', clip: { x: 0, y: tl.y - 40, width: 1920, height: 300 } });
console.log(logs.join('\n')); await browser.close();
