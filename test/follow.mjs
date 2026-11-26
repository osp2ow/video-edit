// 손 따라가기(자동 짐벌): 손이 화면 왼쪽(0.3)에 있다가 5초쯤 오른쪽(0.7)으로 옮겨가면 확대된 화면이 부드럽게 따라가는지
// 영상: 가로 위치가 빨강, 세로 위치가 초록인 그라데이션 → 미리보기 가운데 색으로 카메라 위치를 읽음
// 사용법: node test/follow.mjs grad.mp4 [스크린샷폴더]   (MP=@mediapipe/hands 폴더를 주면 진짜 손 인식도 한 번 돌려 봄)
import { chromium } from 'playwright-core';
const [V, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const MP = process.env.MP;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 200)); });
await page.route('**/*', r => {
  const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k));
  if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' });
  if (MP && u.includes('@mediapipe/hands')) { const name = u.split('/').pop().split('?')[0]; return r.fulfill({ path: MP + '/' + name, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', headers: { 'Access-Control-Allow-Origin': '*' } }); }
  if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue();
});
if (!MP) await page.addInitScript(() => {
  // 손 두 개: 지판 손은 0.3 → (5~5.5초) → 0.7, 피킹 손은 0.55 근처에 가만히 · 손 못 찾는 구간(8~8.6초) 하나
  window.__pveHandStub = t => {
    if (t > 8 && t < 8.6) return [];
    const k = Math.max(0, Math.min(1, (t - 5) / 0.5));
    return [{ x: 0.3 + 0.4 * k + 0.01 * Math.sin(t * 7), y: 0.45 }, { x: 0.55 + 0.005 * Math.sin(t * 3), y: 0.62 }];
  };
});
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.click('.seg >> text=9:16'); await page.waitForTimeout(300);
await page.click('text=이 영상에서 손 찾기');
for (let i = 0; i < 80; i++) { await page.waitForTimeout(3000); const t = await page.locator('.follow-box').textContent(); if (i % 5 === 0) console.log('..', t.slice(0, 60)); if (!t.includes('손 찾는 중')) break; }
const f = await page.evaluate(() => window.__pveTransport.getProject().follow?.main);
console.log('status:', await page.locator('.status').textContent());
if (MP) {
  ok('mediapipe ran over the video without crashing', !!f || /못 찾았어요/.test(await page.locator('.status').textContent()));
  if (f) {
    // 손 위치 기록 요약: 1초마다 [두 손 x]
    const row = k => Array.from({ length: Math.floor(f.tr[k].length / 2 / 5) }, (_, j) => f.tr[k][j * 10]).map(v => v < 0 ? '-' : v.toFixed(2)).join(' ');
    console.log('hand0 x per s:', row(0)); console.log('hand1 x per s:', row(1));
    console.log('picked:', await page.locator('.follow-box .seg button.on').textContent());
    const cx = async t => { await page.evaluate(t => window.__pveTransport.seek(t), t); await page.waitForTimeout(400); };
    if (OUT) { await cx(2); await page.locator('canvas.stage').screenshot({ path: OUT + '/real_t2.png' }); await cx(8); await page.locator('canvas.stage').screenshot({ path: OUT + '/real_t8.png' }); }
  }
  console.log(logs.join('\n')); await browser.close(); process.exit(0);
}
ok('analysis stored (two hand tracks)', f && f.on && f.tr[0].length > 100 && f.tr[1].length === f.tr[0].length);
ok('auto picks the hand that moves along the neck (left one)', await page.locator('.follow-box .seg button.on').textContent().then(t => /왼쪽/.test(t)));
const centerX = async t => { await page.evaluate(t => window.__pveTransport.seek(t), t); await page.waitForTimeout(350); return page.evaluate(() => { const c = document.querySelector('canvas.stage'), x = c.getContext('2d'); const W = c.width, H = c.height; const d = x.getImageData(Math.round(W / 2), Math.round(H * 0.5), 1, 1).data; return { r: d[0] / 255, g: d[1] / 255 }; }); };
const xs = [];
for (const t of [1, 3, 4.6, 5, 5.25, 5.5, 5.9, 7, 8.3, 10]) { const c = await centerX(t); xs.push([t, +c.r.toFixed(3), +c.g.toFixed(3)]); }
console.log(JSON.stringify(xs));
const at = t => xs.find(v => v[0] === t)[1];
ok('camera sits on the hand at the 3rd fret area (≈0.3 → clamped by edges)', at(3) < 0.4);
ok('camera ends on the hand at the new position (≈0.7)', at(7) > 0.6);
ok('pan is smooth (no jump bigger than 0.2 between samples)', xs.every((v, i) => !i || Math.abs(v[1] - xs[i - 1][1]) < 0.2 + 0.0));
ok('pan goes one way (no wobble)', xs.every((v, i) => !i || v[1] >= xs[i - 1][1] - 0.02));
ok('holds still when the hand only wiggles (deadzone)', Math.abs(at(1) - at(3)) < 0.02 && Math.abs(at(7) - at(10)) < 0.02);
ok('lost-hand gap keeps the camera', Math.abs(at(8.3) - at(7)) < 0.03);
if (OUT) await page.locator('canvas.stage').screenshot({ path: OUT + '/follow_t7.png' });
// 끄면 원래 화면
await page.click('#follow-on'); await page.waitForTimeout(300);
const off = await centerX(7);
ok('switch off → back to normal framing (center ≈0.5)', Math.abs(off.r - 0.5) < 0.06);
await page.click('#follow-on');
// 확대 바꾸면 보이는 범위가 달라짐: 3배면 화면 위아래 끝 초록 차이가 줄어듦
const span = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'), x = c.getContext('2d'); const W = c.width, H = c.height; const a = x.getImageData(W >> 1, 2, 1, 1).data[1], b = x.getImageData(W >> 1, H - 3, 1, 1).data[1]; return (b - a) / 255; });
await centerX(7); const s1 = await span();
await page.locator('#follow-zoom').fill('3'); await page.waitForTimeout(300); await centerX(7.01); const s3 = await span();
console.log('vertical span zoom1.6 vs 3', s1.toFixed(3), s3.toFixed(3));
ok('zoom slider zooms in', s3 < s1 * 0.7);
// 덜 확대(1배 미만): 슬라이더 왼쪽 끝 = 영상 폭 전체 · 위아래 빈 곳은 검정 대신 흐린 배경 · 중간 값이면 손 쪽으로 따라감
const minZ = await page.locator('#follow-zoom').getAttribute('min');
console.log('min zoom', minZ);
ok('slider goes below 1x for a wide video in 9:16', +minZ < 0.4);
const hspan = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'), x = c.getContext('2d'); const W = c.width, H = c.height; const a = x.getImageData(2, H >> 1, 1, 1).data[0], b = x.getImageData(W - 3, H >> 1, 1, 1).data[0]; const top = x.getImageData(W >> 1, Math.round(H * 0.08), 1, 1).data; return { span: (b - a) / 255, top: [...top].slice(0, 3) }; });
await page.locator('#follow-zoom').fill(String(+minZ)); await page.waitForTimeout(300); await centerX(7.02);
const z0 = await hspan(); console.log('min zoom view', JSON.stringify(z0));
ok('min zoom shows the whole width', z0.span > 0.9);
ok('empty top is filled (blurred picture, not black)', z0.top.some(v => v > 25));
await page.locator('#follow-zoom').fill('0.6'); await page.waitForTimeout(300);
const c6 = await centerX(7.03), h6 = await hspan(); console.log('zoom 0.6', JSON.stringify(c6), JSON.stringify(h6));
ok('at 0.6x it still pans toward the hand (center right of middle)', c6.r > 0.55 && h6.span > 0.45 && h6.span < 0.75);
if (OUT) await page.locator('canvas.stage').screenshot({ path: OUT + '/follow_z06.png' });
console.log(logs.join('\n')); await browser.close();
