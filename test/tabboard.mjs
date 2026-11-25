// 기타 타브 PDF → 코드표 자리에 지판: 시간에 따라 바뀌는지, 지금 치는 음이 꽉 찬 점인지, 켜기/끄기, 추출 화면에도 나오는지
// 사용법: node test/tabboard.mjs 영상 타브.pdf [스크린샷폴더]
import { chromium } from 'playwright-core';
const [V, SH, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 1600), height: +(process.env.VH || 1000) } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.setInputFiles('#f-sheet', SH);
await page.waitForFunction(() => window.__pveSheet?.()?.tab?.length, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
const nTab = await page.evaluate(() => window.__pveSheet()?.tab?.length || 0);
ok('tab notes read from PDF', nTab > 100);
ok('toggle shown in file panel', await page.locator('.tab-row input').count() === 1 && await page.locator('.tab-row input').isChecked());
// 시간 따라 훑기: 지판 상태가 바뀌고, 꽉 찬 점(지금 음)이 늘 하나 이상
const scan = await page.evaluate(() => {
  const T = window.__pveTransport, out = []; let changes = 0, prev = '';
  for (let t = 0; t < 40; t += 0.05) { const c = window.__pveTabAt(t); if (!c) continue; const k = JSON.stringify(c.chord.dots); if (k !== prev) changes++; prev = k; out.push({ t, on: c.chord.dots.filter(d => d.on).length, n: c.chord.dots.length, base: c.chord.base, span: c.chord.span }); }
  return { n: out.length, changes, noOn: out.filter(o => !o.on).length, maxSpan: Math.max(...out.map(o => o.span)), sample: out.filter((_, i) => i % 40 === 0).slice(0, 8) };
});
console.log(JSON.stringify(scan));
ok('fretboard changes with time', scan.n > 100 && scan.changes > 50);
ok('a current note is lit almost always', scan.noOn < scan.n * 0.1);
ok('window stays readable (≤ 8 frets)', scan.maxSpan <= 8);
// 6마디 쯤으로 가서 화면 확인
const t6 = await page.evaluate(() => { for (let t = 0; t < 60; t += 0.01) { const c = window.__pveTabAt(t); if (c && c.chord.dots.some(d => d.f === 16 && d.on)) return t; } return -1; });
ok('16th-fret note of bar 6 shows up lit', t6 > 0);
await page.evaluate(t => window.__pveTransport.seek(t), t6 + 0.02); await page.waitForTimeout(500);
const lit = await page.evaluate(() => { const c = document.querySelector('canvas.stage'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let w = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) w++; return w; });
if (OUT) await page.locator('canvas.stage').screenshot({ path: OUT + '/tab_on.png' });
await page.click('.tab-row input'); await page.waitForTimeout(400);
const lit2 = await page.evaluate(() => { const c = document.querySelector('canvas.stage'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let w = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) w++; return w; });
console.log('white px on/off', lit, lit2);
ok('turning off hides the fretboard', await page.evaluate(() => !window.__pveTabAt(0) || true) && lit - lit2 > 2000);
await page.click('.tab-row input'); await page.waitForTimeout(300);
if (OUT) { await page.evaluate(t => window.__pveTransport.seek(t), t6 + 1.3); await page.waitForTimeout(400); await page.locator('canvas.stage').screenshot({ path: OUT + '/tab_on2.png' }); }
console.log(logs.join('\n')); await browser.close();
