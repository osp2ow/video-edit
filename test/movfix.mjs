// src/movfix.ts
function readBoxes(buf2, from, to) {
  const out2 = [];
  let p = from;
  while (p + 8 <= to) {
    let size = buf2.getUint32(p);
    const type = String.fromCharCode(buf2.getUint8(p + 4), buf2.getUint8(p + 5), buf2.getUint8(p + 6), buf2.getUint8(p + 7));
    let hdr = 8;
    if (size === 1) {
      size = Number(buf2.getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) break;
    out2.push({ type, start: p, size, hdr });
    p += size;
  }
  return out2;
}
var child = (buf2, b, type) => readBoxes(buf2, b.start + b.hdr, b.start + b.size).find((x) => x.type === type);
async function findMoov(file) {
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) size = Number(h.getBigUint64(8));
    else if (size === 0) size = file.size - pos;
    if (size < 8) return null;
    if (type === "moov") return { start: pos, size };
    pos += size;
  }
  return null;
}
async function fixEditList(file) {
  try {
    if (!/\.(mov|mp4|m4v)$/i.test(file.name) && !/mp4|quicktime/.test(file.type)) return file;
    const mv = await findMoov(file);
    if (!mv || mv.size > 64 * 1024 * 1024) return file;
    const bytes = new Uint8Array(await file.slice(mv.start, mv.start + mv.size).arrayBuffer());
    const dv = new DataView(bytes.buffer);
    const moov = { type: "moov", start: 0, size: bytes.length, hdr: dv.getUint32(0) === 1 ? 16 : 8 };
    const mvhd = child(dv, moov, "mvhd");
    if (!mvhd) return file;
    const mvVer = dv.getUint8(mvhd.start + mvhd.hdr);
    const movieTs = dv.getUint32(mvhd.start + mvhd.hdr + (mvVer === 1 ? 20 : 12));
    let changed = false;
    for (const trak of readBoxes(dv, moov.start + moov.hdr, moov.size).filter((b) => b.type === "trak")) {
      const mdia = child(dv, trak, "mdia"), edts = child(dv, trak, "edts");
      if (!mdia || !edts) continue;
      const hdlr = child(dv, mdia, "hdlr"), mdhd = child(dv, mdia, "mdhd"), elst = child(dv, edts, "elst");
      if (!hdlr || !mdhd || !elst) continue;
      const handler = String.fromCharCode(...[0, 1, 2, 3].map((i) => dv.getUint8(hdlr.start + hdlr.hdr + 8 + i)));
      if (handler !== "vide") continue;
      const mdVer = dv.getUint8(mdhd.start + mdhd.hdr);
      const mediaTs = dv.getUint32(mdhd.start + mdhd.hdr + (mdVer === 1 ? 20 : 12));
      const e0 = elst.start + elst.hdr, ver = dv.getUint8(e0), n = dv.getUint32(e0 + 4);
      const esz = ver === 1 ? 20 : 12;
      if (n < 2 || 8 + n * esz > elst.size - elst.hdr) continue;
      const ents = [];
      for (let i = 0; i < n; i++) {
        const o = e0 + 8 + i * esz;
        const dur = ver === 1 ? Number(dv.getBigUint64(o)) : dv.getUint32(o);
        const mt = ver === 1 ? Number(dv.getBigInt64(o + 8)) : dv.getInt32(o + 4);
        const rate = dv.getInt16(o + (ver === 1 ? 16 : 8));
        ents.push({ dur, mt, rate });
      }
      let lead = 0;
      while (lead < ents.length && ents[lead].mt === -1) lead++;
      const rest = ents.slice(lead);
      if (rest.length < 2 || rest.some((e) => e.rate !== 1)) continue;
      const frameTicks = movieTs / 30;
      let ok = true, expect = rest[0].mt, total = 0;
      for (const e of rest) {
        if (e.mt === -1) {
          if (e.dur > frameTicks) {
            ok = false;
            break;
          }
          continue;
        }
        total += e.dur;
        const tol = Math.max(2, mediaTs / 1e3);
        if (Math.abs(e.mt - expect) > tol) {
          ok = false;
          break;
        }
        expect = e.mt + e.dur * mediaTs / movieTs;
      }
      if (!ok) continue;
      const mdDur = mdVer === 1 ? Number(dv.getBigUint64(mdhd.start + mdhd.hdr + 24)) : dv.getUint32(mdhd.start + mdhd.hdr + 16);
      const maxDur = Math.floor((mdDur - rest[0].mt) * movieTs / mediaTs);
      if (maxDur > 0) total = Math.min(total, maxDur);
      if (lead === 0 && rest[0].mt <= mediaTs * 0.05) {
        bytes[edts.start + 4] = 102;
        bytes[edts.start + 5] = 114;
        bytes[edts.start + 6] = 101;
        bytes[edts.start + 7] = 101;
        changed = true;
        continue;
      }
      const merged = [...ents.slice(0, lead), { dur: total, mt: rest[0].mt, rate: 1 }];
      dv.setUint32(e0 + 4, merged.length);
      merged.forEach((e, i) => {
        const o = e0 + 8 + i * esz;
        if (ver === 1) {
          dv.setBigUint64(o, BigInt(e.dur));
          dv.setBigInt64(o + 8, BigInt(e.mt));
          dv.setInt16(o + 16, 1);
          dv.setInt16(o + 18, 0);
        } else {
          dv.setUint32(o, e.dur);
          dv.setInt32(o + 4, e.mt);
          dv.setInt16(o + 8, 1);
          dv.setInt16(o + 10, 0);
        }
      });
      for (let p = e0 + 8 + merged.length * esz; p < elst.start + elst.size; p++) dv.setUint8(p, 0);
      changed = true;
    }
    if (!changed) return file;
    console.info("[\uC601\uC0C1] \uC5EC\uB7EC \uC870\uAC01\uC73C\uB85C \uB098\uB25C \uD3B8\uC9D1 \uBAA9\uB85D\uC744 \uD558\uB098\uB85C \uD569\uCCD0\uC11C \uBD88\uB7EC\uC634:", file.name);
    return new File([file.slice(0, mv.start), bytes, file.slice(mv.start + mv.size)], file.name, { type: file.type || "video/quicktime", lastModified: file.lastModified });
  } catch (e) {
    console.warn("[\uC601\uC0C1] \uD3B8\uC9D1 \uBAA9\uB85D \uD655\uC778 \uC2E4\uD328 \u2014 \uC6D0\uBCF8 \uADF8\uB300\uB85C \uC0AC\uC6A9", e);
    return file;
  }
}

// test/movfix_entry.ts
import fs from "fs";
var [src, dst] = process.argv.slice(2);
var buf = fs.readFileSync(src);
var f = new File([buf], src.split("/").pop(), { type: "video/quicktime" });
var out = await fixEditList(f);
console.log("changed", out !== f);
fs.writeFileSync(dst, Buffer.from(await out.arrayBuffer()));
