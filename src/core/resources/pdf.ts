export interface SlideImageInput {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface JpegPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export type SlideImageConverter = (image: SlideImageInput) => Promise<{ bytes: Uint8Array; width?: number; height?: number }>;

const unsupported = () => Object.assign(new Error('Unsupported or invalid slide image'), { code: 'unsupported-format' });

function jpegInfo(bytes: Uint8Array): { width: number; height: number; colors: number; adobe: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) throw unsupported();
  let frame: { width: number; height: number; colors: number } | undefined;
  let adobe = false;
  let offset = 2;
  while (offset < bytes.length && bytes[offset++] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xda && frame && length >= 8) {
      for (let end = bytes.length - 1; end > offset + length; end--) {
        if (bytes[end] === 0xd9 && bytes[end - 1] === 0xff) return { ...frame, adobe };
      }
      break;
    }
    if (marker === 0xee && length >= 14) {
      adobe ||= bytes.subarray(offset + 2, offset + 7).every((byte, i) => byte === 'Adobe'.charCodeAt(i));
    }
    if ((marker === 0xc0 || marker === 0xc2) && length >= 8) {
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      const colors = bytes[offset + 7];
      if (bytes[offset + 2] !== 8 || !width || !height ||
          ![1, 3, 4].includes(colors) || length !== 8 + 3 * colors) break;
      frame = { width, height, colors };
    }
    offset += length;
  }
  throw unsupported();
}

const encoder = new TextEncoder();

export function buildPdfFromJpegPages(pages: readonly { bytes: Uint8Array; width?: number; height?: number }[]): Uint8Array {
  return assemblePdf(pages);
}

function assemblePdf(pages: readonly { bytes: Uint8Array }[], onOutputSize?: (length: number) => void): Uint8Array {
  if (pages.length === 0) throw unsupported();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let length = 0;

  function append(value: string | Uint8Array) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  }
  function object(id: number, dictionary: string, stream?: Uint8Array) {
    offsets[id] = length;
    append(id + ' 0 obj\n' + dictionary);
    if (stream) {
      append('\nstream\n');
      append(stream);
      append('\nendstream');
    }
    append('\nendobj\n');
  }

  append('%PDF-1.4\n');
  append(Uint8Array.of(37, 226, 227, 207, 211, 10));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => (3 + index * 3) + ' 0 R');
  object(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>');

  pages.forEach((page, index) => {
    const { width, height, colors, adobe } = jpegInfo(page.bytes);
    const pageId = 3 + index * 3;
    // PDF 1.4 bounds page dimensions to 14,400 points. Keep the image stream at full resolution.
    const scale = Math.min(1, 14_400 / Math.max(width, height));
    const pageWidth = (width * scale).toFixed(4);
    const pageHeight = (height * scale).toFixed(4);
    object(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight +
      '] /Resources << /XObject << /Slide ' + (pageId + 1) + ' 0 R >> >> /Contents ' + (pageId + 2) + ' 0 R >>');
    const space = colors === 1 ? 'DeviceGray' : colors === 4 ? 'DeviceCMYK' : 'DeviceRGB';
    const decode = colors === 4 && adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    object(pageId + 1, '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
      ' /ColorSpace /' + space + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length + decode + ' >>', page.bytes);
    const content = encoder.encode('q\n' + pageWidth + ' 0 0 ' + pageHeight + ' 0 0 cm\n/Slide Do\nQ\n');
    object(pageId + 2, '<< /Length ' + content.length + ' >>', content);
  });

  const xref = length;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  onOutputSize?.(length);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export const convertSlideImageWithCanvas: SlideImageConverter = async image => {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw unsupported();
  const bitmap = await createImageBitmap(new Blob([image.bytes.slice()], { type: image.mimeType }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw unsupported();
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob || blob.type !== 'image/jpeg') throw unsupported();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};

export async function mergeSlideImagesToPdf(
  images: readonly SlideImageInput[],
  converter: SlideImageConverter = convertSlideImageWithCanvas,
  options: { signal?: AbortSignal; onOutputSize?: (length: number) => void } = {},
): Promise<Uint8Array> {
  const pages = [];
  for (const image of images) {
    options.signal?.throwIfAborted();
    const mime = image.mimeType.split(';', 1)[0].trim().toLowerCase();
    const isJpegBytes = image.bytes.length >= 2 && image.bytes[0] === 0xff && image.bytes[1] === 0xd8;
    const isPngBytes =
      image.bytes.length >= 4 &&
      image.bytes[0] === 0x89 && image.bytes[1] === 0x50 && image.bytes[2] === 0x4e && image.bytes[3] === 0x47;
    const isWebpBytes =
      image.bytes.length >= 12 &&
      image.bytes[0] === 0x52 && image.bytes[1] === 0x49 && image.bytes[2] === 0x46 && image.bytes[3] === 0x46 &&
      image.bytes[8] === 0x57 && image.bytes[9] === 0x45 && image.bytes[10] === 0x42 && image.bytes[11] === 0x50;
    if (isJpegBytes) {
      pages.push(image);
    } else if (isPngBytes || isWebpBytes || mime === 'image/png' || mime === 'image/webp') {
      try {
        pages.push(await converter(image));
      } catch {
        throw unsupported();
      }
    } else {
      throw unsupported();
    }
  }
  options.signal?.throwIfAborted();
  return assemblePdf(pages, options.onOutputSize);
}
