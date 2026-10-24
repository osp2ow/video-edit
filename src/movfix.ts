// 일부 카메라 앱(블랙매직 카메라 등)으로 찍은 mov/mp4는 영상 안에 "편집 목록(elst)"이 여러 조각으로 나뉘어 있음.
// 크롬은 이 이음매에서 영상 맨 앞 장면을 잠깐 보여주는 문제가 있어서 (예: 30초쯤 빈 배경이 번쩍),
// 조각들이 끊김 없이 이어진 경우에만 하나로 합쳐서 크롬이 그냥 이어서 재생하게 함.
// 파일 크기·영상 데이터는 그대로 두고 elst 상자 안의 숫자만 바꿈 (원본 파일은 건드리지 않음).

interface Box { type: string; start: number; size: number; hdr: number }

function readBoxes(buf: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = buf.getUint32(p);
    const type = String.fromCharCode(buf.getUint8(p + 4), buf.getUint8(p + 5), buf.getUint8(p + 6), buf.getUint8(p + 7));
    let hdr = 8;
    if (size === 1) { size = Number(buf.getBigUint64(p + 8)); hdr = 16; }
    else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) break;
    out.push({ type, start: p, size, hdr });
    p += size;
  }
  return out;
}
const child = (buf: DataView, b: Box, type: string) => readBoxes(buf, b.start + b.hdr, b.start + b.size).find(x => x.type === type);

/** 파일 맨 바깥 상자들에서 moov 위치 찾기 (영상 데이터는 읽지 않음) */
async function findMoov(file: Blob): Promise<{ start: number; size: number } | null> {
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) size = Number(h.getBigUint64(8));
    else if (size === 0) size = file.size - pos;
    if (size < 8) return null;
    if (type === 'moov') return { start: pos, size };
    pos += size;
  }
  return null;
}

