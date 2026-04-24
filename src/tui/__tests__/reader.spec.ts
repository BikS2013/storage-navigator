/**
 * Reader regression suite — spec §14.1, §14.2, §14.3.
 *
 * These two regression families have surfaced on every previous bring-up of
 * the spec, so they are MANDATORY. If escape framing regresses, arrow keys
 * echo as letters; if the UTF-8 path regresses, Greek/emoji input becomes
 * mojibake. Both bugs are invisible to unit tests of the pure helpers and
 * only surface in a stream-driven integration test like this one.
 */
import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { readInput, escapeFramingDone, deleteWordBack, wordLeft, wordRight } from "../reader.js";

class CaptureOut extends Writable {
  data = "";
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    cb();
  }
}

interface FakeStdin extends PassThrough {
  isTTY: boolean;
  setRawMode(_mode: boolean): this;
}

function makeStdin(): FakeStdin {
  const s = new PassThrough() as unknown as FakeStdin;
  s.isTTY = true;
  s.setRawMode = function (_mode: boolean) { return this; };
  return s;
}

function send(stdin: FakeStdin, ...chunks: (string | number[] | Buffer)[]): void {
  // Push each chunk as a separate `data` event — simulating real stdin chunking.
  for (const c of chunks) {
    if (typeof c === "string") stdin.write(Buffer.from(c, "utf8"));
    else if (Buffer.isBuffer(c)) stdin.write(c);
    else stdin.write(Buffer.from(c));
  }
}

const ENTER = [0x0d];

async function drive(
  send_: (s: FakeStdin) => void,
): Promise<{ result: string; out: string }> {
  const stdin = makeStdin();
  const out = new CaptureOut();
  const p = readInput({
    prompt: "> ",
    continuationPrompt: " . ",
    inputHistory: [],
    input: stdin,
    out,
  });
  // Defer input slightly so the promise's listener is attached first.
  setImmediate(() => send_(stdin));
  const result = await p;
  return { result, out: out.data };
}

describe("escapeFramingDone — pure helper", () => {
  it("requires final byte AFTER `[` for CSI", () => {
    expect(escapeFramingDone([0x1b, 0x5b])).toBe(false);          // ESC [ — incomplete
    expect(escapeFramingDone([0x1b, 0x5b, 0x41])).toBe(true);     // ESC [ A — complete
    expect(escapeFramingDone([0x1b, 0x5b, 0x33])).toBe(false);    // ESC [ 3 — params, incomplete
    expect(escapeFramingDone([0x1b, 0x5b, 0x33, 0x7e])).toBe(true); // ESC [ 3 ~ — complete
  });
  it("SS3 dispatches at exactly 3 bytes", () => {
    expect(escapeFramingDone([0x1b, 0x4f])).toBe(false);
    expect(escapeFramingDone([0x1b, 0x4f, 0x48])).toBe(true);
  });
  it("ESC<char> dispatches at 2 bytes", () => {
    expect(escapeFramingDone([0x1b])).toBe(false);
    expect(escapeFramingDone([0x1b, 0x62])).toBe(true);
  });
  it("CSI with parameters and intermediate bytes still requires final byte", () => {
    expect(escapeFramingDone([0x1b, 0x5b, 0x31, 0x3b, 0x35])).toBe(false);
    expect(escapeFramingDone([0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x44])).toBe(true);
  });
});

describe("Reader §14.1 — escape-framing regression (arrows MUST NOT leak as letters)", () => {
  // Each sequence pressed alone, then Enter, must resolve to "".
  const cases: Array<[string, string | number[]]> = [
    ["arrow up   \\x1b[A",       "\x1b[A"],
    ["arrow down \\x1b[B",       "\x1b[B"],
    ["arrow right\\x1b[C",       "\x1b[C"],
    ["arrow left \\x1b[D",       "\x1b[D"],
    ["SS3 Home   \\x1bOH",       "\x1bOH"],
    ["Delete     \\x1b[3~",      "\x1b[3~"],
    ["Ctrl+Left  \\x1b[1;5D",    "\x1b[1;5D"],
    ["Alt+b      \\x1bb",        "\x1bb"],
  ];
  for (const [name, seq] of cases) {
    it(`${name} alone + Enter resolves to ""`, async () => {
      const { result } = await drive((s) => {
        send(s, seq);
        send(s, ENTER);
      });
      expect(result).toBe("");
    });
  }
});

