import type { AssetType } from "@tessera/contracts";

// Telling an image's type from its bytes, never its name (DATA-11, AST-01). A file passes only if
// its header parses as PNG, JPEG or WebP down to its dimensions, so HTML named `.png`, an SVG, or a
// real signature followed by something else is refused. This reads headers only: it doesn't
// decode the image, so a file can pass and still fail to show.

export type Sniffed =
  { ok: true; type: AssetType; widthPx: number; heightPx: number } | { ok: false };

const NO: Sniffed = { ok: false };
const has = (bytes: Uint8Array, at: number, expected: readonly number[]) =>
  expected.every((byte, i) => bytes[at + i] === byte);
const ascii = (bytes: Uint8Array, at: number, text: string) =>
  has(
    bytes,
    at,
    [...text].map((c) => c.charCodeAt(0)),
  );
const sized = (type: AssetType, widthPx: number, heightPx: number): Sniffed =>
  widthPx > 0 && heightPx > 0 ? { ok: true, type, widthPx, heightPx } : NO;

// The signature, then an IHDR chunk of 13 bytes holding the width and height.
function png(bytes: Uint8Array, view: DataView): Sniffed {
  if (!has(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return NO;
  if (bytes.length < 33 || view.getUint32(8) !== 13 || !ascii(bytes, 12, "IHDR")) return NO;
  const widthPx = view.getUint32(16);
  const heightPx = view.getUint32(20);
  return widthPx < 2 ** 31 && heightPx < 2 ** 31 ? sized("image/png", widthPx, heightPx) : NO;
}

// Start of image, then segments up to a start of frame, which holds the height and width.
const START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
// Markers that stand alone, with no length after them.
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function jpeg(bytes: Uint8Array, view: DataView): Sniffed {
  if (!has(bytes, 0, [0xff, 0xd8, 0xff])) return NO;
  let at = 2;
  // Every step moves forward, so the walk ends within the file.
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return NO;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9) return NO;
    if (STANDALONE.has(marker)) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2);
    // A segment's length counts itself and must stay inside the file.
    if (length < 2 || at + 2 + length > bytes.length) return NO;
    if (START_OF_FRAME.has(marker)) {
      // Its length, precision, height, width and component count: at least 8 bytes.
      if (length < 8) return NO;
      return sized("image/jpeg", view.getUint16(at + 7), view.getUint16(at + 5));
    }
    at += 2 + length;
  }
  return NO;
}

// A RIFF container of type WEBP, whose first chunk is lossy (VP8), lossless (VP8L) or extended
// (VP8X); each keeps the dimensions in its own way. The container's size, and the first chunk's,
// must stay inside the file and hold the fields read.
const MIN_CHUNK: Record<string, number> = { "VP8 ": 10, VP8L: 5, VP8X: 10 };

function webp(bytes: Uint8Array, view: DataView): Sniffed {
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP") || bytes.length < 30) return NO;
  const riffSize = view.getUint32(4, true);
  const chunkSize = view.getUint32(16, true);
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const needed = MIN_CHUNK[chunk];
  if (needed === undefined || chunkSize < needed) return NO;
  if (riffSize + 8 > bytes.length || 20 + chunkSize > bytes.length) return NO;
  if (riffSize < 4 + 8 + chunkSize) return NO;
  if (ascii(bytes, 12, "VP8 ")) {
    if (!has(bytes, 23, [0x9d, 0x01, 0x2a])) return NO;
    return sized(
      "image/webp",
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  }
  if (ascii(bytes, 12, "VP8L")) {
    if (bytes[20] !== 0x2f) return NO;
    const [b1, b2, b3, b4] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!];
    const widthPx = 1 + (((b2 & 0x3f) << 8) | b1);
    const heightPx = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return sized("image/webp", widthPx, heightPx);
  }
  if (ascii(bytes, 12, "VP8X")) {
    const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    return sized("image/webp", 1 + u24(24), 1 + u24(27));
  }
  return NO;
}

/** The image type and dimensions `bytes` hold, or not ok if they aren't a PNG, JPEG or WebP. */
export function sniffImage(bytes: Uint8Array): Sniffed {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const sniff of [png, jpeg, webp]) {
    const found = sniff(bytes, view);
    if (found.ok) return found;
  }
  return NO;
}