/** 고칠 게 있으면 고친 파일(같은 이름), 없으면 원래 파일 그대로 */
export async function fixEditList(file: File): Promise<File> {
  try {
    if (!/\.(mov|mp4|m4v)$/i.test(file.name) && !/mp4|quicktime/.test(file.type)) return file;
    const mv = await findMoov(file);
    if (!mv || mv.size > 64 * 1024 * 1024) return file;
    const bytes = new Uint8Array(await file.slice(mv.start, mv.start + mv.size).arrayBuffer());
    const dv = new DataView(bytes.buffer);
    const moov: Box = { type: 'moov', start: 0, size: bytes.length, hdr: dv.getUint32(0) === 1 ? 16 : 8 };
    const mvhd = child(dv, moov, 'mvhd');
    if (!mvhd) return file;
    const mvVer = dv.getUint8(mvhd.start + mvhd.hdr);
    const movieTs = dv.getUint32(mvhd.start + mvhd.hdr + (mvVer === 1 ? 20 : 12));
    let changed = false;
    for (const trak of readBoxes(dv, moov.start + moov.hdr, moov.size).filter(b => b.type === 'trak')) {
      const mdia = child(dv, trak, 'mdia'), edts = child(dv, trak, 'edts');
      if (!mdia || !edts) continue;
      const hdlr = child(dv, mdia, 'hdlr'), mdhd = child(dv, mdia, 'mdhd'), elst = child(dv, edts, 'elst');
      if (!hdlr || !mdhd || !elst) continue;
      const handler = String.fromCharCode(...[0, 1, 2, 3].map(i => dv.getUint8(hdlr.start + hdlr.hdr + 8 + i)));
      if (handler !== 'vide') continue;
      const mdVer = dv.getUint8(mdhd.start + mdhd.hdr);
      const mediaTs = dv.getUint32(mdhd.start + mdhd.hdr + (mdVer === 1 ? 20 : 12));
      // 편집 목록 읽기
      const e0 = elst.start + elst.hdr, ver = dv.getUint8(e0), n = dv.getUint32(e0 + 4);
      const esz = ver === 1 ? 20 : 12;
      if (n < 2 || 8 + n * esz > elst.size - elst.hdr) continue;
      const ents: { dur: number; mt: number; rate: number }[] = [];
      for (let i = 0; i < n; i++) {
        const o = e0 + 8 + i * esz;
        const dur = ver === 1 ? Number(dv.getBigUint64(o)) : dv.getUint32(o);
        const mt = ver === 1 ? Number(dv.getBigInt64(o + 8)) : dv.getInt32(o + 4);
        const rate = dv.getInt16(o + (ver === 1 ? 16 : 8));
        ents.push({ dur, mt, rate });
      }
      // 앞쪽의 빈 조각(시작 지연)은 그대로 두고, 그 뒤 조각들이 영상 시간으로 끊김 없이 이어지는지 확인
      let lead = 0;
      while (lead < ents.length && ents[lead].mt === -1) lead++;
      const rest = ents.slice(lead);
      if (rest.length < 2 || rest.some(e => e.rate !== 1)) continue;
      const frameTicks = movieTs / 30;   // 빈 조각은 한 프레임(1/30초)보다 짧을 때만 무시
      let ok = true, expect = rest[0].mt, total = 0;
      for (const e of rest) {
        if (e.mt === -1) { if (e.dur > frameTicks) { ok = false; break; } continue; }   // 아주 짧은 빈 조각은 버림
        total += e.dur;
        const tol = Math.max(2, mediaTs / 1000);
        if (Math.abs(e.mt - expect) > tol) { ok = false; break; }
        expect = e.mt + e.dur * mediaTs / movieTs;
      }
      if (!ok) continue;
      // 영상 자체 길이보다 길게 잡으면 (크롬·ffmpeg가) 맨 앞 장면을 끝에 덧붙이므로 영상 길이를 넘지 않게
      const mdDur = mdVer === 1 ? Number(dv.getBigUint64(mdhd.start + mdhd.hdr + 24)) : dv.getUint32(mdhd.start + mdhd.hdr + 16);
      const maxDur = Math.floor((mdDur - rest[0].mt) * movieTs / mediaTs);
      if (maxDur > 0) total = Math.min(total, maxDur);
      // 영상 처음부터 시작하는 경우: 편집 목록을 아예 꺼버림 (edts → free 상자로 이름만 바꿈).
      // 크롬(ffmpeg)은 편집 목록이 있으면 이음매·끝에 맨 앞 장면 복사본을 끼워 넣는 경우가 있어서, 없애는 게 가장 깔끔함
      if (lead === 0 && rest[0].mt <= mediaTs * 0.05) {
        bytes[edts.start + 4] = 0x66; bytes[edts.start + 5] = 0x72; bytes[edts.start + 6] = 0x65; bytes[edts.start + 7] = 0x65;   // 'free'
        changed = true;
        continue;
      }
      // 하나로 합치기: [앞쪽 빈 조각들] + [처음 위치부터 전체 길이]
      const merged = [...ents.slice(0, lead), { dur: total, mt: rest[0].mt, rate: 1 }];
      dv.setUint32(e0 + 4, merged.length);
      merged.forEach((e, i) => {
        const o = e0 + 8 + i * esz;
        if (ver === 1) { dv.setBigUint64(o, BigInt(e.dur)); dv.setBigInt64(o + 8, BigInt(e.mt)); dv.setInt16(o + 16, 1); dv.setInt16(o + 18, 0); }
        else { dv.setUint32(o, e.dur); dv.setInt32(o + 4, e.mt); dv.setInt16(o + 8, 1); dv.setInt16(o + 10, 0); }
      });
      // 남는 자리는 0으로 (상자 크기는 그대로)
      for (let p = e0 + 8 + merged.length * esz; p < elst.start + elst.size; p++) dv.setUint8(p, 0);
      changed = true;
    }
    if (!changed) return file;
    console.info('[영상] 여러 조각으로 나뉜 편집 목록을 정리해서 불러옴:', file.name);
    return new File([file.slice(0, mv.start), bytes, file.slice(mv.start + mv.size)], file.name, { type: file.type || 'video/quicktime', lastModified: file.lastModified });
  } catch (e) {
    console.warn('[영상] 편집 목록 확인 실패 — 원본 그대로 사용', e);
    return file;
  }
}
