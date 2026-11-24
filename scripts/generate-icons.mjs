import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  bytes.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function icon(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = 1 + size * 4;
  const pixels = Buffer.alloc(size * stride);
  const inside = (x, y, left, top, right, bottom) => x >= left && x < right && y >= top && y < bottom;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = (col + 0.5) / size;
      const y = (row + 0.5) / size;
      const dx = Math.max(Math.abs(x - 0.5) - 0.31, 0);
      const dy = Math.max(Math.abs(y - 0.5) - 0.31, 0);
      if (Math.hypot(dx, dy) > 0.16) continue;
      const index = row * stride + 1 + col * 4;
      const calendar = inside(x, y, 0.23, 0.31, 0.77, 0.76)
        || inside(x, y, 0.33, 0.22, 0.40, 0.4)
        || inside(x, y, 0.60, 0.22, 0.67, 0.4);
      const mark = inside(x, y, 0.45, 0.44, 0.55, 0.6) || inside(x, y, 0.45, 0.64, 0.55, 0.71);
      pixels.set(mark ? [239, 68, 68, 255] : calendar ? [255, 255, 255, 255] : [31, 85, 70, 255], index);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [16, 48, 128]) {
  await writeFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url), icon(size));
}
