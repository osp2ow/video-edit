// 1) 영상 줄을 골라도 미리보기는 효과 넣은 화면 그대로  2) 영상 조각을 끌면 맞춰 둔 녹음본이 따라옴, 녹음본을 끌면 녹음본만
// 사용법: node test/linkrec.mjs 영상1 녹음본 영상2
import { chromium } from 'playwright-core';
const [V1, R1, V2] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec', R1); await waitMsg(/자동 감지|녹음본 분석 완료/); await page.waitForTimeout(800);
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요|불러왔어요/); await page.waitForTimeout(1000);
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
let tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const pps = (tl.width - 2) / (end * 1.02);
const X = t => tl.x + (t + end * 0.01) * pps;
let MAIN_Y = tl.y + 30 + 132 + 25, REC_Y = tl.y + 30 + 188 + 25;
const remeasure = async () => { tl = await page.locator('.tl-canvas canvas').boundingBox(); MAIN_Y = tl.y + 30 + 132 + 25; REC_Y = tl.y + 30 + 188 + 25; };
await page.screenshot({ path: process.env.SHOT || '/dev/null', clip: { x: tl.x, y: tl.y, width: tl.width, height: tl.height } }).catch(() => {});
const hash = () => page.evaluate(() => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 64) h = (h * 31 + d[i]) | 0; return h; });
let p = await P();
const cs = () => p.clips.slice().sort((a, b) => a.start - b.start);
const recAt = pp => typeof pp.recAt === 'number' ? pp.recAt : null;
console.log('clips', JSON.stringify(cs().map(c => [c.src || 'main', +c.start.toFixed(2), +(c.srcOut - c.srcIn).toFixed(2)])), 'recAt', recAt(p));

// 1) 미리보기
const c1 = cs()[0];
await page.mouse.click(X(c1.start + 3), tl.y + 21); await page.waitForTimeout(600);
const h0 = await hash();
await page.mouse.click(X(c1.start + 3), MAIN_Y); await page.waitForTimeout(600);
const h1 = await hash();
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('.png', '2.png') });
ok('preview unchanged after picking the video track (effects view kept)', h0 === h1);

await remeasure();
// 2) 첫 영상 조각 끌기 → 녹음본 따라옴
const other0 = cs()[1], ref = pp => pp.clips.find(c => c.id === other0.id).start;
const r0 = recAt(p) - ref(p), s0 = c1.start - ref(p);
await page.mouse.move(X(c1.start + 5.5), MAIN_Y); await page.mouse.down();
await page.mouse.move(X(c1.start + 5.5) - 80, MAIN_Y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('.png', '3.png') });
console.log('tl', JSON.stringify(tl), 'down at', X(c1.start + 3), MAIN_Y);
p = await P();
const n1 = p.clips.find(c => c.id === c1.id), dClip = n1.start - ref(p) - s0, dRec = recAt(p) - ref(p) - r0;
console.log('clip moved', dClip.toFixed(3), 'rec moved', dRec.toFixed(3));
ok('dragging the video moves its synced recording too', Math.abs(dClip) > 0.3 && Math.abs(dRec - dClip) < 0.002);
const c2 = p.clips.find(c => c.id !== c1.id);
await remeasure();
const X0 = X;
// 3) 녹음본 끌기 → 영상은 그대로
const ra = recAt(p), gap0 = p.clips.find(c => c.id === c1.id).start - ref(p), relRec0 = recAt(p) - ref(p);
await page.mouse.move(X(ra + 2), REC_Y); await page.mouse.down();
await page.mouse.move(X(ra + 2) + 40, REC_Y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500);
p = await P();
console.log('rec moved (vs video)', (recAt(p) - ref(p) - relRec0).toFixed(3));
ok('dragging the recording moves only the recording', Math.abs(recAt(p) - ref(p) - relRec0) > 0.2 && Math.abs(p.clips.find(c => c.id === c1.id).start - ref(p) - gap0) < 1e-6);
await remeasure();
// 4) 녹음본과 거의 안 겹치는 두 번째 영상을 끌면 녹음본은 그대로
const c1s = pp => pp.clips.find(c => c.id === c1.id).start, rb = recAt(p) - c1s(p), s2 = c2.start - c1s(p);
await page.mouse.move(X(c2.start + 2), MAIN_Y); await page.mouse.down();
await page.mouse.move(X(c2.start + 2) + 60, MAIN_Y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500);
p = await P();
const m2 = p.clips.find(c => c.id === c2.id).start - c1s(p) - s2, mr = recAt(p) - c1s(p) - rb;
console.log('other clip moved', m2.toFixed(3), 'rec moved', mr.toFixed(3));
ok('moving a video the recording is not synced to leaves the recording', Math.abs(m2) > 0.3 && Math.abs(mr) < 1e-6);
// 5) 되돌리기 한 번에 영상+녹음본이 같이 돌아가는지
console.log(logs.join('\n') || 'no page errors');
await browser.close();
