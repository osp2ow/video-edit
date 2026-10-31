import { ROOTS, QUALITIES, voicingsOf, chordName } from '../../src/chords';
import { paintChord, chordGeom } from '../../src/render';
const fmt = (f: number[]) => f.map(x => x < 0 ? 'x' : String(x)).join(' ');
function tile(name: string, v: any, i: number) {
  const w = 190, h = 112, el = document.createElement('figure');
  const c = document.createElement('canvas'); const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = chordGeom(w, h, { x: 0.5, y: 0.5, size: 1 }, v, name);
  paintChord(ctx, w, h, { x: 0.5, y: 0.5, size: Math.min(w * 0.9 / g.w, h * 0.84 / g.h) }, name, v);
  const cap = document.createElement('figcaption'); cap.textContent = `${i + 1}. ${fmt(v.frets)}`;
  el.append(c, cap); return el;
}
const root = document.getElementById('app')!;
const nav = document.getElementById('roots')!;
for (const r of ROOTS) {
  const a = document.createElement('a'); a.href = '#r-' + r.replace('#', 's'); a.textContent = r; nav.append(a);
  const sec = document.createElement('section'); sec.id = 'r-' + r.replace('#', 's');
  const h = document.createElement('h2'); h.textContent = r; sec.append(h);
  for (const q of QUALITIES) {
    const name = chordName(r, q.id), row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = name; row.append(lab);
    const tiles = document.createElement('div'); tiles.className = 'tiles';
    voicingsOf(r, q.id).forEach((v, i) => tiles.append(tile(name, v, i)));
    row.append(tiles); sec.append(row);
  }
  root.append(sec);
}
