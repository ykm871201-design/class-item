// 앱 아이콘 생성 (외부 이미지 없이 PNG 직접 작성): 초록 칠판 + 노란 시계
import fs from 'node:fs';
import zlib from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, sample) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0; raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function sample(x, y) {
  // 시계
  const cx = 0.7, cy = 0.7, R = 0.24;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= R) {
    if (d >= R - 0.035) return [180, 110, 0, 1];
    // 바늘
    const onSeg = (ax, ay, bx, by, w) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= w;
    };
    if (onSeg(cx, cy, cx, cy - 0.15, 0.022) || onSeg(cx, cy, cx + 0.1, cy + 0.02, 0.022)) return [40, 40, 40, 1];
    return [255, 214, 70, 1];
  }
  if (inRoundRect(x, y, 0.06, 0.1, 0.94, 0.86, 0.1)) {
    if (!inRoundRect(x, y, 0.1, 0.14, 0.9, 0.82, 0.07)) return [140, 90, 50, 1]; // 나무 테두리
    // 분필 글씨 줄
    const lines = [[0.18, 0.26, 0.7], [0.18, 0.4, 0.55], [0.18, 0.54, 0.4]];
    for (const [lx, ly, len] of lines) if (inRoundRect(x, y, lx, ly - 0.03, lx + len, ly + 0.03, 0.03)) return [245, 245, 240, 1];
    return [31, 77, 58, 1];
  }
  return [0, 0, 0, 0];
}
fs.mkdirSync('assets', { recursive: true });
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', png(512, sample));
fs.writeFileSync('assets/icon.png', png(256, sample));
fs.writeFileSync('assets/tray.png', png(32, sample));
fs.writeFileSync('assets/tray@2x.png', png(64, sample));
console.log('icons written');
