import { chromium } from 'playwright-core';
import fs from 'fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ path: 'test/sheet_bundle.js' });
for (const f of process.argv.slice(2)) {
  const b64 = fs.readFileSync(f).toString('base64');
  const out = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
    const s = detectSheet([c], 'x');
    return s.systems.map(y => [y.staffY, y.staffH, y.canvas.height, +((y.canvas.height - y.staffY) / y.canvas.width).toFixed(3)]);
  }, b64);
  console.log(f.split('/').pop(), JSON.stringify(out));
}
await browser.close();
