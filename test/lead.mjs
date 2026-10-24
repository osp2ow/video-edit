import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
// 예전에 전체가 147초 뒤로 밀려 저장된 프로젝트
await page.evaluate(() => { localStorage.setItem('pve.proj:test.webm', JSON.stringify({ bpm: 91, beatsPerBar: 4, anchorTime: 150, anchorBar: 1, recOffset: 0, recAt: 145.5, clips: [{ id: 'v0', start: 147, srcIn: 0, srcOut: 46.7 }], cuts: [], angleOffsets: {}, captions: [{ id: 'c1', start: 152, end: 154, text: 'X' }], fx: { zooms: [{ id: 'z', start: 147.2, end: 150, from: 1, to: 1.1 }], punches: [] } })); });
await page.reload();
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForTimeout(9000);
const p = await page.evaluate(() => window.__pveTransport.getProject());
console.log('clips', JSON.stringify(p.clips), 'recAt', p.recAt, 'anchor', p.anchorTime, 'cap', p.captions[0].start, 'zoom', p.fx.zooms[0].start);
console.log('end', await page.evaluate(() => window.__pveTransport.end()), 'time label', await page.evaluate(() => document.querySelector('.mono')?.textContent));
await page.screenshot({ path: 'test/lead.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
// Cmd+A 전체를 오른쪽으로 크게 끌기 → 놓으면 다시 0초부터
await page.click('text=전체 보기'); await page.waitForTimeout(300);
const box = await page.locator('.tl-canvas canvas').boundingBox();
await page.mouse.click(box.x + 600, box.y + 80);
await page.keyboard.press('Control+KeyA');
await page.mouse.move(box.x + 700, box.y + 187); await page.mouse.down(); await page.mouse.move(box.x + 1100, box.y + 187, { steps: 8 });
const mid = await page.evaluate(() => window.__pveTransport.getProject().clips[0].start);
await page.mouse.up(); await page.waitForTimeout(800);
const p2 = await page.evaluate(() => window.__pveTransport.getProject());
console.log('during drag clip start', mid.toFixed(2), '→ after release', p2.clips[0].start, 'recAt', p2.recAt.toFixed(3));
console.log(logs.join('\n')); await browser.close();
