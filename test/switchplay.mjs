// 재생 중 다른 영상 조각으로 넘어갈 때 멈추지 않고 이어서 재생되는지
// 사용법: node test/switchplay.mjs 영상1 영상2(무거운 영상이면 더 잘 드러남)
import { chromium } from 'playwright-core';
const [V1, V2] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
const waitMsg = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.status')?.textContent || ''), re.source, { timeout: 90000 });
await page.setInputFiles('#f-video', V1); await waitMsg(/분석 완료|읽지 못했/); await page.waitForTimeout(800);
await page.setInputFiles('#f-source', V2); await waitMsg(/옮길 수 있어요/); await page.waitForTimeout(1500);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)); });
const p = await P(), cs = p.clips.sort((a, b) => a.start - b.start), B = cs[1];
console.log('clips', JSON.stringify(cs.map(c => [c.src || 'main', +c.start.toFixed(2), +(c.srcOut - c.srcIn).toFixed(2)])));
await page.click('.tl-zoom >> text=전체 보기'); await page.waitForTimeout(200);
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const end = await page.evaluate(() => { const [m, s] = document.querySelector('.now-t').nextElementSibling.textContent.replace('/', '').trim().split(':'); return +m * 60 + +s; });
const X = t => tl.x + (t + end * 0.01) * ((tl.width - 2) / (end * 1.02));
await page.mouse.click(X(B.start - 1.2), tl.y + 21); await page.waitForTimeout(500);
await page.keyboard.press('Space');
const els = () => page.evaluate(() => [(() => { const t = window.__pveTransport.time(); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + (t % 60).toFixed(3); })(), ...Array.from(document.querySelectorAll('video')).filter(v => v.src).map(v => ({ id: decodeURIComponent(v.src).slice(-5), t: +v.currentTime.toFixed(2), paused: v.paused, rs: v.readyState, seeking: v.seeking, r: +v.playbackRate.toFixed(2), q: (v.getVideoPlaybackQuality?.().droppedVideoFrames) }))]);
const samples = [];
for (let i = 0; i < (+process.env.N || 8); i++) { await page.waitForTimeout(500); samples.push(await els()); }
await page.keyboard.press('Space');
for (const s of samples) console.log(JSON.stringify(s));
// 마지막에 두 번째 영상이 재생 중이고 위치가 시계를 따라왔는지
const last = samples[samples.length - 1].slice(1), first = samples[3].slice(1);
const v2 = arr => arr.find(v => !v.paused) || null;
const moving = last.some(v => !v.paused) && first.some(v => !v.paused);
const tsec = x => { const [m, r] = x.split(':'); return +m * 60 + +r; };
const drifts = samples.slice(4).map(x => { const v = x.slice(1).find(v => !v.paused); return v ? +(v.t - (tsec(x[0]) - B.start + B.srcIn)).toFixed(2) : null; });
console.log('drift (video - clock) after switch', JSON.stringify(drifts));
console.log(drifts.every(d => d !== null) && Math.abs(drifts[drifts.length - 1]) < 0.12 ? 'ok   video follows clock (steady)' : 'FAIL video out of sync');
console.log(moving ? 'ok   keeps playing after switching to the other video' : 'FAIL stuck after switching');
console.log(logs.join('\n') || 'no page errors');
await browser.close();
