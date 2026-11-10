// 클라우드 프로젝트에서 영상 바꾸기가 예전 파일로 되돌아가지 않는지 (가짜 Firebase)
// A) 프로젝트를 열고 파일을 받는 사이(느린 내려받기) 기준 영상·PIP 영상을 같은 이름 새 파일로 바꿈 → 받기가 끝나도 새 파일 그대로
// B) 다른 컴퓨터에서 같은 이름으로 파일을 바꿈 → 이 창도 새 파일로 바뀌고, 파일 목록이 최신으로
// 먼저: node build.mjs, 저장소 폴더에서 python3 -m http.server 8765
// 사용법: node test/samecloud.mjs <a 폴더(clip.mp4 빨강, pip.mp4 초록)> <b 폴더(clip.mp4 파랑, pip.mp4 노랑)>
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const [A, B] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', 'firebase-app-compat.js': new URL('./fake-firebase.js', import.meta.url).pathname };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.route('**/*', r => {
  const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k));
  if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' });
  if (u.includes('firebase-') && u.endsWith('compat.js')) return r.fulfill({ body: '', contentType: 'application/javascript' });
  if (u.endsWith('/config.js')) return r.fulfill({ body: 'window.FIREBASE_CONFIG={apiKey:"t",projectId:"t",storageBucket:"t.firebasestorage.app"};window.APP_ADMINS=["*"];', contentType: 'application/javascript' });
  if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort();
  return r.continue();
});
const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (/클라우드/.test(m.text())) logs.push('CONSOLE ' + m.text()); });
await page.goto('http://localhost:8765/deploy/video-editor/index.html');
const b64 = p => readFileSync(p).toString('base64');
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
const COLORS = { red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], yellow: [255, 255, 0] };
const nameOf = ([r, g, b]) => Object.entries(COLORS).map(([n, c]) => [n, (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2]).sort((a, b) => a[1] - b[1])[0][0];
const px = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.stage'); const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
const look = async t => { await page.evaluate(t => window.__pveTransport.seek(t), t); await page.waitForTimeout(900); const fy = await page.evaluate(() => { const c = document.querySelector('canvas.stage'); return 0.74 - 0.1125 * c.width / c.height; }); return { main: nameOf(await px(0.3, 0.5)), pip: nameOf(await px(0.76, fy)) }; };
const doc = () => page.evaluate(() => window.__fakeDump().projects.P1);
// 클라우드 프로젝트: 기준 영상 clip.mp4(빨강) + PIP pip.mp4(초록)
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('__fakefs', JSON.stringify({ projects: { P1: {
    title: '바꾸기 테스트', ownerUid: 'u0', ownerName: '오세혁', videoName: 'clip.mp4', recName: '', sheetName: '', angleNames: [], sourceNames: ['pip.mp4'], recNames: [],
    project: { bpm: 100, bpmTouched: true, beatsPerBar: 4, anchorTime: 0, anchorBar: 1, cuts: [], angleOffsets: {}, clips: [{ id: 'm1', start: 0, srcIn: 0, srcOut: 12 }], overlays: [{ id: 'o1', src: 'pip.mp4', start: 2, srcIn: 0, srcOut: 8 }] },
    createdAt: 1, updatedAt: 1,
    files: { video: { name: 'clip.mp4', path: 'files/old-clip.mp4', size: 1, type: 'video/mp4' }, sources: { 'pip.mp4': { name: 'pip.mp4', path: 'files/old-pip.mp4', size: 1, type: 'video/mp4' } } },
  } } }));
});
await page.reload();
await page.evaluate(({ c, p }) => {
  const toBlob = b => new Blob([Uint8Array.from(atob(b), x => x.charCodeAt(0))], { type: 'video/mp4' });
  window.__fakeBlobs.set('files/old-clip.mp4', toBlob(c)); window.__fakeBlobs.set('files/old-pip.mp4', toBlob(p));
  window.__FAKE_LOGIN = { uid: 'u1', email: 'osp2ow@gmail.com', displayName: '오세혁', emailVerified: true };
  window.__fakeDlDelay = 3000;   // 파일마다 3초씩 걸려 받는 것처럼
  window.__fakeUpDelay = 8000;   // 새 파일을 올리는 데는 8초 (큰 영상)
}, { c: b64(A + '/clip.mp4'), p: b64(A + '/pip.mp4') });
await page.click('.btn.google'); await page.waitForSelector('.cloudbar');
await page.click('.cloudbar >> text=프로젝트');
await page.click('.pj-list li >> text=열기');
// A) 받는 사이에 새 파일로 바꾸기 (기준 영상은 왼쪽 칸에, PIP 영상은 '영상 추가'로 같은 이름)
await page.waitForTimeout(500);
await page.setInputFiles('#f-video', B + '/clip.mp4');
await page.waitForFunction(() => /분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.setInputFiles('#f-source', B + '/pip.mp4');
await page.waitForTimeout(12000);   // 받기가 다 끝날 때까지
await page.evaluate(() => { window.__fakeDlDelay = 0; });
await page.waitForFunction(() => !document.querySelector('.transfer'), null, { timeout: 30000 }).catch(() => {});
await page.evaluate(() => { window.__fakeUpDelay = 0; });
let s = await look(3.5); console.log('A after downloads finished', JSON.stringify(s), '|', await page.textContent('.status'));
ok('A: main stays NEW (blue) after cloud download finished', s.main === 'blue');
ok('A: PIP stays NEW (yellow) after cloud download finished', s.pip === 'yellow');
await page.waitForTimeout(1500);
let d = await doc(); console.log('A files', JSON.stringify({ v: d.files.video?.path, s: d.files.sources?.['pip.mp4']?.path }));
ok('A: cloud now points to the new files', d.files.video?.path !== 'files/old-clip.mp4' && d.files.sources?.['pip.mp4']?.path !== 'files/old-pip.mp4');
const newV = d.files.video.path;
// B) 다른 컴퓨터가 같은 이름으로 파일을 바꿈 (빨강·초록으로 되돌림) → 이 창도 바뀌어야
await page.evaluate(async ({ c, p }) => {
  const toBlob = b => new Blob([Uint8Array.from(atob(b), x => x.charCodeAt(0))], { type: 'video/mp4' });
  window.__fakeBlobs.set('files/remote-clip.mp4', toBlob(c)); window.__fakeBlobs.set('files/remote-pip.mp4', toBlob(p));
  const cur = window.__fakeDump().projects.P1;
  await firebase.firestore().collection('projects').doc('P1').update({ files: { ...cur.files, video: { name: 'clip.mp4', path: 'files/remote-clip.mp4', size: 1, type: 'video/mp4' }, sources: { 'pip.mp4': { name: 'pip.mp4', path: 'files/remote-pip.mp4', size: 1, type: 'video/mp4' } } }, editedByUid: 'u9', editedByName: '다른 컴퓨터', editSession: 'other', updatedAt: Date.now() });
}, { c: b64(A + '/clip.mp4'), p: b64(A + '/pip.mp4') });
await page.waitForTimeout(6000);
s = await look(3.5); console.log('B after remote change', JSON.stringify(s), '|', await page.textContent('.status'));
ok('B: this window picks up the remote replacement (red + green)', s.main === 'red' && s.pip === 'green');
// 이 창에서 무언가 저장해도 파일 목록이 예전 것으로 되돌아가지 않음
await page.keyboard.press('Control+s'); await page.waitForTimeout(1500);
d = await doc(); console.log('B files', JSON.stringify({ v: d.files.video?.path, s: d.files.sources?.['pip.mp4']?.path }));
ok('B: file list not reverted', d.files.video?.path === 'files/remote-clip.mp4' && d.files.sources?.['pip.mp4']?.path === 'files/remote-pip.mp4');
ok('B: timeline kept', d.project.overlays?.length === 1 && d.project.clips?.length >= 1);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
