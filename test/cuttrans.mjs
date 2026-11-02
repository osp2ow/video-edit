// 한 영상을 잘라 붙인 두 조각 사이 장면 전환 (미리보기 + 추출)
// 영상: 앞 10초 빨강 · 뒤 10초 파랑. 조각1 = 0~6초, 조각2 = 파일 12~20초를 6초부터 (맞닿음)
import { chromium } from 'playwright-core';
const [V, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
if (process.env.MP4BOX) map['mp4box.all.min.js'] = process.env.MP4BOX;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
const name = V.split('/').pop();
// 저장된 설정으로 열기 (같은 이름 영상을 다시 열면 지난 설정 복원): 조각 두 개 + 두 번째 조각 앞 디졸브 1초
await page.evaluate(n => { localStorage.setItem('pve.proj:' + n, JSON.stringify({ bpm: 120, beatsPerBar: 4, anchorTime: 0, anchorBar: 1, bpmTouched: true, anchorTouched: true, cuts: [], angleOffsets: {}, captions: [],
  clips: [{ id: 'a', start: 0, srcIn: 0, srcOut: 6 }, { id: 'b', start: 6, srcIn: 12, srcOut: 20 }] })); }, name);
await page.setInputFiles('#f-video', V); await waitMsg(/분석 완료|자동 감지|읽지 못했/); await page.waitForTimeout(1200);
const P = () => page.evaluate(n => JSON.parse(localStorage.getItem('pve.proj:' + n)), name);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
let p = await P(); console.log('clips', JSON.stringify(p.clips));
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const MAIN_Y = tl.y + 30 + 132 + 25;
// 두 번째 조각 고르기 → 위쪽 '앞 조각과 전환'에서 디졸브
await page.mouse.click(X(9), MAIN_Y); await page.waitForTimeout(300);
ok('transition picker shown for second piece', await page.locator('#clip-tr').count() === 1);
await page.selectOption('#clip-tr', 'dissolve'); await page.waitForTimeout(150);
await page.fill('#clip-tr-dur', '1'); await page.press('#clip-tr-dur', 'Enter'); await page.waitForTimeout(150);
p = await P(); console.log('trIn', JSON.stringify(p.clips.find(c => c.id === 'b').trIn));
ok('per-cut transition saved', p.clips.find(c => c.id === 'b').trIn?.type === 'dissolve' && p.clips.find(c => c.id === 'b').trIn.dur === 1);
// 첫 번째 조각에는 전환 칸이 없음 (앞 조각이 없으니까)
await page.mouse.click(X(2), MAIN_Y); await page.waitForTimeout(200);
ok('no picker on first piece', await page.locator('#clip-tr').count() === 0);
// 맞닿은 경계 버튼을 바로 눌러 고르기
await page.mouse.click(X(6), MAIN_Y); await page.waitForTimeout(250);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, clip: { x: tl.x, y: tl.y - 300, width: tl.width * 0.6, height: 520 } });
ok('junction click opens transition menu', await page.locator('.seg-menu[aria-label="장면 전환"]').count() === 1);
await page.click('.seg-menu[aria-label="장면 전환"] button:text-is("슬라이드")'); await page.waitForTimeout(120);
p = await P(); ok('menu sets slide', p.clips.find(c => c.id === 'b').trIn?.type === 'slide');
await page.click('.seg-menu[aria-label="장면 전환"] button:text-is("디졸브")'); await page.waitForTimeout(120);
await page.locator('#ctm-dur').fill('1'); await page.waitForTimeout(120);
p = await P(); ok('menu sets dissolve 1s', p.clips.find(c => c.id === 'b').trIn?.type === 'dissolve' && p.clips.find(c => c.id === 'b').trIn.dur === 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(100);
ok('menu closes', await page.locator('.seg-menu[aria-label="장면 전환"]').count() === 0);
await page.keyboard.press('Escape');
const px = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0], d[1], d[2]]; });
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(900); };
const shots = [];
for (const t of [5.6, 5.85, 6.15, 6.4]) { await seek(t); shots.push([t, await px()]); }
console.log('preview colors', JSON.stringify(shots));
const mixed = ([r, g, b]) => r > 40 && b > 40;   // 빨강과 파랑이 섞임
ok('preview blends before cut (red → toward blue)', mixed(shots[1][1]));
ok('preview blends after cut', mixed(shots[2][1]));
if (OUT) {
  await page.click('.export-btn'); await page.click('text=720p');
  const dlP = page.waitForEvent('download', { timeout: 300000 });
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  await page.click('text=추출 시작');
  const dl = await dlP; await dl.saveAs(OUT); console.log('saved', OUT);
}
console.log(logs.join('\n') || 'no page errors');
await browser.close();
