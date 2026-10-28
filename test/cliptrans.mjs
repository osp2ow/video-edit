// 이어 붙인 영상 사이 장면 전환(디졸브): 미리보기 + MP4 추출
// 사용법: MP4BOX=…/mp4box.all.min.js node test/cliptrans.mjs 영상1 영상2 출력.mp4
import { chromium } from 'playwright-core';
const [V1, V2, OUT] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
if (process.env.MP4BOX) map['mp4box.all.min.js'] = process.env.MP4BOX;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (/추출/.test(m.text())) logs.push(m.text().slice(0, 120)); });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요|불러왔어요/); await page.waitForTimeout(800);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
// 효과 탭 → 장면 전환 디졸브 1초
await page.click('button[role=tab]:text-is("효과")');
await page.click('button:text-is("디졸브")');
await page.locator('#tr-dur').fill('1'); await page.waitForTimeout(200);
let p = await P();
console.log('fx tr', p.fx.trType, p.fx.trDur, 'clips', JSON.stringify(p.clips.map(c => [c.src || 'main', c.start, c.srcOut - c.srcIn])));
const B = p.clips.sort((a, b) => a.start - b.start)[1].start;
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(600); };
const px = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(c.width * 0.5, c.height * 0.5, 1, 1).data; return [d[0], d[1], d[2]]; });
await seek(B - 1.5); const a = await px();
await seek(B + 1.5); const b = await px();
await seek(B); const m = await px();
console.log('before / after / middle', a, b, m);
const diff = (x, y) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
ok('preview blends at boundary', diff(m, a) > 20 && diff(m, b) > 20);
// 추출 (영상 전체, 720p)
await page.click('.export-btn');
await page.click('text=720p');
const dlP = page.waitForEvent('download', { timeout: 300000 });
await page.evaluate(() => { delete window.showSaveFilePicker; });
await page.click('text=추출 시작');
await page.waitForFunction(() => document.querySelector('.ok-text') || /실패|못 했|오류/.test(document.querySelector('.modal-body')?.textContent || ''), null, { timeout: 300000 });
console.log('result:', (await page.textContent('.modal-body')).slice(0, 120));
const dl = await dlP;
await dl.saveAs(OUT);
console.log('saved', OUT, 'boundary at', B);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
