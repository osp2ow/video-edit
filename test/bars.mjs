import { chromium } from 'playwright-core';
import fs from 'fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ path: 'test/sheet_bundle.js' });
for (const f of process.argv.slice(2)) {
  const b64 = fs.readFileSync(f).toString('base64');
  const r = await page.evaluate(async ([b64, name]) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const file = new File([blob], name, { type: 'image/png' });
    const pages = await fileToPages(file);
    const s = detectSheet(pages, name);
    return s.systems.map((sy, i) => ({ i, bars: s.bars.filter(b => b.sys === i).length, w: sy.canvas.width, barXs: sy.barXs.map(Math.round) }));
  }, [b64, f.split('/').pop()]);
  console.log(f.split('/').pop(), JSON.stringify(r));
}
await browser.close();
