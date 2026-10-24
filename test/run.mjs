import { chromium } from 'playwright-core';
import fs from 'fs';
const NM = '/home/claude/pve/node_modules';
const map = {
  'react.production.min.js': NM + '/react/umd/react.production.min.js',
  'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js',
  'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js',
  'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js',
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => {
  const u = r.request().url();
  const f = Object.keys(map).find(k => u.endsWith('/' + k));
  if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' });
  if (u.includes('fonts.g')) return r.abort();
  return r.continue();
});
await page.goto('file:///home/claude/pve/dist/index.html');
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/s0_empty.png' });
const t0 = Date.now();
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지') || document.querySelector('.status')?.textContent?.includes('쉼표'), null, { timeout: 60000 }).catch(async e => { console.log('TIMEOUT status:', await page.evaluate(() => document.querySelector('.status')?.textContent)); console.log(logs.join('\n')); await page.screenshot({ path: 'test/err.png' }); process.exit(1); });
await page.waitForTimeout(1500);
console.log('analysis ms', Date.now() - t0);
const info = await page.evaluate(() => ({
  status: document.querySelector('.status')?.textContent,
  bpm: (document.querySelector('#bpm'))?.value,
  sync: document.querySelector('output.big')?.textContent,
  anchor: document.querySelector('.anchor-now > span')?.textContent,
  sheet: document.querySelector('.sheet-list .note')?.textContent,
  caps: [...document.querySelectorAll('.sys figcaption')].map(e => e.textContent),
  span: [...document.querySelectorAll('.panel.left .note')].map(e => e.textContent).join(' | '),
}));
console.log(JSON.stringify(info, null, 1));
// 20초로 이동 후 화면
await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 20; });
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/s1_20s.png' });
// 카드 드래그: 캔버스 좌표 계산
const box = await page.locator('canvas.stage').boundingBox();
const sx = box.width / 1080, sy = box.height / 1920;
const cardX = box.x + 540 * sx, cardY = box.y + (0.12 * 1920 + 60) * sy;
await page.mouse.move(cardX, cardY);
await page.mouse.down();
await page.mouse.move(cardX + 5, cardY + 300 * sy, { steps: 5 });
await page.mouse.move(cardX + 3, box.y + (0.80 * 1920 - 150) * sy, { steps: 10 });
await page.screenshot({ path: 'test/s2_drag.png' });
await page.mouse.up();
const lay = await page.evaluate(() => localStorage.getItem('pve.layouts'));
console.log('layouts', lay);
// 재생 1.5초
await page.click('.btn.play');
await page.waitForTimeout(1500);
const t = await page.evaluate(() => document.querySelector('video').currentTime);
console.log('played to', t);
await page.click('.btn.play');
// 16:9
await page.click('.seg button:nth-child(2)');
await page.waitForTimeout(500);
await page.screenshot({ path: 'test/s3_169.png' });
console.log(logs.filter(l => !l.includes('fonts')).slice(0, 20).join('\n'));
await browser.close();
