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
let p0 = await P(); const bt = 60 / p0.bpm;
const mainY = tl.y + 30 + 132 + 25, rulerY = tl.y + 21, cycY = tl.y + 5, sheetY = tl.y + 30 + 68 + 13;
const T = () => page.evaluate(() => window.__tnow ? window.__tnow() : null);
// 1) 재생 위치 10초로 → S로 자르기
await page.mouse.click(X(10), rulerY); await page.waitForTimeout(200);
await page.keyboard.press('i'); await page.waitForTimeout(1500);
let p1 = await P(); console.log('clips after split', JSON.stringify(p1.clips?.map(c => [c.start.toFixed(2), c.srcIn.toFixed(2), c.srcOut.toFixed(2)])));
// 2) 두번째 조각을 오른쪽으로 4.3박 끌기 (빈자리 생김)
await page.mouse.move(X(14), mainY); await page.mouse.down(); await page.mouse.move(X(14) + bt * pps * 4.3, mainY, { steps: 12 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p2 = await P(); const c2 = p2.clips[1]; console.log('moved by beats', ((c2.start - c2.srcIn) / bt).toFixed(3));
// 3) 눈금 줄 끌어서 구간 반복 (5s~13s)
await page.mouse.move(X(5), cycY); await page.mouse.down(); await page.mouse.move(X(13), cycY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1200);
const c3a = (await P()).cycle;
// 숫자 부분 끌기 → 재생 위치만 이동, 구간은 그대로
await page.mouse.move(X(8), rulerY); await page.mouse.down(); await page.mouse.move(X(20), rulerY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1200);
console.log('scrub: now', await page.evaluate(() => document.querySelector('.now-t').textContent), 'cycle unchanged', JSON.stringify((await P()).cycle) === JSON.stringify(c3a));
// 노란 띠 가운데 잡고 끌기 → 구간 이동
await page.mouse.move(X(9), cycY); await page.mouse.down(); await page.mouse.move(X(11), cycY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1200);
const c3b = (await P()).cycle; console.log('cycle moved by', (c3b.start - c3a.start).toFixed(3), 'len same', Math.abs((c3b.end - c3b.start) - (c3a.end - c3a.start)) < 1e-6);
await page.mouse.move(X(9), cycY); await page.mouse.down(); await page.mouse.move(X(7), cycY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p3 = await P(); console.log('cycle', JSON.stringify(p3.cycle), 'in beats', ((p3.cycle.end - p3.cycle.start) / bt).toFixed(3));
// 4) 악보 줄 끌어서 2박 미루기
const k0 = p3.sheetShift || 0;
const segs = p3.cardSegs; console.log('cardSegs', JSON.stringify(segs));
const sx = segs && segs.length ? X((segs[0].start + segs[0].end) / 2) : X(30);
await page.mouse.move(sx, sheetY); await page.mouse.down(); await page.mouse.move(sx + bt * pps * 2.2, sheetY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p4 = await P(); console.log('sheetShift', k0, '->', p4.sheetShift);
await page.screenshot({ path: 'test/logic_tl.png', clip: { x: 0, y: tl.y - 40, width: 1920, height: 1080 - tl.y + 40 } });
// 5) 재생 → 반복 확인
await page.keyboard.press('Space'); 
const ts = [];
for (let i = 0; i < 22; i++) { await page.waitForTimeout(500); ts.push((await page.evaluate(() => document.querySelector('.now-t')?.textContent || ''))); }
console.log('times', ts.join(' | '));
await page.keyboard.press('Space');
console.log(logs.join('\n')); await browser.close();
