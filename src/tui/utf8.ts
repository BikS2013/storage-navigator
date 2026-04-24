/**
 * Stateful UTF-8 byte decoder used by the raw-mode reader.
 *
 * Required because every printable byte the reader sees may be part of a
 * multi-byte UTF-8 code point (Greek, Cyrillic, CJK, emoji, etc.) and a
 * single multi-byte character can be split across two `data` events from
 * stdin. Naively calling `String.fromCharCode(byte)` would treat the byte as
 * Latin-1 and mangle anything ≥ U+0080. See spec §5.2 and §18.2.
 *
 * Wraps Node's `node:string_decoder.StringDecoder`, which buffers partial
 * sequences and only returns whole code points.
 */
import { StringDecoder } from "node:string_decoder";

export interface Utf8Decoder {
  /**
   * Feed one printable byte. Returns the empty string if the byte is part of a
   * multi-byte sequence still in progress, or the decoded character(s) once
   * the sequence completes.
   */
  write(byte: number): string;
  /** Flush any partial bytes (used when a session ends). */
  end(): string;
}

export function createUtf8Decoder(): Utf8Decoder {
  const decoder = new StringDecoder("utf8");
  const oneByte = Buffer.alloc(1);
  return {
    write(byte: number): string {
      oneByte[0] = byte;
      return decoder.write(oneByte);
    },
    end(): string {
      return decoder.end();
    },
  };
}
