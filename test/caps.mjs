import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
await page.goto('file:///home/claude/pve/test/blank.html');
console.log(await page.evaluate(async () => {
  const out = {};
  for (const c of ['avc1.640028', 'avc1.64002A', 'avc1.4d0028', 'avc1.42e028', 'vp09.00.40.08']) {
    try { out[c] = (await VideoEncoder.isConfigSupported({ codec: c, width: 1080, height: 1920, bitrate: 12e6, framerate: 30 })).supported; } catch (e) { out[c] = 'err ' + e.message; }
  }
  for (const c of ['mp4a.40.2', 'opus']) {
    try { out[c] = (await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported; } catch (e) { out[c] = 'err ' + e.message; }
  }
  out.rvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  return out;
}));
await browser.close();
