import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// The archive container: a strict subset of ZIP, written and read here, with node:zlib doing the
// compression. Reading is a trust boundary (threat model, IMP-01 to IMP-03): every size, offset
// and name is checked before anything is unpacked, each entry is unpacked with a hard cap of the
// size it declares, and its checksum must match. Anything outside the subset is refused.

/** Refused archives say why in a plain sentence (GEN-12). */
export class ArchiveError extends Error {
  override name = "ArchiveError";
}

export type ZipLimits = {
  /** The whole archive file. */
  archiveBytes: number;
  entryCount: number;
  /** One entry, unpacked. */
  entryBytes: number;
  /** All entries together, unpacked. */
  totalBytes: number;
  /** Unpacked size over packed size, for entries large enough to matter. */
  compressionRatio: number;
};

export type ZipEntry = { name: string; data: Uint8Array };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const STORED = 0;
/** Entries smaller than this are never refused for their compression ratio. */
const RATIO_FLOOR_BYTES = 64 * 1024;

// DOS date and time, as ZIP stores them.
function dosDateTime(at: Date): [number, number] {
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1);
  const date =
    ((Math.max(at.getUTCFullYear(), 1980) - 1980) << 9) |
    ((at.getUTCMonth() + 1) << 5) |
    at.getUTCDate();
  return [time, date];
}

/** Packs entries into a ZIP archive, compressed, with UTF-8 names and the given time on each. */
export function writeZip(entries: readonly ZipEntry[], at: Date): Uint8Array {
  const [time, date] = dosDateTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const packed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const notAnArchive = () => new ArchiveError("This file isn't a Tessera archive.");
const damaged = () => new ArchiveError("This archive is damaged, so nothing was imported.");

// A name that could reach outside where it is unpacked, on any system (IMP-01).
function unsafeName(name: string): boolean {
  return (
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes(":") ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

type Listed = {
  name: string;
  method: number;
  crc: number;
  packedSize: number;
  size: number;
  dataStart: number;
};

/**
 * Unpacks a ZIP archive within the limits, refusing anything outside the subset `writeZip`
 * makes: no encryption, no ZIP64, no links, no unsafe or repeated names, only stored or deflated
 * entries. Every entry is listed and checked before any is unpacked.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits): Map<string, Uint8Array> {
  if (bytes.length > limits.archiveBytes) {
    throw new ArchiveError(
      `This archive is larger than ${limits.archiveBytes / 1024 / 1024} MB, the most Tessera imports.`,
    );
  }
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  // The end record is the last 22 bytes, followed by a comment of up to 65535 bytes.
  let end = -1;
  for (let at = buf.length - 22; at >= 0 && at >= buf.length - 22 - 0xffff; at--) {
    if (buf.readUInt32LE(at) === END && at + 22 + buf.readUInt16LE(at + 20) === buf.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw notAnArchive();
  const count = buf.readUInt16LE(end + 10);
  const directorySize = buf.readUInt32LE(end + 12);
  const directoryStart = buf.readUInt32LE(end + 16);
  // One disk only, and no ZIP64 markers.
  if (buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 6) !== 0) throw notAnArchive();
  if (buf.readUInt16LE(end + 8) !== count || count === 0xffff) throw notAnArchive();
  if (directoryStart + directorySize !== end) throw damaged();
  if (count > limits.entryCount) {
    throw new ArchiveError(
      `This archive has more than ${limits.entryCount} files, the most Tessera imports.`,
    );
  }

  const listed: Listed[] = [];
  const names = new Set<string>();
  let total = 0;
  let at = directoryStart;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || buf.readUInt32LE(at) !== CENTRAL) throw damaged();
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const madeOn = buf.readUInt16LE(at + 4) >> 8;
    const unixMode = buf.readUInt32LE(at + 38) >>> 16;
    const localStart = buf.readUInt32LE(at + 42);
    const nameEnd = at + 46 + nameLength;
    if (nameEnd > end) throw damaged();
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(at + 46, nameEnd));
    } catch {
      throw damaged();
    }
    at = nameEnd + extraLength + commentLength;
    if (unsafeName(name)) {
      throw new ArchiveError(`This archive has a file named "${name}" that Tessera refuses.`);
    }
    if (names.has(name)) throw new ArchiveError(`This archive has "${name}" twice.`);
    names.add(name);
    // Encrypted entries (bit 0, bit 6), and links: unix mode S_IFLNK on archives made on Unix.
    if ((flags & 0x41) !== 0) throw new ArchiveError("This archive is encrypted.");
    if (madeOn === 3 && (unixMode & 0o170000) === 0o120000) {
      throw new ArchiveError(`This archive has a link, "${name}", which Tessera refuses.`);
    }
    if (method !== STORED && method !== DEFLATE) throw notAnArchive();
    if (method === STORED && packedSize !== size) throw damaged();
    if (size === 0xffffffff || packedSize === 0xffffffff || localStart === 0xffffffff) {
      throw notAnArchive();
    }
    if (size > limits.entryBytes) {
      throw new ArchiveError(
        `"${name}" in this archive is larger than ${limits.entryBytes / 1024 / 1024} MB, the most Tessera imports.`,
      );
    }
    if (size > RATIO_FLOOR_BYTES && size > packedSize * limits.compressionRatio) {
      throw new ArchiveError(`"${name}" in this archive is packed too tightly to be safe to open.`);
    }
    total += size;
    if (total > limits.totalBytes) {
      throw new ArchiveError(
        `This archive unpacks to more than ${limits.totalBytes / 1024 / 1024} MB, the most Tessera imports.`,
      );
    }
    if (localStart + 30 > directoryStart || buf.readUInt32LE(localStart) !== LOCAL) {
      throw damaged();
    }
    const dataStart =
      localStart + 30 + buf.readUInt16LE(localStart + 26) + buf.readUInt16LE(localStart + 28);
    if (dataStart + packedSize > directoryStart) throw damaged();
    listed.push({ name, method, crc, packedSize, size, dataStart });
  }

  const files = new Map<string, Uint8Array>();
  for (const entry of listed) {
    const packed = buf.subarray(entry.dataStart, entry.dataStart + entry.packedSize);
    let data: Buffer;
    if (entry.method === STORED) {
      data = Buffer.from(packed);
    } else {
      try {
        // Unpacking stops at the declared size: an entry that is larger is refused, not unpacked.
        data = inflateRawSync(packed, { maxOutputLength: Math.max(entry.size, 1) });
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new ArchiveError(`"${entry.name}" in this archive is larger than it says.`);
        }
        throw damaged();
      }
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw damaged();
    files.set(entry.name, new Uint8Array(data));
  }
  return files;
}
