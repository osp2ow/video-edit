// 코드표 직접 만들기: 새 코드표 → 이름 → 지판 점 찍기·X/O → 시작 프렛 → 내 코드표 저장 → 다시 넣기 → 미리보기 끌기·모서리 크기
import { chromium } from 'playwright-core';
const [V, DIR] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', V); await page.waitForFunction(() => /분석 완료|자동 감지/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const chords = async () => (await P()).captions?.filter(c => c.chord).sort((a, b) => a.start - b.start) || [];
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(300); };
await page.click('.chord-tab');
ok('no preset chord list', await page.locator('#chord-panel .chord-roots').count() === 0);
await seek(2);
await page.click('#chord-panel >> text=+ 새 코드표'); await page.waitForTimeout(200);
let ch = await chords();
ok('blank chord inserted', ch.length === 1 && ch[0].chord.frets.every(f => f === -2));
await page.fill('#chord-name', 'Am7'); await page.waitForTimeout(100);
// 지판 칸 위치 찾기: 흰 가로선(줄 6개) · 세로선(프렛)
const ed = await page.locator('.chord-editor').boundingBox();
const grid = await page.evaluate(() => {
  const c = document.querySelector('.chord-editor'), ctx = c.getContext('2d'), w = c.width, h = c.height, d = ctx.getImageData(0, 0, w, h).data;
  const wh = (x, y) => d[(y * w + x) * 4 + 3] > 200 && d[(y * w + x) * 4] > 200;
  const rows = [], cols = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (wh(x, y)) n++; if (n > w * 0.45) rows.push(y); }
  const ys = rows.filter((y, i) => i === 0 || y - rows[i - 1] > 2);
  const y0 = ys[0], y1 = ys[ys.length - 1];
  for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (wh(x, y)) n++; if (n > (y1 - y0) * 0.9) cols.push(x); }
  const xs = cols.filter((x, i) => i === 0 || x - cols[i - 1] > 2);
  return { ys, xs, scale: c.getBoundingClientRect().width / w };
});
console.log('grid', JSON.stringify(grid));
const s = grid.scale, rowY = k => ed.y + grid.ys[k] * s + 1;   // k: 0 = 맨 위 = 1번줄
const cellX = n => ed.x + ((grid.xs[n - 1] + grid.xs[n]) / 2) * s; // n번째 칸
const xoX = ed.x + (grid.xs[0] - 10) * s;
const tap = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(60); };
// Am7 = x02010 (6번줄 X, 5번줄 O, 4번줄 2프렛, 3번줄 O, 2번줄 1프렛, 1번줄 O)
await tap(xoX, rowY(5)); await tap(xoX, rowY(5));   // 6번줄: O → X
await tap(xoX, rowY(4));                             // 5번줄 O
await tap(cellX(2), rowY(3));                        // 4번줄 2프렛
await tap(xoX, rowY(2));                             // 3번줄 O
await tap(cellX(1), rowY(1));                        // 2번줄 1프렛
await tap(xoX, rowY(0));                             // 1번줄 O
await page.waitForTimeout(150);
ch = await chords();
console.log('frets', JSON.stringify(ch[0].chord.frets), ch[0].chord.name, ch[0].text);
ok('dots placed = x02010', JSON.stringify(ch[0].chord.frets) === '[-1,0,2,0,1,0]' && ch[0].chord.name === 'Am7' && ch[0].text === 'Am7');
await tap(cellX(1), rowY(1)); ch = await chords(); ok('tap again removes dot', ch[0].chord.frets[4] === -2);
await tap(cellX(1), rowY(1)); ch = await chords();
// 시작 프렛 올리기
await page.click('button[aria-label="시작 프렛 올리기"]'); await page.waitForTimeout(100);
ch = await chords(); ok('base fret 2', ch[0].chord.base === 2);
await page.click('button[aria-label="시작 프렛 내리기"]');
if (DIR) await page.screenshot({ path: DIR + '/custom.png' });
// 내 코드표에 저장 → 다른 자리에 다시 넣기
await page.click('#chord-panel >> text=내 코드표에 저장'); await page.waitForTimeout(100);
ok('saved to my charts', await page.locator('.chord-lib-item').count() === 1);
await seek(ch[0].end + 1);
await page.click('.chord-lib-item .chord-btn'); await page.waitForTimeout(200);
ch = await chords();
ok('reused from my charts', ch.length === 2 && JSON.stringify(ch[1].chord.frets) === '[-1,0,2,0,1,0]' && ch[1].chord.name === 'Am7');
// 미리보기: 끌어 옮기기
const box = await page.locator('canvas.stage').boundingBox(), k = box.width / 1080;
let p = await P(); const cp0 = { x: 0.5, y: 0.36, ...(p.chordPos?.['9:16'] || {}) };
const sx = box.x + cp0.x * 1080 * k, sy = box.y + cp0.y * 1920 * k;
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - 40, sy + 100, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150);
p = await P(); ok('drag moves chord', p.chordPos?.['9:16']?.y > cp0.y + 0.03);
if (DIR) await page.screenshot({ path: DIR + '/custom2.png' });
console.log(logs.join('\n') || 'no page errors');
await browser.close();
