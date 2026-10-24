import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => /싱크|자동 감지|분석 완료/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1500);
const P = () => page.evaluate(() => window.__pveTransport.getProject());
await page.click('text=전체 보기'); await page.waitForTimeout(300);
const box = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => window.__pveTransport.end());
const pps = (box.width - 2) / (end * 1.02), X = t => box.x + (t + end * 0.01) * pps;
const y = box.y + box.height - 30;
await page.mouse.click(X(10), y); await page.waitForTimeout(200);   // 녹음본 줄 고르기
await page.evaluate(() => window.__pveTransport.seek(20)); await page.waitForTimeout(200);
await page.keyboard.press('KeyI'); await page.waitForTimeout(400);
let p = await P();
console.log('after I: recClips', JSON.stringify(p.recClips), 'trims', JSON.stringify(p.trims), 'clips', JSON.stringify(p.clips || null));
// drag the second piece +80px
await page.mouse.move(X(30), y); await page.mouse.down(); await page.mouse.move(X(30) + 80, y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
p = await P(); console.log('after drag piece2 at', p.recClips[0].at.toFixed(3), 'recAt', p.recAt.toFixed(3));
// select first piece and delete it
await page.mouse.click(X(8), y); await page.waitForTimeout(200);
await page.keyboard.press('Delete'); await page.waitForTimeout(300);
p = await P(); console.log('after delete first: trims.rec', JSON.stringify(p.trims.rec));
await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(300);
p = await P(); console.log('undo: trims.rec', JSON.stringify(p.trims.rec));
const n = await page.evaluate(async () => { const tr = window.__pveTransport; await tr.play(25); await new Promise(r => setTimeout(r, 500)); const k = tr.player.srcs.length; tr.pause(); return k; });
console.log('sources scheduled at 25:', n);
await page.screenshot({ path: 'test/recsplit.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
console.log(logs.join('\n')); await browser.close();
