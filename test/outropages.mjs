// 엔딩 카드 문구 여러 개: 추가 · 시간에 따라 바뀜 · 타임라인 경계선 끌기 · 미리보기 더블클릭
// 사용법: node test/outropages.mjs 기준영상 [스크린샷 폴더]
import { chromium } from 'playwright-core';
const NM = new URL('../node_modules', import.meta.url).pathname;
const map = { 'react.production.min.js': NM + '/react/umd/react.production.min.js', 'react-dom.production.min.js': NM + '/react-dom/umd/react-dom.production.min.js', 'pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); const f = Object.keys(map).find(k => u.endsWith('/' + k)); if (f) return r.fulfill({ path: map[f], contentType: 'application/javascript' }); if (u.includes('fonts.g') || u.includes('jsdelivr')) return r.abort(); return r.continue(); });
await page.goto('file://' + new URL('../dist/index.html', import.meta.url).pathname);
await page.setInputFiles('#f-video', process.argv[2]);
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('분석'), null, { timeout: 60000 });
await page.waitForTimeout(1200);
const dir = process.argv[3];
const ok = (name, c) => console.log(c ? 'ok  ' : 'FAIL', name);
const P = () => page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('pve.proj:')); return JSON.parse(localStorage.getItem(k)).fx.outro; });
await page.click('button[role=tab]:text-is("효과")');
await page.click('label[for=outro-on]');
await page.fill('#outro-title', '연주 들어주셔서\n감사합니다');
await page.fill('#outro-sub', '@juniper_music');
await page.click('text=+ 문구 추가');
await page.waitForTimeout(150);
let o = await P();
ok('page added', o.pages?.length === 1);
console.log('outro', JSON.stringify({ dur: o.dur, pages: o.pages }));
const id1 = o.pages[0].id;
await page.fill(`#outro-page-${id1}-title`, '레슨 문의는\nDM 주세요');
await page.click('text=+ 문구 추가');
await page.waitForTimeout(150);
o = await P();
const id2 = o.pages.find(p => p.id !== id1).id;
await page.fill(`#outro-page-${id2}-title`, '주니퍼 실용음악학원');
o = await P();
console.log('outro', JSON.stringify({ dur: o.dur, pages: o.pages.map(p => [p.title, p.at]) }));
ok('two pages, inside card', o.pages.length === 2 && o.pages.every(p => p.at > 0 && p.at < o.dur));
// 타임라인 위치 계산 (전체 보기)
const tl = await page.locator('.tl-canvas canvas').boundingBox();
const D = await page.evaluate(() => document.querySelector('video').duration);
const end = D, st = end - o.dur;
const pps = (tl.width - 2) / (end * 1.02), X = t => tl.x + (t + end * 0.01) * pps;
const seek = async t => { await page.mouse.click(X(t), tl.y + 21); await page.waitForTimeout(300); console.log('   seek', t.toFixed(2), '→', (await page.textContent('.now-t'))); };
const prevBox = await page.locator('canvas.stage').boundingBox();
const shot = async n => dir && page.screenshot({ path: `${dir}/${n}.png`, clip: prevBox });
const sorted = [...o.pages].sort((a, b) => a.at - b.at);
await seek(st + 0.8); await shot('1-first');
await seek(st + sorted[0].at + 0.8); await shot('2-second');
await seek(st + sorted[1].at + 0.8); await shot('3-third');
await seek(st + sorted[0].at + 0.15); await shot('4-crossfade');
// 경계선 끌기: 첫 경계선을 0.5초 오른쪽으로
const capY = await page.evaluate(() => null);
// 자막 줄의 y: 라벨 '자막'이 있는 줄 — 타임라인에서 자막 줄을 찾기 어려워 여러 y를 시도
const at0 = sorted[0].at;
let moved = false;
for (let dy = 20; dy < 140 && !moved; dy += 4) {
  const x0 = X(st + at0), y0 = tl.y + dy;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 0.5 * pps, y0, { steps: 5 }); await page.mouse.up();
  const n = await P(); const p1 = n.pages.find(p => p.id === sorted[0].id);
  if (Math.abs(p1.at - at0) > 0.2) { moved = true; console.log('divider dragged', at0, '->', p1.at, 'at dy', dy); }
}
ok('divider drag moves page time', moved);
if (dir) await page.screenshot({ path: `${dir}/5-timeline.png`, clip: { x: tl.x + (tl.width * 0.6), y: tl.y, width: tl.width * 0.4, height: 160 } });
// 미리보기 더블클릭 → 해당 문구 입력칸으로
await seek(st + (await P()).pages.sort((a, b) => a.at - b.at)[1].at + 0.8);
await page.mouse.dblclick(prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2);
await page.waitForTimeout(250);
const focused = await page.evaluate(() => document.activeElement?.id);
ok('dblclick focuses that page (' + focused + ')', focused === `outro-page-${sorted[1].id}-title`);
// 빼기
await page.click(`button[aria-label="3번째 문구 빼기"]`);
o = await P(); ok('remove page', o.pages.length === 1);
console.log(logs.join('\n') || 'no page errors');
await browser.close();
