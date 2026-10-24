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
await page.setInputFiles('#f-angle', 'test/angle2.webm');
await page.setInputFiles('#f-angle', 'test/angle2.webm');
await page.waitForFunction(() => document.querySelectorAll('.angle .chip').length > 0, null, { timeout: 60000 });
// 2번 앵글 구간 넣기: 8s~14s
await page.evaluate(() => { document.querySelector('video').currentTime = 8; }); await page.waitForTimeout(200);
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('2'); await page.waitForTimeout(200);
await page.evaluate(() => { document.querySelector('video').currentTime = 14; }); await page.waitForTimeout(200);
await page.keyboard.press('1'); await page.waitForTimeout(300);
const cuts0 = (await page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test.webm')))).cuts;
console.log('cuts', JSON.stringify(cuts0));
const tl = await page.locator('.tl-canvas canvas').boundingBox(); console.log('tl', JSON.stringify(tl));
const progY = tl.y + 28 + 6 + 12;
// 구간 가운데 x 계산: 화면에서 찾기 어려우니 시간→x
const x11 = await page.evaluate(([w]) => null, [tl.width]);
// fit view: start=-d*0.01, pps=(w-2)/(d*1.02)
const d = await page.evaluate(() => document.querySelector('video').duration);
const X = t => tl.x + (t + d * 0.01) * (tl.width - 2) / (d * 1.02);
await page.mouse.click(X(11), progY); await page.waitForTimeout(300);
console.log('menu visible', await page.locator('.seg-menu').isVisible());
await page.click('.seg-menu .sm-row:nth-of-type(2) button:has-text("디졸브")');
await page.click('.seg-menu .sm-row:nth-of-type(3) button:has-text("검정")').catch(e => console.log('no out row', e.message.slice(0,80)));
await page.waitForTimeout(300);
console.log('tl2', JSON.stringify(await page.locator('.tl-canvas canvas').boundingBox()), JSON.stringify(await page.locator('.seg-menu').boundingBox()), await page.evaluate(()=>scrollY+' '+innerHeight)); await page.screenshot({ path: 'test/seg.png' });
console.log('after tr', JSON.stringify((await page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test.webm')))).cuts));
await page.click('.seg-menu >> text=구간 넣기 삭제'); await page.waitForTimeout(1500);
console.log('after delete', JSON.stringify((await page.evaluate(() => JSON.parse(localStorage.getItem('pve.proj:test.webm')))).cuts), 'menu', await page.locator('.seg-menu').count());
console.log(logs.join('\n')); await browser.close();
