// 영상 조각 페이드 아웃: 미리보기 재생 중 그 영상 소리 크기가 줄어드는지 (영상 2개 이어 붙임)
import { chromium } from 'playwright-core';
const [V1, V2] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 90000 });
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요/); await page.waitForTimeout(1500);
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
let p = await P();
const cs = p.clips.sort((a, b) => a.start - b.start);
for (const c of cs) {
  let tl = await page.locator('.tl-canvas canvas').boundingBox();
  const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
  const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
  await page.mouse.click(X(c.start + 1.3), tl.y + 30 + 132 + 25); await page.waitForTimeout(400);
  await page.fill('#rec-fade-out', '3'); await page.press('#rec-fade-out', 'Enter'); await page.waitForTimeout(300);
}
p = await P(); console.log('clip fades', JSON.stringify(p.clips.map(c => [c.src || 'main', c.fadeIn, c.fadeOut])));
for (const c0 of cs) {
  const c = p.clips.find(x => x.id === c0.id), e = c.start + (c.srcOut - c.srcIn);
  await page.evaluate(t => window.__pveTransport.play(t), e - 3.2);
  const vols = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(450); vols.push(await page.evaluate(() => { const t = window.__pveTransport.time(); const v = Array.from(document.querySelectorAll('video')).filter(v => v.src && !v.paused); return [+t.toFixed(2), ...v.map(x => +x.volume.toFixed(2))]; })); }
  await page.evaluate(() => window.__pveTransport.pause()); await page.waitForTimeout(300);
  console.log(c.src || 'main', 'end', e.toFixed(2), JSON.stringify(vols));
  const late = vols.filter(v => v[0] > e - 1.2 && v[0] < e - 0.1 && v.length > 1);
  ok('volume falls near end of ' + (c.src || 'main'), late.length > 0 && late.every(v => v[1] < 0.45));
}
console.log(logs.join('\n') || 'no page errors');
await browser.close();
