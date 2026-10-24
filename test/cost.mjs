// 프로젝트 창의 '이번 달 예상 요금' 표시 확인 (가짜 Firebase)
// 먼저: node build.mjs, 저장소 폴더에서 python3 -m http.server 8765
import { chromium } from 'playwright-core';
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', 'firebase-app-compat.js': new URL('./fake-firebase.js', import.meta.url).pathname };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route('**/*', r => {
  const u = r.request().url();
  const f = Object.keys(map).find(k => u.endsWith('/' + k));
  if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' });
  if (u.includes('firebase-') && u.endsWith('compat.js')) return r.fulfill({ body: '', contentType: 'application/javascript' });
  if (u.endsWith('/config.js')) return r.fulfill({ body: 'window.FIREBASE_CONFIG={apiKey:"test",projectId:"t",storageBucket:"t.firebasestorage.app"};window.APP_ADMINS=["*"];', contentType: 'application/javascript' });
  if (u.includes('fonts.g')) return r.abort();
  return r.continue();
});
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:8765/deploy/video-editor/index.html');
const G = 1024 ** 3;
await page.evaluate(G => {
  localStorage.clear();
  const f = (n, s) => ({ name: n, path: 'files/' + n, size: s, type: 'video/quicktime' });
  localStorage.setItem('__fakefs', JSON.stringify({ projects: {
    p1: { title: '드럼 커버 1', ownerUid: 'u1', ownerName: '오세혁', videoName: 'IMG_1.MOV', recName: '', sheetName: '', angleNames: [], project: { bpm: 120 }, createdAt: 1, updatedAt: Date.now(), files: { video: f('IMG_1.MOV', 3.2 * G) } },
    p2: { title: '기타 연주', ownerUid: 'u1', ownerName: '오세혁', videoName: 'IMG_2.MOV', recName: '', sheetName: '', angleNames: [], project: { bpm: 90 }, createdAt: 1, updatedAt: Date.now(), files: { video: f('IMG_2.MOV', 4.1 * G) } },
  } }));
  const d = new Date(); localStorage.setItem(`pve.dl.${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, String(12.5 * G));
}, G);
await page.reload();
await page.evaluate(() => { window.__FAKE_LOGIN = { uid: 'u1', email: 'osp2ow@gmail.com', displayName: '오세혁', emailVerified: true }; });
await page.click('.btn.google'); await page.waitForSelector('.cloudbar');
await page.click('.cloudbar >> text=프로젝트');
await page.waitForSelector('.usage');
const out = process.argv[2] || 'cost';
console.log('us  :', (await page.textContent('.usage')).replace(/\s+/g, ' '));
await page.locator('.usage').screenshot({ path: out + '-us.png' });
await page.selectOption('#cost-region', 'asia');
console.log('asia:', (await page.textContent('.usage')).replace(/\s+/g, ' '));
await page.locator('.modal').screenshot({ path: out + '-asia.png' });
console.log(logs.join('\n') || 'no errors');
await browser.close();
