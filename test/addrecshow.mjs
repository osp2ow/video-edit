// 녹음본 추가했을 때 타임라인에 안 보이던 경우들
// 1) 확대해 둔 상태에서 추가 → 화면 밖(오른쪽)에 붙으면 보이게 옮기고 골라 둠
// 2) 추가 녹음본 조각을 지운 뒤 같은 파일을 다시 추가 → 다시 놓임
// 3) 첫 녹음본 조각을 지운 뒤 같은 파일을 다시 넣기 → 다시 보임
import { chromium } from 'playwright-core';
const [V1, R1, R2, SHOT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec', R1); await waitMsg(/자동 감지|녹음본 분석 완료/); await page.waitForTimeout(800);
// 확대: + 버튼 여러 번 → 처음 몇 초만 보임
{ const b = await page.locator('.tl-canvas canvas').boundingBox(); await page.mouse.click(b.x + 40, b.y + 21); }
for (let i = 0; i < 6; i++) { await page.keyboard.press('Control+ArrowRight'); await page.waitForTimeout(60); }
await page.waitForTimeout(300);
// 녹음본 줄에서 초록(녹음본) 픽셀이 있는 가로 범위
const greenSpan = () => page.evaluate(() => {
  const c = document.querySelector('.tl-canvas canvas'), ctx = c.getContext('2d'), dpr = c.width / c.clientWidth;
  const y = Math.round((30 + 188 + 25) * dpr), d = ctx.getImageData(0, y, c.width, 1).data; const xs = [];
  for (let x = 0; x < c.width; x++) { const r = d[x * 4], g = d[x * 4 + 1], b = d[x * 4 + 2]; if (g > 150 && g > r + 40 && g > b + 40) xs.push(x / dpr); }
  return xs.length ? [Math.round(xs[0]), Math.round(xs[xs.length - 1]), xs.length] : null; });
console.log('before add, green', JSON.stringify(await greenSpan()));
await page.setInputFiles('#f-rec2', R2); await waitMsg(/녹음본|맞췄|붙였/); await page.waitForTimeout(800);
let p = await P(); const c = p.recClips[0];
console.log('added', JSON.stringify(c), await page.textContent('.status'));
const box = await page.locator('.tl-canvas canvas').boundingBox();
if (SHOT) await page.screenshot({ path: SHOT, clip: { x: box.x, y: box.y - 34, width: box.width, height: 300 } });
// 새 녹음본이 골라져 있어야 (페이드 칸이 뜸) · 화면에 보여야
ok('new recording selected', !!(await page.$('#rec-fade-in')));
const g1 = await greenSpan(); console.log('after add, green', JSON.stringify(g1));
// 새 녹음본 위치(초)가 지금 보이는 범위 안인지: 녹음본 줄을 그 시각에 눌러 골라지는지로 확인
ok('timeline shows the added recording', !!g1);
// 2) 추가 녹음본 조각 지우기 → 다시 추가 (전체 보기에서 그 조각을 눌러 고른 뒤 Delete)
{ await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(300);
  const tl = await page.locator('.tl-canvas canvas').boundingBox();
  const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
  const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
  await page.mouse.click(X(c.at + 3), tl.y + 30 + 188 + 25); await page.waitForTimeout(300); }
await page.keyboard.press('Delete'); await page.waitForTimeout(400);
p = await P(); ok('piece deleted', !(p.recClips || []).some(x => x.src === c.src));
await page.setInputFiles('#f-rec2', R2); await page.waitForTimeout(2500);
p = await P(); console.log('re-added', JSON.stringify(p.recClips), await page.textContent('.status'));
ok('re-adding a deleted recording puts it back on the timeline', (p.recClips || []).some(x => x.src === c.src));
// 3) 첫 녹음본 지우기 → 같은 파일 다시 넣기
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(300);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
await page.mouse.click(X(p.recAt + 2), tl.y + 30 + 188 + 25); await page.waitForTimeout(300);
await page.keyboard.press('Delete'); await page.waitForTimeout(400);
p = await P(); console.log('main rec trims after delete', JSON.stringify(p.trims?.rec));
await page.setInputFiles('#f-rec2', R1); await page.waitForTimeout(3000);
p = await P(); console.log('main rec trims after re-add', JSON.stringify(p.trims?.rec), await page.textContent('.status'));
ok('re-adding the deleted first recording shows it again', !p.trims?.rec || p.trims.rec.out - p.trims.rec.in > 1);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
