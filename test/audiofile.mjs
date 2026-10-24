// 영상에서 소리만 꺼내기: 파일 전체로 디코딩한 결과와 같은지, 얼마나 빠른지
// 사용법: node test/audiofile.mjs 영상1 영상2 ...
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
const dir = mkdtempSync(tmpdir() + '/af-');
await build({ entryPoints: ['test/audiofile_entry.ts'], bundle: true, outfile: dir + '/t.js', format: 'iife' });
writeFileSync(dir + '/t.html', '<input type=file id=f multiple><script src="t.js"></script>');
const exe = process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
page.on('console', m => console.log('  [page]', m.text().slice(0, 200)));
await page.goto('file://' + dir + '/t.html');
await page.setInputFiles('#f', process.argv.slice(2));
const res = await page.evaluate(async () => {
  const out = [];
  for (const f of document.querySelector('#f').files) {
    const r = { name: f.name, size: f.size };
    try {
      let t = performance.now();
      const small = await T.extractAudio(f);
      r.extractMs = Math.round(performance.now() - t);
      r.smallSize = small ? small.size : null;
      t = performance.now();
      const a = small ? await T.decodeMono(await small.arrayBuffer()) : null;
      r.fastMs = Math.round(performance.now() - t) + r.extractMs;
      t = performance.now();
      let b = null; try { b = await T.decodeMono(await f.arrayBuffer()); } catch (e) { r.fullErr = String(e).slice(0, 80); }
      r.fullMs = Math.round(performance.now() - t);
      if (a && b) {
        let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
        r.lenFast = a.length; r.lenFull = b.length; r.maxDiff = d;
      }
    } catch (e) { r.err = String(e).slice(0, 100); }
    out.push(r);
  }
  return out;
});
for (const r of res) console.log(JSON.stringify(r));
await browser.close();
