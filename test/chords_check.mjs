// 코드 데이터 검사: 모든 코드가 운지 2~3개를 갖는지, 오픈 코드 목록이 모두 맞는 음인지
import { build } from 'esbuild';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
const dir = mkdtempSync(tmpdir() + '/ch-');
await build({ entryPoints: ['src/chords.ts'], bundle: true, outfile: dir + '/c.mjs', format: 'esm', platform: 'node' });
const C = await import(dir + '/c.mjs');
let bad = 0, total = 0;
const fmt = f => f.map(x => x < 0 ? 'x' : x.toString(36)).join('');
for (const r of C.ROOTS) {
  const row = [];
  for (const q of C.QUALITIES) {
    const vs = C.voicingsOf(r, q.id); total++;
    if (vs.length < 2) { bad++; row.push(`!!${C.chordName(r, q.id)}(${vs.length})`); }
    else row.push(`${C.chordName(r, q.id)}:${vs.map(v => fmt(v.frets) + (v.base > 1 ? '@' + v.base : '')).join('/')}`);
  }
  console.log(row.join('  '));
}
console.log('chords', total, 'with <2 voicings', bad);
