// PIP 영상 줄: 추가 영상을 'PIP로' → 기준 영상 위에 작게 같이 재생 · 타임라인 PIP 줄 · 미리보기에서 옮기기 · 지우기
// 사용법: node test/overlay.mjs 영상1 영상2 [스크린샷 폴더]
import { chromium } from 'playwright-core';
const [V1, V2, SHOTS] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map0 = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const map = { ...map0, ...(process.env.MP4BOX ? { 'mp4box.all.min.js': process.env.MP4BOX } : {}) };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 90000 });
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요/); await page.waitForTimeout(1200);
let p = await P(); console.log('clips', JSON.stringify(p.clips.map(c => [c.src || 'main', c.start, c.srcOut - c.srcIn])));
await page.click('.src-item >> text=PIP로'); await page.waitForTimeout(800);
p = await P(); console.log('after PIP', JSON.stringify(p.clips.map(c => [c.src || 'main', c.start])), JSON.stringify(p.overlays));
ok('video moved to PIP row', p.overlays?.length === 1 && !p.clips.some(c => c.src));
const o = p.overlays[0], main = p.clips[0];
ok('PIP placed over the main video', o.start >= main.start - 0.01 && o.start < main.start + (main.srcOut - main.srcIn));
// 미리보기: PIP 안쪽 시각과 바깥 시각의 오른쪽 위 구석이 다름 (작은 화면이 보임)
const stage = async () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); return { w: c.width, h: c.height }; });
const px = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
await page.evaluate(t => window.__pveTransport.seek(t), o.start + 2); await page.waitForTimeout(1200);
if (SHOTS) await page.screenshot({ path: SHOTS + '/ov1.png' });
const tl = await page.locator('.tl-canvas canvas').boundingBox();
if (SHOTS) await page.screenshot({ path: SHOTS + '/ov_tl.png', clip: { x: tl.x, y: tl.y - 34, width: tl.width, height: 340 } });
// PIP 오른쪽 테두리(x = 0.96W 근처) 세로줄에서 흰 픽셀 범위 → 상자 위치
const col = await page.evaluate(() => { const c = document.querySelector('canvas.stage'), ctx = c.getContext('2d'); let best = null;
  for (let x = Math.round(c.width * 0.955); x <= Math.round(c.width * 0.965); x++) { const d = ctx.getImageData(x, 0, 1, c.height).data; const ys = []; for (let y = Math.round(c.height * 0.45); y < c.height; y++) { const i = y * 4; if (d[i] > 220 && d[i + 1] > 185 && d[i + 2] > 185) ys.push(y); } if (!best || ys.length > best.n) best = { n: ys.length, y0: ys[0] / c.height, y1: ys[ys.length - 1] / c.height }; }
  return best; });
console.log('PIP right border', JSON.stringify(col), JSON.stringify(await page.evaluate(() => { const c = document.querySelector('canvas.stage'); const x = Math.round(c.width * 0.96), y = Math.round(c.height * 0.68); return [c.width, c.height, Array.from(c.getContext('2d').getImageData(x - 3, y, 7, 1).data)]; })));
ok('PIP box drawn in preview', col && col.n > 20);
// 재생: PIP 전용 영상이 시계를 따라 재생되는지
await page.evaluate(t => window.__pveTransport.play(t), o.start + 1);
await page.waitForTimeout(2500);
const st = await page.evaluate(() => { const tr = window.__pveTransport, T = tr.time(); const els = [...tr.ovEls().values()]; return { T, ov: els.map(v => ({ t: v.currentTime, paused: v.paused, w: v.videoWidth })) }; });
await page.evaluate(() => window.__pveTransport.pause());
console.log('play', JSON.stringify(st));
const exp = o.srcIn + (st.T - o.start);
ok('PIP video plays in sync with the main clock', st.ov.length === 1 && !st.ov[0].paused && Math.abs(st.ov[0].t - exp) < 0.35);
// 미리보기에서 끌어서 옮기기
await page.evaluate(t => window.__pveTransport.seek(t), o.start + 2); await page.waitForTimeout(600);
const cv = await page.locator('canvas.stage').boundingBox(), S = await stage();
const bx = cv.x + cv.width * 0.8, by = cv.y + cv.height * (col.y0 + col.y1) / 2;
await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move(bx - cv.width * 0.4, by - cv.height * 0.3, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
p = await P(); const box = Object.values(p.overlays[0].box || {})[0];
console.log('box', JSON.stringify(p.overlays[0].box));
ok('drag PIP in preview moves it', box && box.x < 0.5 && box.y < col.y0 - 0.1);
// 타임라인: PIP 줄 (영상 줄 아래) 조각을 끌어서 옮기기
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(300);
const tl2 = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl2.x + (t + end * 0.01) * ((tl2.width - 2) / (end * 1.02));
const PIP_Y = tl2.y + 30 + 132 + 56 + 25;
const s0 = p.overlays[0].start;
await page.mouse.move(X(s0 + 2), PIP_Y); await page.mouse.down(); await page.mouse.move(X(s0 + 2) + 60, PIP_Y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
p = await P(); console.log('timeline move', s0, '→', p.overlays[0].start);
ok('drag on PIP row moves the PIP clip', Math.abs(p.overlays[0].start - s0) > 0.3);
// 추출 (OUT를 주면): PIP가 들어간 MP4
if (process.env.OUT) {
  await page.click('.export-btn');
  await page.click('text=720p');
  const dlP = page.waitForEvent('download', { timeout: 300000 });
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  await page.click('text=추출 시작');
  await page.waitForFunction(() => document.querySelector('.ok-text') || /실패|못 했|오류/.test(document.querySelector('.modal-body')?.textContent || ''), null, { timeout: 300000 });
  console.log('export result:', (await page.textContent('.modal-body')).slice(0, 80));
  await (await dlP).saveAs(process.env.OUT);
  p = await P(); console.log('EXPORTED overlay', JSON.stringify(p.overlays[0]));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
}
// 페이드 칸 + 지우기 (Delete)
ok('fade box shows for selected PIP clip', !!(await page.$('#rec-fade-in')));
await page.keyboard.press('Delete'); await page.waitForTimeout(400);
p = await P(); ok('Delete removes the PIP clip', !(p.overlays || []).length);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
