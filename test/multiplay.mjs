import { chromium } from 'playwright-core';
const NM = '/home/claude/pve/node_modules';
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g')) return r.abort(); return r.continue(); });
await page.goto('file:///home/claude/pve/dist/index.html');
await page.setInputFiles('#f-video', 'test/test.webm');
await page.setInputFiles('#f-rec', '/home/claude/poc/in/rec.mp3');
await page.waitForFunction(() => /싱크|자동 감지|분석 완료/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.setInputFiles('#f-source', 'test/angle2.webm');
await page.waitForFunction(() => /이어 붙였|맞춰 놓았/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(800);
// move the source clip to the end (no overlap) to test concatenation
const r = await page.evaluate(async () => {
  const tr = window.__pveTransport;
  const p = tr.getProject(); const cs = tr.clips();
  const src = cs.find(c => c.src), m = cs.find(c => !c.src);
  const out = { clips: cs.map(c => [c.src || 'MAIN', c.start, c.srcIn, c.srcOut]) };
  const samples = [];
  const T = src.start - 1.2;
  tr.play(T);
  const t0 = performance.now();
  while (performance.now() - t0 < 3500) {
    await new Promise(r => setTimeout(r, 250));
    const t = tr.time(), c = tr.clipAt(t), el = tr.elOf(c);
    const vids = [...tr.els().entries()].map(([k, v]) => k.slice(0, 6) + ':' + (v.paused ? 'P' : '>') + v.currentTime.toFixed(2));
    samples.push([t.toFixed(2), c ? (c.src || 'MAIN') : '-', el ? (c.srcIn + t - c.start - el.currentTime).toFixed(3) : '', vids.join(' ')].join(' '));
  }
  tr.pause();
  out.samples = samples;
  return out;
});
console.log(JSON.stringify(r.clips)); console.log(r.samples.join('\n'));
console.log(logs.join('\n')); await browser.close();
