// 악보 카드 높이: 제목 글씨 때문에 커지지 않는지 + 위·아래 가장자리 끌어서 여백 자르기
// 사용법: node test/sheetcrop3.mjs index.html 영상 악보 스크린샷접두어 [drag]
import { chromium } from 'playwright-core';
const [HTML, V, S, OUT, DRAG] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + HTML);
await page.setInputFiles('#f-sheet', S); await page.waitForTimeout(1500);
await page.setInputFiles('#f-video', V); await page.waitForFunction(() => /분석 완료|자동 감지|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1500);
// 악보 1마디가 보이는 곳으로 (첫 마디 1박)
{
  const pj = await page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
  await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
  const tl = await page.locator('.tl-canvas canvas').boundingBox();
  const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
  const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
  await page.mouse.click(X(pj.anchorTime + 0.4), tl.y + 21); await page.waitForTimeout(500);
  console.log('seek to', (pj.anchorTime + 0.4).toFixed(2), await page.textContent('.now-t'));
}
const box = await page.locator('canvas.stage').boundingBox();
// 카드의 흰 영역 높이 재기: 캔버스 가운데 세로줄에서 밝은(흰) 픽셀이 이어진 가장 긴 구간
const cardH = () => page.evaluate(() => {
  // 카드 좌우 안쪽 여백 세로줄 두 곳이 모두 흰 행 = 카드
  const c = document.querySelector('canvas.stage'), ctx = c.getContext('2d');
  const col = f => ctx.getImageData(Math.round(c.width * f), 0, 1, c.height).data;
  const a = col(0.033), b = col(0.967), wh = (d, y) => d[y * 4] > 215 && d[y * 4 + 1] > 215 && d[y * 4 + 2] > 215;
  let best = { h: 0, y: 0 }, run = 0, st = 0;
  for (let y = 0; y < c.height; y++) { if (wh(a, y) && wh(b, y)) { if (!run) st = y; run++; if (run > best.h) best = { h: run, y: st }; } else run = 0; }
  return best;
});
const h0 = await cardH();
console.log('card white height px (1920 tall canvas):', JSON.stringify(h0));
await page.screenshot({ path: OUT + '-a.png', clip: box });
if (DRAG) {
  // 카드 위쪽 가운데 막대를 아래로, 아래쪽 막대를 위로
  const k = box.width / 1080;
  const cx = box.x + box.width / 2;
  const topY = box.y + h0.y * k, botY = box.y + (h0.y + h0.h) * k;
  await page.mouse.move(cx, topY + 1); await page.mouse.down(); await page.mouse.move(cx, topY + 25, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const h1 = await cardH(); console.log('after top drag:', JSON.stringify(h1));
  console.log(h1.h < h0.h - 20 && Math.abs((h1.y + h1.h) - (h0.y + h0.h)) < 6 ? 'ok   top drag trims, bottom stays' : 'FAIL top drag');
  const botY2 = box.y + (h1.y + h1.h) * k;
  // 아래: 먼저 늘렸다가(더 보이게) 다시 줄이기
  await page.mouse.move(cx, botY2 - 1); await page.mouse.down(); await page.mouse.move(cx, botY2 + 20, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const h15 = await cardH(); console.log('after bottom drag down:', JSON.stringify(h15));
  console.log(h15.h > h1.h + 10 && Math.abs(h15.y - h1.y) < 6 ? 'ok   bottom drag extends' : 'FAIL bottom extend');
  const botY3 = box.y + (h15.y + h15.h) * k;
  await page.mouse.move(cx, botY3 - 1); await page.mouse.down(); await page.mouse.move(cx, botY3 - 12, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const h2 = await cardH(); console.log('after bottom drag up:', JSON.stringify(h2));
  console.log(h2.h < h15.h - 10 && Math.abs(h2.y - h1.y) < 6 ? 'ok   bottom drag trims, top stays' : 'FAIL bottom drag');
  await page.screenshot({ path: OUT + '-b.png', clip: box });
  // 더블클릭으로 위 여백 처음대로
  await page.mouse.dblclick(cx, box.y + h2.y * k + 1); await page.waitForTimeout(200);
  const h3 = await cardH(); console.log('after dblclick top:', JSON.stringify(h3));
  console.log(h3.h > h2.h + 15 ? 'ok   dblclick restores top' : 'FAIL dblclick');
}
console.log(logs.join('\n') || 'no page errors');
await browser.close();
