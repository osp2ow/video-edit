// 큰 영상(아이폰 4K mov 등)에서 소리만 빠르게 꺼내기.
// 예전에는 영상 파일 전체(수 GB)를 메모리로 읽어서 decodeAudioData에 넣었는데,
// 실제로 필요한 건 소리 데이터뿐(보통 파일의 1% 안팎)이라 느리고 메모리도 많이 먹었음.
// 여기서는 moov(목차)만 읽어서 소리 트랙의 조각 위치를 알아낸 뒤,
// 그 조각들만 이어 붙인 작은 m4a(소리만 있는 mp4)를 만들어 돌려준다.
// 소리 트랙 상자(trak)는 편집 목록(elst)까지 그대로 복사하고 조각 위치(stco/co64)만 고치므로
// 디코딩 결과는 원본 파일을 통째로 넣었을 때와 같다.
// 처리할 수 없는 구조(조각난 mp4, 특이한 PCM 등)면 원본 파일을 그대로 돌려줌 (예전 방식).

interface Box { type: string; start: number; size: number; hdr: number }

function readBoxes(dv: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; }
    else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) break;
    out.push({ type, start: p, size, hdr });
    p += size;
  }
  return out;
}
const kids = (dv: DataView, b: Box) => readBoxes(dv, b.start + b.hdr, b.start + b.size);
const child = (dv: DataView, b: Box | undefined, type: string) => b ? kids(dv, b).find(x => x.type === type) : undefined;

/** 소리 트랙이 아예 없을 때 */
export class NoAudioError extends Error { constructor() { super('no-audio'); } }

/** 파일 맨 바깥 상자들 (머리만 읽음) */
async function topBoxes(file: Blob): Promise<Box[] | null> {
  const out: Box[] = [];
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let size = h.getUint32(0), hdr = 8;
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) { size = Number(h.getBigUint64(8)); hdr = 16; }
    else if (size === 0) size = file.size - pos;
    if (size < hdr) return null;
    out.push({ type, start: pos, size, hdr });
    pos += size;
    if (out.length > 1000) return null;
  }
  return out;
}

const isMp4Like = (f: File) => /\.(mov|mp4|m4v|m4a|3gp)$/i.test(f.name) || /mp4|quicktime|3gpp/.test(f.type);

