// 녹음본 조각마다 페이드 아웃이 실제 소리 크기 예약(GainNode)에 들어가는지
// 사용법: node test/fadeaudio.mjs 영상 녹음본1 녹음본2
import { chromium } from 'playwright-core';
const [V1, R1, R2] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.addInitScript(() => {
  // 소리 크기 예약 기록: 0에 가까워지는 ramp = 페이드 아웃 끝
  window.__ramps = [];
  const orig = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.linearRampToValueAtTime = function (v, t) { window.__ramps.push({ v, t, now: this.__ctx?.currentTime }); return orig.call(this, v, t); };
  const og = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function () { const g = og.call(this); g.gain.__ctx = this; return g; };
});
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = (re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 60000 });
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec', R1); await waitMsg(/자동 감지|녹음본 분석 완료/); await page.waitForTimeout(800);
await page.setInputFiles('#f-rec2', R2); await waitMsg(/녹음본|맞췄|붙였/); await page.waitForTimeout(1500);
const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pveTransport.getProject())));
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
let tl = await page.locator('.tl-canvas canvas').boundingBox();
const endOf = () => page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
let end = await endOf();
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
const remeasure = async () => { tl = await page.locator('.tl-canvas canvas').boundingBox(); end = await endOf(); };
const REC_Y = () => tl.y + 30 + 188 + 25;
let p = await P();
console.log('recAt', p.recAt, 'recClips', JSON.stringify(p.recClips), 'trims', JSON.stringify(p.trims));
// 첫 녹음본을 가운데에서 자르기
const durs = await page.evaluate(() => { const t = window.__pveTransport; return null; });
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(300); };
const recLen = 20;   // 대략
await page.mouse.click(X(p.recAt + 3), REC_Y()); await page.waitForTimeout(300); await remeasure();
await seek(p.recAt + 8); await page.mouse.click(X(p.recAt + 3), REC_Y()); await page.waitForTimeout(200); await seek(p.recAt + 8);
await page.keyboard.press('KeyI'); await page.waitForTimeout(500);
p = await P();
console.log('after cut recClips', JSON.stringify(p.recClips), 'trims', JSON.stringify(p.trims));
// 조각 목록 (키, 타임라인 시작·끝)
const pieces = [];
pieces.push({ key: 'rec', a: p.recAt + (p.trims?.rec?.in ?? 0), b: p.recAt + (p.trims?.rec?.out ?? recLen) });
for (const c of p.recClips) { const k = 'recx:' + (c.id || c.src), tr = p.trims?.[k]; pieces.push({ key: k, a: c.at + (tr?.in ?? 0), b: c.at + (tr?.out ?? 999), at: c.at }); }
console.log('pieces', JSON.stringify(pieces));
for (const pc of pieces) {
  await remeasure();
  const mid = (pc.a + Math.min(pc.b, pc.a + 6)) / 2;
  await page.mouse.click(X(mid), REC_Y()); await page.waitForTimeout(300);
  if (!(await page.$('#rec-fade-out'))) { console.log('no fade box for', pc.key); continue; }
  await page.fill('#rec-fade-out', '2'); await page.press('#rec-fade-out', 'Enter'); await page.waitForTimeout(200);
}
p = await P(); console.log('recFades', JSON.stringify(p.recFades));
for (const pc of pieces) ok('fade-out saved for ' + pc.key, p.recFades?.[pc.key]?.out === 2);
// 재생: 조각 끝 3초 전부터 → 끝 시각에 0으로 가는 예약이 있어야 함
const bufDur = await page.evaluate(() => { const pl = window.__pveTransport.player; const o = { rec: pl.recBuf?.duration }; for (const [k, b] of pl.extraBufs) o[k] = b.duration; return o; });
console.log('buffer durations', JSON.stringify(bufDur));
for (const pc of pieces) {
  const b = pc.key === 'recx:rec2.mp3' ? pc.at + bufDur['rec2.mp3'] : pc.b;
  await page.evaluate(() => { window.__ramps = []; });
  await page.evaluate(t => window.__pveTransport.play(t), b - 3);
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => { const tr = window.__pveTransport, pl = tr.player; return { T0: pl.T0, c0: pl.c0, ramps: window.__ramps }; });
  await page.evaluate(() => window.__pveTransport.pause()); await page.waitForTimeout(200);
  const ctAtEnd = info.c0 + (b - info.T0);
  const hit = info.ramps.some(r => r.v < 0.01 && Math.abs(r.t - (ctAtEnd + 0.02)) < 0.06);
  const hitStart = info.ramps.some(r => r.v > 0.9 && Math.abs(r.t - (ctAtEnd + 0.02 - 2)) < 0.06);
  console.log(pc.key, 'end', b.toFixed(2), 'expect 0 at', (ctAtEnd + 0.02).toFixed(2), 'ramps', JSON.stringify(info.ramps.map(r => [+r.v.toFixed(2), +r.t.toFixed(2)])));
  ok('fade-out scheduled in playback for ' + pc.key, hit && hitStart);
}
console.log(logs.join('\n') || 'no page errors');
await browser.close();
