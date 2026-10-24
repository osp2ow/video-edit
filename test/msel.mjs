import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.waitForTimeout(800);
const P = () => page.evaluate(() => window.__pveTransport.getProject());
for (const [t, txt] of [[8, 'A'], [16, 'B'], [30, 'C']]) {
  await page.evaluate(t => window.__pveTransport.seek(t), t); await page.waitForTimeout(100);
  await page.keyboard.press('Shift+KeyC'); await page.waitForTimeout(200); await page.keyboard.type(txt); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}
await page.click('text=전체 보기'); await page.waitForTimeout(300);
const box = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => window.__pveTransport.end());
const pps = (box.width - 2) / (end * 1.02), X = t => box.x + (t + end * 0.01) * pps;
const capY = box.y + 78, fxY = box.y + 142, recY = box.y + 244;
let p = await P(); console.log('caps', JSON.stringify(p.captions.map(c => [c.text, +c.start.toFixed(2)])));
// 1) 네모로 자막 A,B + 효과줄 + 녹음본 줄까지 끌어 고르기 (5~20초)
await page.mouse.move(X(5), capY - 8); await page.mouse.down(); await page.mouse.move(X(20), recY, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(200);
await page.screenshot({ path: 'test/msel1.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
// 2) Ctrl+클릭으로 C 더하기
await page.keyboard.down('Control'); await page.mouse.click(X(31), capY); await page.keyboard.up('Control'); await page.waitForTimeout(200);
// 3) 고른 것 중 B를 잡고 오른쪽으로 끌기
p = await P(); const s0 = p.captions.map(c => c.start), r0 = p.recAt, cl0 = JSON.stringify(p.clips || null);
await page.mouse.move(X(17), capY); await page.mouse.down(); await page.mouse.move(X(17) + 150, capY, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
p = await P(); console.log('after group drag: caps moved', p.captions.map((c, i) => +(c.start - s0[i]).toFixed(3)).join(','), '| recAt moved', +(p.recAt - r0).toFixed(3), '| sheetClips', JSON.stringify(p.sheetClips?.map(c => +c.start.toFixed(2))), '| clips same', JSON.stringify(p.clips || null) === cl0);
await page.screenshot({ path: 'test/msel2.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
// 4) Delete
await page.keyboard.press('Delete'); await page.waitForTimeout(300);
p = await P(); console.log('after delete caps', JSON.stringify(p.captions.map(c => c.text)), 'trims.rec', JSON.stringify(p.trims?.rec));
await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(300);
p = await P(); console.log('undo caps', JSON.stringify(p.captions.map(c => c.text)), 'trims.rec', JSON.stringify(p.trims?.rec));
console.log(logs.join('\n')); await browser.close();
