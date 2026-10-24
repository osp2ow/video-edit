// 추출용 장면 공급기: 영상 파일을 WebCodecs로 직접 풀어서 원하는 시간의 장면을 정확히 꺼냄
// (영상을 실시간으로 재생하면서 받으면, 컴퓨터가 느리거나 탭이 가려질 때 장면을 놓치거나 영상이 멈춘 채로 저장됨)
// mp4 · mov 만 지원. 못 쓰는 경우(webm, 지원 안 되는 코덱)는 null → 예전 방식(재생하며 받기)으로

const MP4BOX_URL = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js';
let mp4boxLoad: Promise<void> | null = null;
function loadMp4Box() {
  if ((window as any).MP4Box) return Promise.resolve();
  if (!mp4boxLoad) mp4boxLoad = new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = MP4BOX_URL; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => { mp4boxLoad = null; rej(new Error('mp4box')); };
    document.head.appendChild(s);
  });
  return mp4boxLoad;
}

/** 캔버스지만 <video>처럼 videoWidth/videoHeight를 가진 그림 (그리기 코드가 그대로 쓰게) */
export type FrameImage = HTMLCanvasElement & { videoWidth: number; videoHeight: number };

export interface FrameSource {
  width: number; height: number; duration: number;
  /** 영상 시간 t(초)에 화면에 보이는 장면 */
  frameAt(t: number): Promise<FrameImage | null>;
  close(): void;
}

interface Sample { cts: number; dts: number; size: number; offset: number; is_sync: boolean; duration: number; timescale: number }

/** 맨 바깥 상자들(ftyp · moov)만 읽어서 mp4box에 넣기 — 큰 영상 데이터(mdat)는 건너뜀
 *  (mp4box는 상자를 차례대로 읽으므로 ftyp+moov를 이어 붙여서 넣음. 샘플 위치(stco)는 원래 파일 기준이라 그대로 씀) */
async function parseMovie(blob: Blob): Promise<any> {
  const MP4Box = (window as any).MP4Box;
  const parts: ArrayBuffer[] = [];
  let pos = 0, gotMoov = false;
  while (pos + 8 <= blob.size && !gotMoov) {
    const head = new DataView(await blob.slice(pos, pos + 16).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (size === 1) size = Number(head.getBigUint64(8));
    else if (size === 0) size = blob.size - pos;
    if (size < 8) break;
    if (type === 'ftyp' || type === 'moov') parts.push(await blob.slice(pos, pos + size).arrayBuffer());
    if (type === 'moov') gotMoov = true;
    pos += size;
  }
  if (!gotMoov) throw new Error('moov 없음');
  const total = parts.reduce((a, b) => a + b.byteLength, 0);
  const all: any = new Uint8Array(total);
  let o = 0; for (const p of parts) { all.set(new Uint8Array(p), o); o += p.byteLength; }
  const buf: any = all.buffer; buf.fileStart = 0;
  const file = MP4Box.createFile();
  let info: any = null, err: any = null;
  file.onReady = (i: any) => { info = i; };
  file.onError = (e: any) => { err = e; };
  file.appendBuffer(buf);
  try { file.flush(); } catch { /* 없음 */ }
  if (err || !info) throw new Error('mp4 읽기 실패');
  return { file, info };
}

function descriptionOf(trak: any): Uint8Array | undefined {
  const DataStream = (window as any).DataStream;
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(s);
      return new Uint8Array(s.buffer, 8);   // 상자 머리(8바이트) 빼고
    }
  }
  return undefined;
}

