/**
 * UTF-8 decoder tests — spec §14.2 regression suite.
 */
import { describe, it, expect } from "vitest";
import { createUtf8Decoder } from "../utf8.js";

function feed(decoder: ReturnType<typeof createUtf8Decoder>, bytes: Buffer): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += decoder.write(bytes[i]!);
  }
  return out;
}

describe("createUtf8Decoder (spec §14.2)", () => {
  it("decodes pure ASCII byte-by-byte", () => {
    const dec = createUtf8Decoder();
    expect(feed(dec, Buffer.from("hello"))).toBe("hello");
  });

  it("round-trips the Greek string 'test Αναφορά'", () => {
    const dec = createUtf8Decoder();
    const bytes = Buffer.from("test Αναφορά", "utf8");
    expect(feed(dec, bytes)).toBe("test Αναφορά");
  });

  it("decodes a single 4-byte emoji as one character", () => {
    const dec = createUtf8Decoder();
    const bytes = Buffer.from("😀", "utf8");
    expect(bytes.length).toBe(4);
    const out = feed(dec, bytes);
    // emoji is one code point but JS strings count surrogate pairs as length 2
    expect(out).toBe("😀");
  });

  it("handles split multi-byte across data chunks (Greek 'α' = 0xCE 0xB1)", () => {
    const dec = createUtf8Decoder();
    // Lead byte alone yields nothing
    expect(dec.write(0xce)).toBe("");
    // Continuation byte completes the character
    expect(dec.write(0xb1)).toBe("α");
  });

  it("handles a 4-byte emoji split across four chunks", () => {
    const dec = createUtf8Decoder();
    const bytes = Buffer.from("😀", "utf8");
    let out = "";
    for (const b of bytes) {
      out += dec.write(b);
    }
    expect(out).toBe("😀");
  });

  it("end() flushes empty when no partial sequence is pending", () => {
    const dec = createUtf8Decoder();
    feed(dec, Buffer.from("ok"));
    expect(dec.end()).toBe("");
  });
});