/** 소리만 담은 작은 m4a (못 만들면 null) */
export async function extractAudio(file: File): Promise<Blob | null> {
  if (!isMp4Like(file)) return null;
  const top = await topBoxes(file);
  if (!top) return null;
  if (top.some(b => b.type === 'moof')) return null; // 조각난 mp4는 예전 방식
  const mv = top.find(b => b.type === 'moov');
  if (!mv || mv.size > 64 * 1024 * 1024) return null;
  const ftypBox = top.find(b => b.type === 'ftyp');
  const moov = new Uint8Array(await file.slice(mv.start, mv.start + mv.size).arrayBuffer());
  const dv = new DataView(moov.buffer);
  const root: Box = { type: 'moov', start: 0, size: moov.length, hdr: mv.hdr };
  const mvhd = child(dv, root, 'mvhd');
  if (!mvhd) return null;

  // 첫 번째 소리 트랙
  let trak: Box | undefined;
  for (const t of kids(dv, root).filter(b => b.type === 'trak')) {
    const hdlr = child(dv, child(dv, t, 'mdia'), 'hdlr');
    if (!hdlr) continue;
    const h = hdlr.start + hdlr.hdr + 8;
    if (String.fromCharCode(dv.getUint8(h), dv.getUint8(h + 1), dv.getUint8(h + 2), dv.getUint8(h + 3)) === 'soun') { trak = t; break; }
  }
  if (!trak) throw new NoAudioError();
  const stbl = child(dv, child(dv, child(dv, trak, 'mdia'), 'minf'), 'stbl');
  const stsz = child(dv, stbl, 'stsz'), stsc = child(dv, stbl, 'stsc');
  const stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64');
  const off = stco || co64;
  if (!stsz || !stsc || !off) return null;

  // 샘플 크기: 하나하나 적힌 경우만 (고정 크기 PCM은 해석이 까다로워서 예전 방식)
  const zb = stsz.start + stsz.hdr + 4;
  if (dv.getUint32(zb) !== 0) return null;
  const nSamples = dv.getUint32(zb + 4);
  const sampleSize = (i: number) => dv.getUint32(zb + 8 + i * 4);

  // 조각(chunk) 위치
  const ob = off.start + off.hdr + 4, nChunks = dv.getUint32(ob);
  const chunkOff = (i: number) => co64 ? Number(dv.getBigUint64(ob + 4 + i * 8)) : dv.getUint32(ob + 4 + i * 4);

  // 조각마다 샘플 몇 개인지 (stsc)
  const cb = stsc.start + stsc.hdr + 4, nRuns = dv.getUint32(cb);
  const runs: { first: number; per: number }[] = [];
  for (let i = 0; i < nRuns; i++) runs.push({ first: dv.getUint32(cb + 4 + i * 12), per: dv.getUint32(cb + 8 + i * 12) });
  if (!runs.length) return null;

  const chunks: { off: number; size: number }[] = [];
  let s = 0;
  for (let c = 0, r = 0; c < nChunks; c++) {
    while (r + 1 < runs.length && runs[r + 1].first <= c + 1) r++;
    let size = 0;
    for (let k = 0; k < runs[r].per && s < nSamples; k++, s++) size += sampleSize(s);
    chunks.push({ off: chunkOff(c), size });
  }
  if (s !== nSamples) return null;
  if (chunks.some(c => c.off + c.size > file.size)) return null;
  const total = chunks.reduce((a, c) => a + c.size, 0);
  if (!total || total > 0xffffff00) return null;

  // 새 moov = 머리 + mvhd + 소리 trak (조각 위치만 고친 복사본)
  const mvhdBytes = moov.subarray(mvhd.start, mvhd.start + mvhd.size);
  const trakBytes = moov.slice(trak.start, trak.start + trak.size);
  const moovLen = 8 + mvhdBytes.length + trakBytes.length;
  const ftyp = ftypBox ? new Uint8Array(await file.slice(ftypBox.start, ftypBox.start + ftypBox.size).arrayBuffer()) : new Uint8Array(0);
  const base = ftyp.length + moovLen + 8;
  const tv = new DataView(trakBytes.buffer), tob = ob - trak.start;
  for (let c = 0, acc = base; c < chunks.length; c++) {
    if (co64) tv.setBigUint64(tob + 4 + c * 8, BigInt(acc)); else tv.setUint32(tob + 4 + c * 4, acc);
    acc += chunks[c].size;
  }
  const head = new Uint8Array(8 + mvhdBytes.length);
  new DataView(head.buffer).setUint32(0, moovLen);
  head.set([0x6d, 0x6f, 0x6f, 0x76], 4); // 'moov'
  head.set(mvhdBytes, 8);
  const mdat = new Uint8Array(8);
  new DataView(mdat.buffer).setUint32(0, total + 8);
  mdat.set([0x6d, 0x64, 0x61, 0x74], 4); // 'mdat'

  // 붙어 있는 조각은 한 덩어리로 (Blob 조각은 실제로 읽을 때만 디스크에서 가져옴)
  const parts: Blob[] = [];
  for (let i = 0; i < chunks.length;) {
    const a = chunks[i].off; let b = a + chunks[i].size; i++;
    while (i < chunks.length && chunks[i].off === b) { b += chunks[i].size; i++; }
    parts.push(file.slice(a, b));
  }
  return new Blob([ftyp, head, trakBytes, mdat, ...parts], { type: 'audio/mp4' });
}

const cache = new WeakMap<File, Promise<Blob | null>>();
/** 소리만 담은 작은 파일 (같은 파일은 한 번만 만듦). 못 만들면 null, 소리 트랙이 없으면 NoAudioError */
export function audioOnly(file: File): Promise<Blob | null> {
  let p = cache.get(file);
  if (!p) { p = extractAudio(file).catch(e => { if (e instanceof NoAudioError) throw e; console.warn('[소리 꺼내기] 실패, 파일 전체로 읽음', e); return null; }); cache.set(file, p); }
  return p;
}

/**
 * 영상 파일의 소리를 decodeAudioData에 넣을 바이트로 — 소리만 골라 읽고, 안 되면 파일 전체.
 * decode: 바이트를 받아 디코딩하는 함수. 소리만 꺼낸 파일이 디코딩에 실패하면 전체 파일로 한 번 더 시도.
 */
export async function decodeVideoAudio<T>(file: File, decode: (ab: ArrayBuffer) => Promise<T>): Promise<T> {
  const small = await audioOnly(file);
  if (small) {
    try { return await decode(await small.arrayBuffer()); }
    catch (e) { console.warn('[소리 꺼내기] 디코딩 실패, 파일 전체로 읽음', e); }
  }
  return decode(await file.arrayBuffer());
}
