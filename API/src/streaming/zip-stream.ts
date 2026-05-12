import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

/**
 * Minimal streaming ZIP writer (STORE mode — no compression).
 *
 * Why store-mode: lets us forward bytes from Azure straight to the response
 * without buffering, with the only overhead being a per-entry header / footer
 * and a streaming CRC-32. Compression buys little for archives that contain
 * mostly already-compressed payloads (images, PDFs, docx) and would force us
 * to buffer through zlib.
 *
 * Limitations: no Zip64 — files >4GiB or archives with >65535 entries are
 * rejected. Acceptable for the storage-navigator download UX; can be revisited.
 */

const LFH_SIG = 0x04034b50;
const DD_SIG = 0x08074b50;
const CFH_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const GP_FLAG_DATA_DESCRIPTOR = 0x0008;
const GP_FLAG_UTF8_NAME = 0x0800;
const VERSION_NEEDED = 20; // 2.0 — STORE only
const ZIP_MAX_U32 = 0xffffffff;
const ZIP_MAX_U16 = 0xffff;

export type ZipEntrySource = NodeJS.ReadableStream | AsyncIterable<Uint8Array>;

export type ZipEntry = {
  /** Path inside the archive (forward slashes). */
  name: string;
  /** Stream of file bytes — drained once. */
  body: ZipEntrySource;
};

type CentralRecord = {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
};

export type StreamZipOptions = {
  /** Async iterable of entries — pulled one at a time. */
  entries: AsyncIterable<ZipEntry>;
  /** Called when an individual entry errors. Default: propagate. */
  onEntryError?: (name: string, err: unknown) => 'skip' | 'fail';
};

/**
 * Build a Readable that, when consumed, emits a valid ZIP archive.
 * Entries are pulled lazily — one stream open at a time.
 */
export function streamZip(opts: StreamZipOptions): Readable {
  const central: CentralRecord[] = [];
  let offset = 0;

  async function* generate(): AsyncGenerator<Buffer> {
    for await (const entry of opts.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      if (nameBuf.length > ZIP_MAX_U16) {
        throw new Error(`ZIP entry name too long: ${entry.name}`);
      }

      const lfh = buildLocalFileHeader(nameBuf);
      yield lfh;
      const entryStart = offset;
      offset += lfh.length;

      let crc = 0;
      let size = 0;
      try {
        for await (const chunkRaw of entry.body) {
          const chunk = chunkRaw instanceof Buffer ? chunkRaw : Buffer.from(chunkRaw as Uint8Array);
          if (chunk.length === 0) continue;
          crc = crc32(chunk, crc);
          size += chunk.length;
          if (size > ZIP_MAX_U32) {
            throw new Error(`ZIP entry exceeds 4GiB (Zip64 unsupported): ${entry.name}`);
          }
          offset += chunk.length;
          yield chunk;
        }
      } catch (err) {
        const decision = opts.onEntryError?.(entry.name, err) ?? 'fail';
        if (decision === 'fail') throw err;
        // Skip: still need a valid data descriptor with zero-byte body.
      }

      const dd = buildDataDescriptor(crc, size);
      yield dd;
      offset += dd.length;

      central.push({ name: nameBuf, crc, size, offset: entryStart });
      if (central.length > ZIP_MAX_U16) {
        throw new Error('ZIP entry count exceeds 65535 (Zip64 unsupported)');
      }
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const rec of central) {
      const cfh = buildCentralFileHeader(rec);
      cdSize += cfh.length;
      yield cfh;
    }
    yield buildEndOfCentralDirectory(central.length, cdSize, cdStart);
  }

  return Readable.from(generate());
}

function buildLocalFileHeader(name: Buffer): Buffer {
  const b = Buffer.alloc(30 + name.length);
  b.writeUInt32LE(LFH_SIG, 0);
  b.writeUInt16LE(VERSION_NEEDED, 4);
  b.writeUInt16LE(GP_FLAG_DATA_DESCRIPTOR | GP_FLAG_UTF8_NAME, 6);
  b.writeUInt16LE(0, 8); // STORE
  b.writeUInt16LE(0, 10); // mod time
  b.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
  b.writeUInt32LE(0, 14); // crc placeholder
  b.writeUInt32LE(0, 18); // compressed size placeholder
  b.writeUInt32LE(0, 22); // uncompressed size placeholder
  b.writeUInt16LE(name.length, 26);
  b.writeUInt16LE(0, 28); // extra
  name.copy(b, 30);
  return b;
}

function buildDataDescriptor(crc: number, size: number): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(DD_SIG, 0);
  b.writeUInt32LE(crc >>> 0, 4);
  b.writeUInt32LE(size, 8);
  b.writeUInt32LE(size, 12);
  return b;
}

function buildCentralFileHeader(rec: CentralRecord): Buffer {
  const b = Buffer.alloc(46 + rec.name.length);
  b.writeUInt32LE(CFH_SIG, 0);
  b.writeUInt16LE(0x031e, 4); // version made by — UNIX, 3.0
  b.writeUInt16LE(VERSION_NEEDED, 6);
  b.writeUInt16LE(GP_FLAG_DATA_DESCRIPTOR | GP_FLAG_UTF8_NAME, 8);
  b.writeUInt16LE(0, 10); // STORE
  b.writeUInt16LE(0, 12); // mod time
  b.writeUInt16LE(0x21, 14); // mod date
  b.writeUInt32LE(rec.crc >>> 0, 16);
  b.writeUInt32LE(rec.size, 20);
  b.writeUInt32LE(rec.size, 24);
  b.writeUInt16LE(rec.name.length, 28);
  b.writeUInt16LE(0, 30); // extra
  b.writeUInt16LE(0, 32); // comment
  b.writeUInt16LE(0, 34); // disk
  b.writeUInt16LE(0, 36); // internal attrs
  b.writeUInt32LE(0, 38); // external attrs
  b.writeUInt32LE(rec.offset, 42);
  rec.name.copy(b, 46);
  return b;
}

function buildEndOfCentralDirectory(entryCount: number, cdSize: number, cdOffset: number): Buffer {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(EOCD_SIG, 0);
  b.writeUInt16LE(0, 4); // disk
  b.writeUInt16LE(0, 6); // start disk
  b.writeUInt16LE(entryCount, 8);
  b.writeUInt16LE(entryCount, 10);
  b.writeUInt32LE(cdSize, 12);
  b.writeUInt32LE(cdOffset, 16);
  b.writeUInt16LE(0, 20); // comment length
  return b;
}

/**
 * Normalise a path for inclusion in the archive: strip leading slash, forbid
 * absolute or parent-traversal segments. Throws if the path can't be made safe.
 */
export function archiveName(rawPath: string, baseToStrip?: string): string {
  let p = rawPath.replace(/^\/+/, '');
  if (baseToStrip) {
    const base = baseToStrip.replace(/^\/+/, '').replace(/\/+$/, '');
    if (base && p.startsWith(base + '/')) p = p.slice(base.length + 1);
  }
  if (!p) throw new Error('empty archive entry name');
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`unsafe archive entry name: ${rawPath}`);
  }
  return p;
}
