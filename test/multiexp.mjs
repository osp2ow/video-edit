import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const page = await ctx.newPage();
let dlP = new Promise(r => page.on('download', d => r(d)));
const logs = []; page.on('console', m => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-sheet', '/home/claude/poc/in/sheet.pdf');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('자동 감지'), null, { timeout: 60000 });
await page.setInputFiles('#f-source', 'test/angle2.webm');
await page.waitForFunction(() => /이어 붙였|맞춰 놓았/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { delete window.showSaveFilePicker; });
await page.click('.export-btn');
await page.click('text=720p');
await page.click('text=영상 전체');

console.log('range:', await page.evaluate(() => [...document.querySelectorAll('.modal .note')].map(e => e.textContent).join(' | ')));
const t0 = Date.now();
await page.click('text=추출 시작');
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(10000);
  const tx = await page.evaluate(() => document.querySelector('.modal-body')?.textContent || '');
  console.log(i, tx.slice(0, 80));
  if (/MP4 저장|실패|못했/.test(tx)) break;
  if (i == 3) console.log(logs.slice(-15).join('\n'));
}
console.log('export took', (Date.now() - t0) / 1000, 's');
console.log('result:', await page.evaluate(() => document.querySelector('.modal-body').textContent.slice(0, 200)));
const dl = await dlP;
await dl.saveAs('test/multi_out.mp4');
console.log(logs.filter(l => !l.includes('fonts') && !l.includes('ERR_FAILED') && !l.includes('fake worker')).join('\n'));
await browser.close();
