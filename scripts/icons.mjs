// Draws the Plumb app icons as PNGs with no dependencies (Node zlib only).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const segD = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

function draw(size, padFrac) {
  const SS = 3;
  const out = Buffer.alloc(size * size * 3);
  const m = padFrac;
  const u = 1 - 2 * m;
  const P = (x, y) => [m + (x / 1024) * u, m + (y / 1024) * u];
  const pts = [P(250, 250), P(774, 250), P(774, 560), P(560, 560), P(560, 774), P(250, 774)];
  const lw = 0.0275 * (padFrac ? 0.8 / 0.8 : 1);
  const rr = (1 - 2 * m) * 0.22;
  const dot = 0.052;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) / size, fy = (y + (sy + 0.5) / SS) / size;
          let c = [30, 34, 28];
          // rounded tile
          const qx = Math.max(Math.abs(fx - 0.5) - (0.5 - m - rr), 0), qy = Math.max(Math.abs(fy - 0.5) - (0.5 - m - rr), 0);
          if (Math.hypot(qx, qy) <= rr) {
            c = [255, 194, 14];
          }
          let dmin = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            dmin = Math.min(dmin, segD(fx, fy, a[0], a[1], b[0], b[1]));
          }
          if (dmin < lw) c = [34, 39, 31];
          for (const p of pts) {
            const d = Math.hypot(fx - p[0], fy - p[1]);
            if (d < dot) c = d < dot - 0.016 ? [238, 242, 230] : [34, 39, 31];
          }
          R += c[0]; G += c[1]; B += c[2];
        }
      const n = SS * SS, o = (y * size + x) * 3;
      out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n;
    }
  return png(size, size, out);
}

const dir = process.argv[2] || 'public';
mkdirSync(dir, { recursive: true });
for (const [name, size, pad] of [['icon-512.png', 512, 0], ['icon-192.png', 192, 0], ['apple-touch-icon.png', 180, 0], ['icon-maskable-512.png', 512, 0.1], ['favicon.png', 64, 0.04]]) {
  writeFileSync(`${dir}/${name}`, draw(size, pad));
}
console.log('icons written to', dir);
