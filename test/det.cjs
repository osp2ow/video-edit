var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/sheet.ts
function detectPage(gray, W2, H2) {
  const dark = (x, y) => gray[y * W2 + x] < 128;
  const ratio = new Float32Array(H2);
  let maxR = 0;
  for (let y = 0; y < H2; y++) {
    let c = 0;
    for (let x = 0; x < W2; x++) if (gray[y * W2 + x] < 128) c++;
    ratio[y] = c / W2;
    if (ratio[y] > maxR) maxR = ratio[y];
  }
  const thr = Math.max(0.3, maxR * 0.7);
  const rows = [];
  for (let y = 0; y < H2; y++) if (ratio[y] > thr) rows.push(y);
  const lines = [];
  let grp = [];
  for (const y of rows) {
    if (grp.length && y - grp[grp.length - 1] > 2) {
      lines.push(grp.reduce((a, b) => a + b) / grp.length);
      grp = [];
    }
    grp.push(y);
  }
  if (grp.length) lines.push(grp.reduce((a, b) => a + b) / grp.length);
  const staves = [];
  let i = 0;
  while (i + 4 < lines.length) {
    const g = lines.slice(i, i + 5);
    const d = g.slice(1).map((v, k) => v - g[k]);
    const mean = d.reduce((a, b) => a + b) / 4;
    if (Math.max(...d) - Math.min(...d) <= Math.max(2, 0.2 * mean) && mean < H2 / 40 && mean > 4) {
      const top = Math.round(g[0]), bot = Math.round(g[4]);
      let x0 = W2, x1 = 0;
      for (let x = 0; x < W2; x++) if (dark(x, top) || dark(x, top + 1) || dark(x, top - 1)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
      staves.push({ top, bot, sp: mean, x0, x1, bars: [] });
      i += 5;
    } else i++;
  }
  for (const s of staves) {
    const h = s.bot - s.top + 1;
    const aTop = Math.round(s.top - s.sp * 0.6), aBot = s.top - 3;
    const bTop = s.bot + 3, bBot = Math.round(s.bot + s.sp * 0.6);
    const cols = [];
    for (let x = s.x0; x <= s.x1; x++) {
      let c = 0;
      for (let y = s.top; y <= s.bot; y++) if (dark(x, y)) c++;
      if (c < 0.95 * h) continue;
      let ca = 0, cb = 0;
      for (let y = aTop; y <= aBot; y++) if (y >= 0 && dark(x, y)) ca++;
      for (let y = bTop; y <= bBot; y++) if (y < H2 && dark(x, y)) cb++;
      if (ca / Math.max(1, aBot - aTop + 1) < 0.2 && cb / Math.max(1, bBot - bTop + 1) < 0.2) cols.push(x);
    }
    const xs = [];
    let cg = [];
    for (const x of cols) {
      if (cg.length && x - cg[cg.length - 1] > 2) {
        xs.push(cg.reduce((a, b) => a + b) / cg.length);
        cg = [];
      }
      cg.push(x);
    }
    if (cg.length) xs.push(cg.reduce((a, b) => a + b) / cg.length);
    const merged = [];
    for (const x of xs) {
      if (merged.length && x - merged[merged.length - 1] < s.sp * 1.2) merged[merged.length - 1] = x;
      else merged.push(x);
    }
    while (merged.length && merged[0] - s.x0 < s.sp * 1.5) merged.shift();
    if (!merged.length || s.x1 - merged[merged.length - 1] > s.sp * 1.5) merged.push(s.x1);
    s.bars = merged;
  }
  return staves;
}

// test/det.ts
var import_fs = __toESM(require("fs"));
var W = 1650;
var buf = import_fs.default.readFileSync("test/page.gray");
var H = buf.length / W;
var st = detectPage(new Uint8Array(buf), W, H);
for (const s of st) console.log(s.top, s.bot, s.sp.toFixed(2), s.x0, s.x1, s.bars.map((x) => x.toFixed(0)).join(","));