export async function openFrameSource(blob: Blob): Promise<FrameSource | null> {
  if (typeof (window as any).VideoDecoder === 'undefined') return null;
  try { await loadMp4Box(); } catch { return null; }
  let parsed: any;
  try { parsed = await parseMovie(blob); } catch { return null; }
  const vt = parsed.info.videoTracks?.[0];
  if (!vt) return null;
  const trak = parsed.file.getTrackById(vt.id);
  const samples: Sample[] = trak.samples || [];
  if (!samples.length) return null;
  const ts = samples[0].timescale;
  // 편집 목록(elst): <video>의 0초 = 이 미디어 시간
  let mediaStart = 0, delay = 0;
  const entries = trak.edts?.elst?.entries || [];
  for (const en of entries) {
    if (en.media_time === -1) delay += en.segment_duration / (parsed.info.timescale || 1);
    else { mediaStart = en.media_time / ts; break; }
  }
  // 회전 (휴대폰 영상)
  const m = trak.tkhd?.matrix as number[] | undefined;
  let rot = 0;
  if (m) { const a = m[0] / 65536, b = m[1] / 65536; rot = ((Math.round(Math.atan2(b, a) * 180 / Math.PI / 90) * 90) % 360 + 360) % 360; }
  const cw = vt.video?.width || vt.track_width, ch = vt.video?.height || vt.track_height;
  const config: any = { codec: vt.codec, codedWidth: cw, codedHeight: ch, description: descriptionOf(trak) };
  try {
    const sup = await (window as any).VideoDecoder.isConfigSupported(config);
    if (!sup.supported) return null;
  } catch { return null; }

  const W = rot % 180 ? ch : cw, H = rot % 180 ? cw : ch;
  const canvas = document.createElement('canvas') as FrameImage;
  canvas.width = W; canvas.height = H; canvas.videoWidth = W; canvas.videoHeight = H;
  const cctx = canvas.getContext('2d')!;
  const order = samples.map((s, i) => ({ i, cts: s.cts })).sort((a, b) => a.cts - b.cts);   // 화면 순서
  const toUs = (v: number) => Math.round(v / ts * 1e6);

  let frames: any[] = [];          // 풀린 장면들 (화면 순서)
  let next = 0, flushed = false, decErr: any = null;
  let wake: (() => void) | null = null;
  const poke = () => { const w = wake; wake = null; w?.(); };
  const make = () => new (window as any).VideoDecoder({
    output: (f: any) => { frames.push(f); frames.sort((a, b) => a.timestamp - b.timestamp); poke(); },
    error: (e: any) => { decErr = e; poke(); },
  });
  let dec = make();
  dec.configure(config);
  let shownTs = -1;                // 지금 캔버스에 그려진 장면

  const reset = (i: number) => {
    try { dec.close(); } catch { /* 이미 닫힘 */ }
    for (const f of frames) f.close();
    frames = []; flushed = false; decErr = null;
    dec = make(); dec.configure(config);
    next = i;
  };
  /** 화면 시간 tUs 이전(또는 같은) 마지막 키프레임부터 */
  const keyBefore = (tUs: number) => {
    let k = 0;
    for (let i = 0; i < samples.length; i++) if (samples[i].is_sync && toUs(samples[i].cts) <= tUs) k = i;
    return k;
  };
  const waitOutput = () => new Promise<void>(r => { wake = r; setTimeout(r, 200); });
  const feedUntil = async (tUs: number) => {
    // tUs보다 뒤 장면이 하나 나오면(=tUs까지는 다 나옴) 그만
    for (let guard = 0; guard < 100000; guard++) {
      if (decErr) throw decErr;
      // tUs 이전 장면은 가장 최근 것 하나만 남기고 정리 (디코더가 다음 장면을 낼 자리를 비움)
      let lastBefore = -1;
      for (let i = 0; i < frames.length; i++) if (frames[i].timestamp <= tUs + 500) lastBefore = i;
      if (lastBefore > 0) { for (let i = 0; i < lastBefore; i++) frames[i].close(); frames = frames.slice(lastBefore); }
      if (frames.length && frames[frames.length - 1].timestamp > tUs) return;
      if (next < samples.length && dec.decodeQueueSize < 6 && frames.length < 8) {
        const s = samples[next++];
        const data = new Uint8Array(await blob.slice(s.offset, s.offset + s.size).arrayBuffer());
        dec.decode(new (window as any).EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: toUs(s.cts), duration: toUs(s.duration), data }));
        continue;
      }
      if (next >= samples.length) {
        if (!flushed) { flushed = true; await dec.flush(); }
        return;
      }
      await waitOutput();
    }
  };

  const draw = (f: any) => {
    if (f.timestamp === shownTs) return;
    cctx.save();
    if (rot) { cctx.translate(W / 2, H / 2); cctx.rotate(rot * Math.PI / 180); cctx.drawImage(f, -cw / 2, -ch / 2, cw, ch); }
    else cctx.drawImage(f, 0, 0, W, H);
    cctx.restore();
    shownTs = f.timestamp;
  };

  return {
    width: W, height: H,
    duration: (order[order.length - 1].cts - order[0].cts) / ts,
    async frameAt(t: number) {
      const tUs = Math.round((t - delay + mediaStart) * 1e6);
      if (t < delay) return null;
      const oldest = frames.length ? frames[0].timestamp : (shownTs >= 0 ? shownTs : -Infinity);
      const fed = next > 0 ? toUs(samples[Math.min(next, samples.length) - 1].cts) : -Infinity;
      // 뒤로 가거나 한참 앞으로 건너뛰면 가까운 키프레임부터 다시
      if (tUs < oldest - 1000 || (next === 0 && !frames.length) || tUs > fed + 2_000_000) {
        const k = keyBefore(tUs);
        if (!(next > 0 && k < next && tUs >= oldest - 1000)) reset(k);
      }
      await feedUntil(tUs);
      let best: any = null;
      for (const f of frames) if (f.timestamp <= tUs + 500) best = f;
      if (!best) best = frames[0];
      if (!best) return shownTs >= 0 ? canvas : null;
      draw(best);
      // 지난 장면은 정리 (디코더가 장면을 더 내놓을 수 있게)
      const keep: any[] = [];
      for (const f of frames) { if (f.timestamp < best.timestamp) f.close(); else keep.push(f); }
      frames = keep;
      return canvas;
    },
    close() { try { dec.close(); } catch { /* 이미 닫힘 */ } for (const f of frames) f.close(); frames = []; },
  };
}
