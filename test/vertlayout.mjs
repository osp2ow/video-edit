// 세로 영상(9:16·4:5)은 미리보기를 왼쪽 끝에 크게, 가로(16:9)는 예전 배치 그대로
import { chromium } from 'playwright-core';
const [V, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const W = +(process.env.VW || 1600), H = +(process.env.VH || 1000);
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
const box = s => page.locator(s).first().boundingBox();
const meas = async () => ({ stage: await box('canvas.stage'), center: await box('main.center'), left: await box('.panel.left'), right: await box('.panel.right'), bottom: await box('footer.bottom'), tl: await page.evaluate(() => document.querySelector('.tl-canvas canvas')?.getBoundingClientRect().width) });
const shot = async n => OUT && page.screenshot({ path: `${OUT}/${n}.png` });
await page.click('.seg >> text=9:16'); await page.waitForTimeout(600);
let m = await meas(); console.log('9:16', JSON.stringify(m)); await shot('v916');
ok('9:16: preview column is far left', m.center.x < 2 && m.left.x >= m.center.x + m.center.width - 2);
ok('9:16: preview spans down to the bottom (beside timeline)', m.center.y + m.center.height >= H - 2 && m.bottom.x >= m.center.x + m.center.width - 2);
ok('9:16: preview is tall', m.stage.height > H * 0.72);
ok('9:16: timeline fills its width', Math.abs(m.tl - (m.bottom.width - 32)) < 40);
await page.click('.seg >> text=4:5'); await page.waitForTimeout(600);
m = await meas(); console.log('4:5', JSON.stringify(m)); await shot('v45');
ok('4:5: preview column is far left', m.center.x < 2 && m.stage.height > H * 0.6);
// 넓은 화면: 파일 · 자막 · 코드표가 나란히 칸으로 (접는 탭 없음)
if (W >= 1560) {
  await page.click('.seg >> text=9:16'); await page.waitForTimeout(400);
  const cap = await box('.cap-col'), ch = await box('.chord-col'); m = await meas();
  console.log('split', JSON.stringify({ cap, ch }));
  ok('wide: files | captions | chords side by side', cap && ch && Math.abs(cap.x - (m.left.x + m.left.width)) < 3 && Math.abs(ch.x - (cap.x + cap.width)) < 3 && ch.x + ch.width <= m.right.x + 2);
  ok('wide: caption & chord panels are open (no fold tabs)', await page.locator('.studio-tab').count() === 0 && await page.locator('.cap-col #cap-text').count() === 1 && await page.locator('.chord-col #chord-panel').count() === 1);
  ok('wide: caption panel scrolls inside its column', await page.evaluate(() => { const e = document.querySelector('.cap-col .cap-studio'); return e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY === 'auto'; }));
  const nCap = () => page.evaluate(() => (window.__pveTransport.getProject().captions || []).length);
  const c0 = await nCap();
  await page.click('.cap-col >> text=+ 추가'); await page.waitForTimeout(300);
  await page.fill('.cap-col #cap-text', '테스트 자막'); await page.waitForTimeout(300);
  await page.click('.chord-col >> text=+ 새 코드표'); await page.waitForTimeout(400);
  const caps = await page.evaluate(() => window.__pveTransport.getProject().captions || []);
  ok('wide: caption & chord added from the side columns', caps.length === c0 + 2 && caps.some(c => c.text === '테스트 자막') && caps.some(c => c.chord));
  await shot('v916split');
  await page.click('.seg >> text=16:9'); await page.waitForTimeout(600);
  m = await meas(); console.log('16:9 wide', JSON.stringify(m)); await shot('h169w');
  ok('16:9 wide: original layout, panels folded', m.left.x < 2 && m.bottom.width > W - 4 && await page.locator('.cap-col').count() === 0 && await page.locator('.studio-tab').count() >= 1);
  console.log(logs.join('\n')); await browser.close(); process.exit(0);
}
// 자막 패널 열면 미리보기 크기 유지
await page.click('.seg >> text=9:16'); await page.waitForTimeout(400);
const st0 = (await meas()).stage;
await page.click('.studio-tab >> nth=0'); await page.waitForTimeout(600);
m = await meas(); console.log('9:16+cap', JSON.stringify(m)); await shot('v916cap');
ok('caption panel open keeps preview size', Math.abs(m.stage.height - st0.height) < 20);
await page.click('.seg >> text=16:9'); await page.waitForTimeout(600);
m = await meas(); console.log('16:9', JSON.stringify(m)); await shot('h169');
ok('16:9: original layout (files left, timeline full width)', m.left.x < 2 && m.center.x >= 299 && m.bottom.x < 2 && m.bottom.width > W - 4);
console.log(logs.join('\n')); await browser.close();
