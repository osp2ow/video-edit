// PIP 작은 화면: 끌어서 옮기기 · 모서리로 크기 · 더블클릭으로 기본 자리
// 사용법: node test/pipdrag.mjs 기준영상 앵글영상 [스크린샷 폴더]
import { chromium } from 'playwright-core';
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', process.argv[2]);
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('분석'), null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.setInputFiles('#f-angle', process.argv[3]);
await page.waitForFunction(() => /앵글을 추가했어요/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.click('button:text-is("PIP")');
await page.waitForTimeout(300);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)).pip || null; });
const box = await page.locator('canvas.stage').boundingBox();
const W = 1080, H = 1920, k = box.width / W;
const at = (cx, cy) => [box.x + cx * k, box.y + cy * k];
// 기본 자리 (9:16): w=0.4W, h=1.25w, x=W-w-0.04W, y=0.16H
const pw = 0.4 * W, ph = pw * 1.25, px = W - pw - 0.04 * W, py = 0.16 * H;
const shot = n => process.argv[4] && page.screenshot({ path: `${process.argv[4]}/${n}.png`, clip: box });
const ok = (name, c) => console.log(c ? 'ok  ' : 'FAIL', name);
// 1) 가운데를 잡고 왼쪽 아래로
let [sx, sy] = at(px + pw / 2, py + ph / 2);
await page.mouse.move(sx, sy); await page.mouse.down();
let [tx, ty] = at(0.3 * W, 0.62 * H);
await page.mouse.move(tx, ty, { steps: 12 }); await shot('1-dragging'); await page.mouse.up();
await page.waitForTimeout(200);
let pip = await P(); console.log('after move', JSON.stringify(pip));
ok('moved left/down', pip?.['9:16'] && pip['9:16'].x < 0.2 && pip['9:16'].y > 0.4);
await shot('2-moved');
// 2) 오른쪽 아래 모서리로 크기 키우기
const b = pip['9:16'], bx = b.x * W, by = b.y * H, bw = b.w * W;
[sx, sy] = at(bx + bw, by + bw * 1.25);
await page.mouse.move(sx, sy); await page.mouse.down();
await page.mouse.move(sx + 120 * k, sy + 120 * k, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
pip = await P(); console.log('after resize', JSON.stringify(pip));
ok('resized bigger', pip['9:16'].w > b.w + 0.05 && Math.abs(pip['9:16'].x - b.x) < 1e-6);
await shot('3-resized');
// 3) 화면 밖으로 못 나가게
const c = pip['9:16'];
[sx, sy] = at(c.x * W + 30, c.y * H + 30);
await page.mouse.move(sx, sy); await page.mouse.down();
await page.mouse.move(box.x - 300, box.y + box.height + 300, { steps: 8 }); await page.mouse.up();
pip = await P();
const d = pip['9:16'];
ok('kept inside frame', d.x >= 0 && d.y * H + d.w * W * 1.25 <= H + 0.5);
// 4) 더블클릭 → 기본 자리
[sx, sy] = at(d.x * W + d.w * W / 2, d.y * H + 40);
await page.mouse.dblclick(sx, sy);
await page.waitForTimeout(200);
pip = await P(); console.log('after dblclick', JSON.stringify(pip));
ok('reset on dblclick', !pip?.['9:16']);
// 5) 다른 비율은 따로
await page.click('text=16:9'); await page.waitForTimeout(300);
pip = await P(); ok('16:9 untouched', !pip?.['16:9']);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
