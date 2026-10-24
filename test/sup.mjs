import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
await page.goto('file:///home/claude/pve/test/blank.html');
console.log(await page.evaluate(async () => {
  const r = {};
  for (const c of ['avc1.64001f', 'hvc1.1.6.L120.90', 'vp09.00.30.08']) r[c] = (await VideoDecoder.isConfigSupported({ codec: c, codedWidth: 540, codedHeight: 960 })).supported;
  return r;
}));
await browser.close();
