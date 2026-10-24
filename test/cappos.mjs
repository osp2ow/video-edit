import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.waitForTimeout(4000);
const P = () => page.evaluate(() => window.__pveTransport.getProject());
for (const [t, txt] of [[3, 'A'], [8, 'B']]) {
  await page.evaluate(t => window.__pveTransport.seek(t), t); await page.waitForTimeout(100);
  await page.keyboard.press('Shift+KeyC'); await page.waitForTimeout(200); await page.keyboard.type(txt); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}
await page.evaluate(() => window.__pveTransport.seek(9)); await page.waitForTimeout(300);
// 미리보기에서 B 자막을 끌기
const cv = await page.locator('.preview canvas, canvas').first().boundingBox();
const p0 = await P(); const st = p0.captionStyles?.['9:16'];
const cvb = await page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find(c => c.width === 1080); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const y0 = (st?.y ?? 0.75), cx = cvb.x + cvb.w * 0.5, cy = cvb.y + cvb.h * y0;
console.log('common y', y0);
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - 150, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
let p = await P();
console.log('captions', JSON.stringify(p.captions.map(c => [c.text, c.pos || null])), 'common y', p.captionStyles?.['9:16']?.y);
console.log(logs.join('\n')); await browser.close();
