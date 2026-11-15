// 로고 워터마크를 미리보기에서 끌어 옮기기 · 모서리로 크기 · 더블클릭으로 정해진 자리
import { chromium } from 'playwright-core';
const [V, SH, LOGO, SHOT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
if (SH) { await page.setInputFiles('#f-sheet', SH); await page.waitForTimeout(2000); }
await page.click('text=효과'); await page.waitForTimeout(300);
await page.setInputFiles('#logo-file', LOGO); await page.waitForTimeout(800);
await page.click('.subbox .seg button:has-text("↗")'); await page.waitForTimeout(300);
await page.evaluate(() => window.__pveTransport.seek(3)); await page.waitForTimeout(800);
// 로고(하늘색) 상자 찾기 (화면 비율 0~1)
const logoBox = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'), b = window.__pveLogo(); return b && { x0: b.x / c.width, y0: b.y / c.height, x1: (b.x + b.w) / c.width, y1: (b.y + b.h) / c.height }; });
const b0 = await logoBox(); console.log('preset ↗', JSON.stringify(b0));
const cv = await page.locator('canvas.stage').boundingBox();
const at = (fx, fy) => [cv.x + cv.width * fx, cv.y + cv.height * fy];
// 1) 끌어 옮기기: 로고 가운데 → 왼쪽 아래 쪽으로
let [sx, sy] = at((b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2);
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - cv.width * 0.45, sy + cv.height * 0.3, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(500);
const b1 = await logoBox(); let p = await P(); console.log('after drag', JSON.stringify(b1), JSON.stringify(p.fx?.watermark?.at));
ok('drag moves the logo (left & down)', b1 && b1.x0 < b0.x0 - 0.3 && b1.y0 > b0.y0 + 0.2);
// 2) 모서리로 크기
const w1 = b1.x1 - b1.x0; [sx, sy] = at(b1.x1, b1.y1);
await page.mouse.move(sx - 2, sy - 2); await page.mouse.down(); await page.mouse.move(sx + cv.width * 0.15, sy + cv.height * 0.05, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
const b2 = await logoBox(); p = await P(); console.log('after resize', JSON.stringify(b2), 'size', p.fx?.watermark?.size);
ok('corner drag makes the logo bigger', b2 && b2.x1 - b2.x0 > w1 * 1.3);
if (SHOT) await page.locator('canvas.stage').screenshot({ path: SHOT });
// 3) 다른 비율에서는 따로 (16:9는 정해진 자리 그대로)
await page.click('text=화면'); await page.click('.seg >> text=16:9'); await page.waitForTimeout(800);
const b3 = await logoBox(); console.log('16:9', JSON.stringify(b3));
ok('other ratio keeps its own (preset) spot', b3 && b3.x1 > 0.85 && b3.y0 < 0.3);
await page.click('.seg >> text=9:16'); await page.click('text=효과'); await page.waitForTimeout(800);
// 4) 더블클릭 → 정해진 자리로
const b4 = await logoBox(); [sx, sy] = at((b4.x0 + b4.x1) / 2, (b4.y0 + b4.y1) / 2);
await page.mouse.dblclick(sx, sy); await page.waitForTimeout(600);
const b5 = await logoBox(); console.log('after dblclick', JSON.stringify(b5));
ok('double-click returns to ↗ spot', b5 && Math.abs(b5.x1 - b0.x1) < 0.02);
// 5) ↗ 버튼도 직접 옮긴 자리를 지움
[sx, sy] = at((b5.x0 + b5.x1) / 2, (b5.y0 + b5.y1) / 2);
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - 100, sy + 100, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
await page.click('.subbox .seg button:has-text("↗")'); await page.waitForTimeout(500);
const b6 = await logoBox(); ok('position button resets the manual spot', b6 && Math.abs(b6.x1 - b0.x1) < 0.02);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
