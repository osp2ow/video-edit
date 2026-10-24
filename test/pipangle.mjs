// 앵글 추가 영상(세로)을 PIP로 넣고 재생할 때 앵글 영상이 같이 움직이는지
// 사용법: node test/pipangle.mjs 기준영상 앵글영상 [스크린샷경로]
import { chromium } from 'playwright-core';
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() !== 'log') logs.push(m.type() + ' ' + m.text().slice(0, 150)); });
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.addInitScript(() => {
  const op = HTMLMediaElement.prototype.pause;
  window.__pz = [];
  HTMLMediaElement.prototype.pause = function () { if (this.videoHeight > 2000) window.__pz.push('JS pause: ' + new Error().stack.split('\n').slice(2, 4).join(' | ')); return op.call(this); };
  document.addEventListener('pause', e => { if (e.target.videoHeight > 2000) window.__pz.push('pause event t=' + e.target.currentTime.toFixed(2)); }, true);
  document.addEventListener('play', e => { if (e.target.videoHeight > 2000) window.__pz.push('play event'); }, true);
  document.addEventListener('waiting', e => { if (e.target.videoHeight > 2000) window.__pz.push('waiting'); }, true);
});
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', process.argv[2]);
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('분석'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
if (process.env.REC) { await page.setInputFiles('#f-rec', process.env.REC); await page.waitForFunction(() => /자동 감지|녹음본 분석 완료/.test(document.body.textContent), null, { timeout: 60000 }); await page.waitForTimeout(1500); }
await page.setInputFiles('#f-angle', process.argv[3]);
await page.waitForFunction(() => /앵글을 추가했어요|읽지 못했어요/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1500);
console.log('status:', await page.textContent('.status'));
await page.click('button:text-is("PIP")');
await page.waitForTimeout(300);
const vids = () => page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => ({ src: v.src.slice(-6), t: +v.currentTime.toFixed(2), paused: v.paused, rs: v.readyState, w: v.videoWidth, h: v.videoHeight, rate: +v.playbackRate.toFixed(2), err: v.error?.code })));
console.log('offsets', await page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); const p = JSON.parse(localStorage.getItem(k)); return JSON.stringify({ off: p.angleOffsets, trims: p.trims, cuts: p.cuts }); }));
console.log('before', JSON.stringify(await vids()));
await page.keyboard.press('Space');
for (let i = 0; i < 4; i++) { await page.waitForTimeout(1000); console.log('play', i, JSON.stringify(await vids())); }
console.log('direct play:', await page.evaluate(async () => { const v = document.querySelectorAll('video')[1]; try { await v.play(); await new Promise(r => setTimeout(r, 800)); return 'ok t=' + v.currentTime.toFixed(2) + ' paused=' + v.paused; } catch (e) { return 'ERR ' + e.name + ': ' + e.message; } }));
console.log((await page.evaluate(() => window.__pz)).slice(0, 14).join('\n'));
if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
await page.keyboard.press('Space');
console.log(logs.slice(0, 15).join('\n') || 'no errors');
await browser.close();
