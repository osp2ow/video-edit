// 미리보기 재생 중 영상이 시계를 얼마나 잘 따라가는지 (재생 속도 조절·위치 옮김이 잦으면 영상 소리가 늘어지거나 끊겨 들림)
import { chromium } from 'playwright-core';
const [V, SECS] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', V);
await page.waitForFunction(() => /자동 감지|분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
const r = await page.evaluate(async secs => {
  const t = window.__pveTransport; t.seek(0); await new Promise(r => setTimeout(r, 300));
  const el = t.elOf(t.clipAt(0.5));
  let jumps = 0; const orig = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  Object.defineProperty(el, 'currentTime', { get() { return orig.get.call(this); }, set(v) { jumps++; orig.set.call(this, v); } });
  await t.play(); const t0 = performance.now(); const S = [];
  while (performance.now() - t0 < secs * 1000) {
    await new Promise(r => setTimeout(r, 50));
    const T = t.time(), c = t.clipAt(T); if (!c) continue;
    S.push({ T, drift: (c.srcIn + T - c.start) - el.currentTime, rate: el.playbackRate });
  }
  t.pause();
  const off = S.filter(s => s.rate !== 1).length, ad = S.map(s => Math.abs(s.drift)).sort((a, b) => a - b);
  let tr = 0; for (let i = 1; i < S.length; i++) if ((S[i].rate !== 1) !== (S[i-1].rate !== 1)) tr++;
  return { n: S.length, rateOff: off, changes: tr, offAt: S.filter(s => s.rate !== 1).map(s => +s.T.toFixed(1)).join(" "), jumps, driftMed: ad[ad.length >> 1], driftMax: ad[ad.length - 1], last: S.slice(-3), first: S.slice(0, 6), curve: S.filter((_, i) => i % 6 === 0).map(s => [+s.T.toFixed(2), +s.drift.toFixed(3)]) };
}, +(SECS || 6));
console.log(JSON.stringify(r)); console.log(logs.join('\n')); await browser.close();
