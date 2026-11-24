import { buildSafeRelativePath } from './naming';

export interface ZipEntryInput {
  path: string;
  data: Uint8Array | string;
  modifiedAt?: Date;
}

const encoder = new TextEncoder();
const max16 = 0xffff;
const max32 = 0xffffffff;
const utf8 = 0x0800;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc;
});

function crc32(bytes: Uint8Array): number {
  let crc = max32;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ max32) >>> 0;
}

function dosTimestamp(date?: Date): number {
  const year = date?.getUTCFullYear() ?? NaN;
  if (year < 1980 || !Number.isFinite(year)) return 0x00210000;
  if (year > 2107) return 0xff9fbf7d;
  return ((year - 1980) << 25) | ((date!.getUTCMonth() + 1) << 21) |
    (date!.getUTCDate() << 16) | (date!.getUTCHours() << 11) |
    (date!.getUTCMinutes() << 5) | (date!.getUTCSeconds() >> 1);
}

export function buildZipArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  if (entries.length >= max16) throw new RangeError('ZIP64 entry count unsupported');
  const paths = new Set<string>();
  const directories = new Set<string>();
  let localSize = 0;
  let centralSize = 0;
  const encoded = entries.map(entry => {
    const parts = entry.path.split('/');
    const path = buildSafeRelativePath(parts);
    const canonical = path.normalize('NFC').toLowerCase();
    if (paths.has(canonical) || directories.has(canonical)) throw new Error('Conflicting ZIP path');
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join('/').normalize('NFC').toLowerCase();
      if (paths.has(parent)) throw new Error('Conflicting ZIP path');
      directories.add(parent);
    }
    paths.add(canonical);
    const name = encoder.encode(path);
    if (name.length > max16) throw new RangeError('ZIP path too long');
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const offset = localSize;
    localSize += 30 + name.length + data.length;
    centralSize += 46 + name.length;
    return { name, data, offset, timestamp: dosTimestamp(entry.modifiedAt) };
  });

  const size = localSize + centralSize + 22;
  if (size >= max32) throw new RangeError('ZIP64 size unsupported');
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let central = localSize;
  for (const { name, data, offset, timestamp } of encoded) {
    const crc = crc32(data);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, utf8, true);
    view.setUint32(offset + 10, timestamp, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, data.length, true);
    view.setUint32(offset + 22, data.length, true);
    view.setUint16(offset + 26, name.length, true);
    bytes.set(name, offset + 30);
    bytes.set(data, offset + 30 + name.length);

    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, 20, true);
    view.setUint16(central + 6, 20, true);
    view.setUint16(central + 8, utf8, true);
    view.setUint32(central + 12, timestamp, true);
    view.setUint32(central + 16, crc, true);
    view.setUint32(central + 20, data.length, true);
    view.setUint32(central + 24, data.length, true);
    view.setUint16(central + 28, name.length, true);
    view.setUint32(central + 42, offset, true);
    bytes.set(name, central + 46);
    central += 46 + name.length;
  }

  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, entries.length, true);
  view.setUint16(central + 10, entries.length, true);
  view.setUint32(central + 12, centralSize, true);
  view.setUint32(central + 16, localSize, true);
  return bytes;
}

export function readZipEntryNames(zipBytes: Uint8Array): string[] {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const invalid = () => new Error('Invalid or unsupported ZIP directory');
  for (let end = view.byteLength - 22; end >= Math.max(0, view.byteLength - 22 - max16); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 ||
        end + 22 + view.getUint16(end + 20, true) !== view.byteLength) continue;
    let offset = view.getUint32(end + 16, true);
    const count = view.getUint16(end + 10, true);
    if (view.getUint32(end + 4, true) || count !== view.getUint16(end + 8, true) ||
        offset + view.getUint32(end + 12, true) !== end) continue;
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
      const nameEnd = offset + 46 + view.getUint16(offset + 28, true);
      const next = nameEnd + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      if (next > end) throw invalid();
      names.push(decoder.decode(zipBytes.subarray(offset + 46, nameEnd)));
      offset = next;
    }
    if (offset !== end) throw invalid();
    return names;
  }
  throw invalid();
}
