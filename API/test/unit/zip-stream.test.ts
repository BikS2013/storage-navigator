import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { streamZip, archiveName, type ZipEntry } from '../../src/streaming/zip-stream.js';

function readAll(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    s.on('data', (c) => chunks.push(c));
    s.on('end', () => resolve(Buffer.concat(chunks)));
    s.on('error', reject);
  });
}

function parseEntries(zip: Buffer) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const total = zip.readUInt16LE(eocd + 10);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const items: { name: string; size: number; offset: number }[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.slice(p + 46, p + 46 + nameLen).toString('utf8');
    items.push({ name, size, offset });
    p += 46 + nameLen;
  }
  return items;
}

describe('streamZip', () => {
  it('emits valid central directory for multiple entries', async () => {
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield { name: 'a.txt', body: Readable.from([Buffer.from('aaaa')]) };
      yield { name: 'sub/b.bin', body: Readable.from([Buffer.from('bb'), Buffer.from('bb')]) };
    }
    const zip = await readAll(streamZip({ entries: entries() }));
    const items = parseEntries(zip);
    expect(items.map((i) => i.name).sort()).toEqual(['a.txt', 'sub/b.bin']);
    expect(items.find((i) => i.name === 'a.txt')!.size).toBe(4);
    expect(items.find((i) => i.name === 'sub/b.bin')!.size).toBe(4);
    // Local file header signature at offset 0
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('pulls entries lazily — second source is not opened until the first is drained', async () => {
    const openOrder: string[] = [];
    function lateOpen(name: string, payload: string): ZipEntry {
      return {
        name,
        body: {
          async *[Symbol.asyncIterator]() {
            openOrder.push(name);
            yield Buffer.from(payload);
          },
        },
      };
    }
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield lateOpen('first', 'one');
      yield lateOpen('second', 'two');
    }
    const stream = streamZip({ entries: entries() });
    // Read the first chunk only — confirms that only the first entry has been opened.
    await new Promise<void>((resolve, reject) => {
      stream.once('readable', () => {
        const chunk = stream.read();
        if (!chunk) return reject(new Error('no chunk'));
        resolve();
      });
      stream.once('error', reject);
    });
    expect(openOrder).toEqual(['first']);
    // Drain the rest so the stream cleans up properly.
    await readAll(stream);
    expect(openOrder).toEqual(['first', 'second']);
  });

  it('writes data in chunks rather than buffering all bytes — verifies streaming behavior', async () => {
    const big = Buffer.alloc(64 * 1024, 0x41); // 64KB of 'A'
    // Source yields the buffer in 8KB chunks.
    async function* chunked(): AsyncGenerator<Buffer> {
      for (let off = 0; off < big.length; off += 8192) {
        yield big.subarray(off, off + 8192);
      }
    }
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield { name: 'big.bin', body: { [Symbol.asyncIterator]: chunked } };
    }
    const stream = streamZip({ entries: entries() });

    // Count distinct emit events — if the writer buffered everything, we would
    // see one giant chunk; streaming should emit at least a few discrete chunks.
    let emits = 0;
    stream.on('data', () => { emits++; });
    await new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    expect(emits).toBeGreaterThan(2);
  });

  it('archiveName strips base prefix and forbids traversal', () => {
    expect(archiveName('docs/sub/file.txt', 'docs')).toBe('sub/file.txt');
    expect(archiveName('/abs/path.txt')).toBe('abs/path.txt');
    expect(() => archiveName('../sneaky.txt')).toThrow();
    expect(() => archiveName('a/../b')).toThrow();
  });
});
