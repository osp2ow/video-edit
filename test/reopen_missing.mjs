// 다른 컴퓨터에서 저장한 프로젝트를 열었는데 기준 영상이 클라우드에 없음 → 직접 넣어도(이름이 달라도) 같은 프로젝트에
// 추가 영상·녹음본·타임라인 설정이 그대로 남는지 (가짜 Firebase)
// 먼저: node build.mjs, 저장소 폴더에서 python3 -m http.server 8765 · CLOSE=1 이면 '필요한 파일' 안내를 닫고 넣기
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const [V, V2, R2, VLOCAL] = process.argv.slice(2);
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', 'firebase-app-compat.js': new URL('./fake-firebase.js', import.meta.url).pathname };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
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
await page.goto('http://localhost:8765/deploy/video-editor/index.html');
const b64 = p => readFileSync(p).toString('base64');
const name = p => p.split('/').pop();
// "다른 컴퓨터"가 저장한 프로젝트: 기준 영상은 클라우드에 없음, 추가 영상·추가 녹음본은 있음
await page.evaluate(({ v, v2, r2, nv, nv2, nr2 }) => {
  localStorage.clear();
  const clips = [{ id: 'm1', start: 0, srcIn: 0, srcOut: 8 }, { id: 's1', start: 8, srcIn: 0, srcOut: 6, src: nv2, fadeIn: 1 }];
  localStorage.setItem('__fakefs', JSON.stringify({ projects: { P1: {
    title: '가스펠 테스트', ownerUid: 'u0', ownerName: '다른 선생님', videoName: nv, recName: '', sheetName: '', angleNames: [], sourceNames: [nv2], recNames: [nr2],
    project: { bpm: 97, bpmTouched: true, beatsPerBar: 4, anchorTime: 0.5, anchorBar: 1, cuts: [], angleOffsets: {}, captions: [{ id: 'k1', start: 1, end: 3, text: '안녕' }], clips, recClips: [{ src: nr2, at: 2 }] },
    createdAt: 1, updatedAt: Date.now(),
    files: { sources: { [nv2]: { name: nv2, path: 'files/s1.mp4', size: 1, type: 'video/mp4' } }, recs: { [nr2]: { name: nr2, path: 'files/r2.mp3', size: 1, type: 'audio/mpeg' } } },
  } } }));
}, { v: '', v2: '', r2: '', nv: name(V), nv2: name(V2), nr2: name(R2) });
await page.reload();
// 가짜 저장소에 추가 파일 올려 두기 (메모리라 새로고침 뒤에 넣음)
await page.evaluate(({ v2, r2 }) => {
  const toBlob = (b, t) => new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: t });
  window.__fakeBlobs.set('files/s1.mp4', toBlob(v2, 'video/mp4'));
  window.__fakeBlobs.set('files/r2.mp3', toBlob(r2, 'audio/mpeg'));
  window.__FAKE_LOGIN = { uid: 'u1', email: 'osp2ow@gmail.com', displayName: '오세혁', emailVerified: true };
}, { v2: b64(V2), r2: b64(R2) });
await page.click('.btn.google'); await page.waitForSelector('.cloudbar');
await page.click('.cloudbar >> text=프로젝트');
await page.click('.pj-list li >> text=열기');
await page.waitForFunction(() => document.querySelectorAll('.src-item').length >= 2, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const ok = (n, c) => console.log(c ? 'ok  ' : 'FAIL', n);
const doc = () => page.evaluate(() => window.__fakeDump().projects);
ok('extra video + extra rec downloaded', await page.locator('.src-item', { hasText: '영상 2' }).count() === 1 && await page.locator('.src-item', { hasText: '녹음본 2' }).count() === 1);
ok('needed-files box asks for main video', /연주 영상/.test(await page.textContent('.needed').catch(() => '')));
if (process.env.CLOSE) { await page.click('.needed >> text=닫기'); await page.waitForTimeout(200); }   // '필요한 파일' 안내를 닫고 넣는 경우 (예전엔 여기서 새 프로젝트가 생겼음)
// 이 컴퓨터에 있는 기준 영상(이름이 다름)을 직접 넣기
await page.setInputFiles('#f-video', VLOCAL);
await page.waitForFunction(() => /분석 완료|읽지 못했/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });
await page.waitForTimeout(2500);
const d = await doc(), ids = Object.keys(d);
console.log('projects', ids.length, JSON.stringify(ids));
const p1 = d.P1;
ok('no new project created', ids.length === 1);
ok('still the same project', p1 && p1.editedByUid !== undefined ? true : !!p1);
ok('extra video still listed', await page.locator('.src-item', { hasText: '영상 2' }).count() === 1);
ok('extra rec still listed', await page.locator('.src-item', { hasText: '녹음본 2' }).count() === 1);
ok('timeline kept (clips · recClips · captions · bpm)', p1.project.clips?.length === 2 && p1.project.clips[1].fadeIn === 1 && p1.project.recClips?.length === 1 && p1.project.captions?.length === 1 && p1.project.bpm === 97);
ok('main video now uploaded to this project', !!p1.files?.video && p1.files.sources && p1.files.recs);
console.log('videoName', p1.videoName, '| files', JSON.stringify(Object.keys(p1.files || {})));
console.log(logs.join('\n') || 'no page errors');
await browser.close();