describe("Reader §14.2 — UTF-8 multi-byte regression", () => {
  it("Greek 'test Αναφορά' round-trips intact", async () => {
    const { result } = await drive((s) => {
      send(s, "test Αναφορά");
      send(s, ENTER);
    });
    expect(result).toBe("test Αναφορά");
  });

  it("4-byte emoji '😀' decodes as one character", async () => {
    const { result } = await drive((s) => {
      send(s, "😀");
      send(s, ENTER);
    });
    expect(result).toBe("😀");
  });

  it("Greek 'α' split across two data chunks (0xCE then 0xB1) decodes correctly", async () => {
    const { result } = await drive((s) => {
      send(s, [0xce]);
      send(s, [0xb1]);
      send(s, ENTER);
    });
    expect(result).toBe("α");
  });
});

describe("Reader §14.3 — mixed ASCII + multi-byte + escape sequence in one chunk", () => {
  it("'αβ' + ESC[D + 'γ' produces 'αγβ' with no escape-byte leakage", async () => {
    // Greek α=CE B1, β=CE B2, γ=CE B3. ESC[D moves cursor left one column,
    // so γ inserts before β.
    const bytes = Buffer.concat([
      Buffer.from("αβ", "utf8"),
      Buffer.from("\x1b[D", "latin1"),
      Buffer.from("γ", "utf8"),
    ]);
    const { result } = await drive((s) => {
      send(s, bytes);
      send(s, ENTER);
    });
    expect(result).toBe("αγβ");
  });
});

describe("Reader — basic editing", () => {
  it("simple ASCII + Enter works", async () => {
    const { result } = await drive((s) => {
      send(s, "hello");
      send(s, ENTER);
    });
    expect(result).toBe("hello");
  });

  it("Ctrl+J inserts a newline", async () => {
    const { result } = await drive((s) => {
      send(s, "line1");
      send(s, [0x0a]);
      send(s, "line2");
      send(s, ENTER);
    });
    expect(result).toBe("line1\nline2");
  });

  it("Backspace deletes the previous character", async () => {
    const { result } = await drive((s) => {
      send(s, "hellx");
      send(s, [0x7f]);
      send(s, "o");
      send(s, ENTER);
    });
    expect(result).toBe("hello");
  });

  it("Backspace at column 0 merges with previous line", async () => {
    const { result } = await drive((s) => {
      send(s, "ab");
      send(s, [0x0a]);
      send(s, "cd");
      send(s, [0x01]); // Ctrl+A → col 0
      send(s, [0x7f]); // Backspace at col 0 → merge
      send(s, ENTER);
    });
    expect(result).toBe("abcd");
  });

  it("Ctrl+C rejects with SIGINT", async () => {
    const stdin = makeStdin();
    const out = new CaptureOut();
    const p = readInput({
      prompt: "> ",
      continuationPrompt: " . ",
      inputHistory: [],
      input: stdin,
      out,
    });
    setImmediate(() => send(stdin, [0x03]));
    await expect(p).rejects.toThrow(/SIGINT/);
  });

  it("Ctrl+D on empty buffer rejects with EOF", async () => {
    const stdin = makeStdin();
    const out = new CaptureOut();
    const p = readInput({
      prompt: "> ",
      continuationPrompt: " . ",
      inputHistory: [],
      input: stdin,
      out,
    });
    setImmediate(() => send(stdin, [0x04]));
    await expect(p).rejects.toThrow(/EOF/);
  });
});

describe("Reader — input history (Up/Down at edges)", () => {
  it("Up arrow on an empty input shows the last submitted entry", async () => {
    const stdin = makeStdin();
    const out = new CaptureOut();
    const p = readInput({
      prompt: "> ",
      continuationPrompt: " . ",
      inputHistory: ["first", "second"],
      input: stdin,
      out,
    });
    setImmediate(() => {
      send(stdin, "\x1b[A"); // Up → "second"
      send(stdin, "\x1b[A"); // Up → "first"
      send(stdin, "\x1b[B"); // Down → "second"
      send(stdin, ENTER);
    });
    expect(await p).toBe("second");
  });
});

describe("Reader — pure helpers", () => {
  it("deleteWordBack deletes the word ending at the cursor", () => {
    expect(deleteWordBack("foo bar baz", 11)).toEqual({ line: "foo bar ", col: 8 });
    expect(deleteWordBack("foo", 3)).toEqual({ line: "", col: 0 });
    expect(deleteWordBack("", 0)).toEqual({ line: "", col: 0 });
  });
  it("wordLeft and wordRight navigate by whitespace", () => {
    expect(wordLeft("foo bar baz", 11)).toBe(8);
    expect(wordLeft("foo bar baz", 8)).toBe(4);
    expect(wordRight("foo bar baz", 0)).toBe(3);
    expect(wordRight("foo bar baz", 3)).toBe(7);
  });
});
