import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.evaluate(() => { document.querySelector('video').currentTime = 10; }); await page.waitForTimeout(500);
// 타임라인: 왼쪽으로 이동해서 음수 마디 확인
const tl = await page.locator('.tl-canvas canvas').boundingBox();
await page.mouse.move(tl.x + 500, tl.y + 100);
await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control');
await page.keyboard.down('Shift'); for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -600); await page.keyboard.up('Shift');
await page.waitForTimeout(200);
await page.screenshot({ path: 'test/n_tl.png', clip: { x: 0, y: tl.y, width: 1920, height: 40 } });
// 미리보기: 카드 밖(영상)을 아래로 끌기
const st = await page.locator('canvas.stage').boundingBox();
const sx = st.x + st.width * 0.5, sy = st.y + st.height * 0.6;
await page.mouse.move(sx, sy); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(sx, sy + i * 25);
await page.mouse.up(); await page.waitForTimeout(300);
const xfs = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('pve.proj:test.webm')).frames));
console.log('after drag:', await xfs());
await page.screenshot({ path: 'test/n_drag.png', clip: { x: st.x, y: st.y, width: st.width, height: st.height } });
// 크기 슬라이더 80%
await page.fill('#vscale', '0.8').catch(async () => { await page.evaluate(() => { const el = document.querySelector('#vscale'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '0.8'); el.dispatchEvent(new Event('input', { bubbles: true })); }); });
await page.waitForTimeout(300);
// 자르기: 왼쪽 변을 오른쪽으로
await page.click('text=자르기'); await page.waitForTimeout(300);
await page.screenshot({ path: 'test/n_crop1.png', clip: { x: st.x, y: st.y, width: st.width, height: st.height } });
const info = await page.evaluate(() => ({ f: JSON.parse(localStorage.getItem('pve.proj:test.webm')).frames['9:16'].main }));
console.log('xf before crop', JSON.stringify(info.f));
// 왼쪽 변 위치 계산: scale .8 → video rect width = W*0.8 centered
const W = 1080, H = 1920, k = st.width / W;
const fullW = W * info.f.scale, fullX = (W - fullW) / 2 + info.f.x * W;
const fullH = H * info.f.scale, fullY = (H - fullH) / 2 + info.f.y * H;
const lx = st.x + fullX * k, ly = st.y + (fullY + fullH / 2) * k;
await page.mouse.move(lx, ly); await page.mouse.down(); await page.mouse.move(lx + fullW * 0.2 * k, ly, { steps: 6 }); await page.mouse.up();
const ty = st.y + fullY * k, tx = st.x + (fullX + fullW / 2) * k;
await page.mouse.move(tx, ty); await page.mouse.down(); await page.mouse.move(tx, ty + fullH * 0.15 * k, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(300);
console.log('after crop:', await xfs());
await page.screenshot({ path: 'test/n_crop2.png', clip: { x: st.x, y: st.y, width: st.width, height: st.height } });
await page.click('text=자르기 완료'); await page.waitForTimeout(300);
await page.screenshot({ path: 'test/n_crop3.png', clip: { x: st.x, y: st.y, width: st.width, height: st.height } });
await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
console.log('after undo:', await xfs());
console.log(logs.join('\n'));
await browser.close();
