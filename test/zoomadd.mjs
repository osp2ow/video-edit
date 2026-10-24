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
await page.setInputFiles('#f-rec2', '/tmp/claude-0/rec2.mp3');   // 녹음본을 뒤에 이어 붙여 타임라인이 영상보다 길게
await page.waitForFunction(() => /rec2.mp3: /.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.click('text=효과');
const P = () => page.evaluate(() => window.__pveTransport.getProject());
const p0 = await P(); console.log('recClips', JSON.stringify(p0.recClips), 'end', await page.evaluate(() => window.__pveTransport.end()));
for (const T of [10, 50, 1e9]) {
  await page.evaluate(T => { const tr = window.__pveTransport; tr.seek(Math.min(T, tr.end())); }, T);
  await page.waitForTimeout(200);
  await page.click('text=확대 구간 추가'); await page.waitForTimeout(300);
  const z = (await P()).fx.zooms.slice(-1)[0];
  console.log('at', T, 'zoom', z.start.toFixed(2), '→', z.end.toFixed(2));
}
await page.click('text=전체 보기'); await page.waitForTimeout(300);
await page.screenshot({ path: 'test/zoomadd.png', clip: { x: 0, y: 700, width: 1920, height: 380 } });
console.log(logs.join('\n')); await browser.close();
