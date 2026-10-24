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
const open = await page.locator('.cap-studio').count(); if (!open) { await page.keyboard.press('c'); await page.waitForTimeout(300); }
const seekT = async t => { await page.evaluate(t => document.querySelector('video').currentTime = t, t); await page.waitForTimeout(300); };
if (!(await page.locator('.cap-list li').count())) { await page.click('.cs-head >> text=+ 추가'); }
await page.fill('#cap-text', '첫 자막'); await page.evaluate(() => document.activeElement.blur());
await page.mouse.click(X(25), tl.y + 21); await page.waitForTimeout(300);
await page.click('.cs-head >> text=+ 추가'); await page.fill('#cap-text', '둘째 자막'); await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(300);
// 둘째 자막 선택된 상태: 글자색 바꾸기 → 이 자막만
await page.locator('.cs-group .swatch').nth(2).click();
// 크기 바꾸기 → 공통
await page.locator('#cs-size').fill('0.09');
await page.locator('#cs-y').fill('0.3');
await page.waitForTimeout(1500);
const p = await P(); console.log(JSON.stringify(p.captions.map(c => ({ t: c.text, style: c.style }))), 'common size', p.captionStyles['9:16'].size, 'y', p.captionStyles['9:16'].y, 'color', p.captionStyles['9:16'].color);
await page.click('text=모든 자막에'); await page.locator('.cs-group .swatch').nth(3).click(); await page.waitForTimeout(1500);
const q = await P(); console.log('all:', JSON.stringify(q.captions.map(c => c.style || null)), 'common color', q.captionStyles['9:16'].color);
await page.screenshot({ path: 'test/capscope.png', clip: { x: 0, y: 60, width: 700, height: 1000 } });
console.log(logs.join('\n')); await browser.close();
