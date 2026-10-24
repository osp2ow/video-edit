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
const tlb = await page.locator('.tl-canvas canvas').boundingBox();
let p0 = await P(); const bt = 60 / p0.bpm, bl = bt * p0.beatsPerBar;
// 실제 화면 배율 다시 계산 (타임라인 길이 기준)
const tlEnd = await page.evaluate(() => { const t = document.querySelectorAll('.clock .mono')[1].textContent.replace('/ ', ''); const [m, s] = t.split(':'); return +m * 60 + +s; });
const pps2 = (tlb.width - 2) / (tlEnd * 1.02), X2 = t => tlb.x + (t + tlEnd * 0.01) * pps2;
const sheetY = tlb.y + 30 + 68 + 13, rulerY = tlb.y + 21;
console.log('anchor', p0.anchorTime.toFixed(3), 'sheetClips', JSON.stringify(p0.sheetClips), 'cardSegs', JSON.stringify(p0.cardSegs));
await page.screenshot({ path: 'test/sc0.png', clip: { x: 0, y: tlb.y - 40, width: 1920, height: 200 } });
// 1) 악보 조각 가운데 잡고 2.2박 오른쪽
const h = Math.max(p0.anchorTime, 0) + bl * 2;   // 화면 안쪽 지점 (악보 조각 안)
await page.mouse.move(X2(h + 6), sheetY); await page.mouse.down(); await page.mouse.move(X2(h + 6) + bt * pps2 * 2.2, sheetY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p1 = await P(); console.log('moved:', ((p1.sheetClips[0].start - p0.anchorTime) / bt).toFixed(3), 'beats', JSON.stringify(p1.sheetClips));
// 2) 재생 위치를 h+2*bt+4마디로, 악보 조각 고르고 I로 자르기
const cutT = p1.sheetClips[0].start + 4 * bl;
await page.mouse.click(X2(cutT), rulerY); await page.waitForTimeout(200);
await page.mouse.click(X2(cutT - bl), sheetY); await page.waitForTimeout(200);
await page.mouse.click(X2(cutT), rulerY); await page.waitForTimeout(200);
await page.keyboard.press('i'); await page.waitForTimeout(1500);
let p2 = await P(); console.log('split:', JSON.stringify(p2.sheetClips.map(c => [c.start.toFixed(2), c.barIn.toFixed(3), c.barOut.toFixed(3)])));
// 3) 두 번째 조각을 4박 오른쪽으로
const c2 = p2.sheetClips[1];
await page.mouse.move(X2(c2.start + bl * 2), sheetY); await page.mouse.down(); await page.mouse.move(X2(c2.start + bl * 2) + bt * pps2 * 4.1, sheetY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p3 = await P(); console.log('second moved:', ((p3.sheetClips[1].start - c2.start) / bt).toFixed(3), 'beats');
// 4) 첫 조각 왼쪽 끝을 1마디 왼쪽으로 늘리기
const c1 = p3.sheetClips[1];
await page.mouse.move(X2(c1.start) + 2, sheetY); await page.mouse.down(); await page.mouse.move(X2(c1.start - bt) + 2, sheetY, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(1500);
let p4 = await P(); console.log('trim in:', JSON.stringify(p4.sheetClips.map(c => [c.start.toFixed(2), c.barIn.toFixed(3), c.barOut.toFixed(3)])));
await page.screenshot({ path: 'test/sc1.png', clip: { x: 0, y: tlb.y - 40, width: 1920, height: 200 } });
// 5) 빈자리 (첫 조각 끝 ~ 둘째 조각 시작) 에서 카드 안 보이는지: 미리보기 캡처
const gapT = (p4.sheetClips[0].start + 4 * bl + p4.sheetClips[1].start) / 2;
await page.mouse.click(X2(gapT), rulerY); await page.waitForTimeout(800);
await page.locator('.stage-box > canvas').first().screenshot({ path: 'test/sc_gap.png' }).catch(e => console.log('prev shot fail', e.message));
await page.mouse.click(X2(cutT - bl * 1.5), rulerY); await page.waitForTimeout(800);
await page.locator('.stage-box > canvas').first().screenshot({ path: 'test/sc_in.png' }).catch(e => console.log('prev shot fail', e.message));
// 6) 둘째 조각 고르고 Delete
await page.mouse.click(X2(p4.sheetClips[1].start + bl), sheetY); await page.waitForTimeout(200);
await page.keyboard.press('Delete'); await page.waitForTimeout(1500);
console.log('after delete count', (await P()).sheetClips.length);
await page.click('text=악보 처음대로'); await page.waitForTimeout(1500);
console.log('after reset', JSON.stringify((await P()).sheetClips));
console.log(logs.join('\n')); await browser.close();
