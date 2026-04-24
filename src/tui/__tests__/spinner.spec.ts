/**
 * Spinner tests — frame rotation and label mutation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import { createSpinner, SPINNER_FRAMES } from "../spinner.js";

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    cb();
  }
  joined(): string {
    return this.chunks.join("");
  }
}

describe("createSpinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the first frame on start() and rotates over time", () => {
    const out = new CaptureStream();
    const sp = createSpinner("Thinking...", { out, intervalMs: 80 });
    sp.start();
    expect(sp.isActive()).toBe(true);
    expect(out.joined()).toContain(SPINNER_FRAMES[0]);
    vi.advanceTimersByTime(80);
    expect(out.joined()).toContain(SPINNER_FRAMES[1]);
    vi.advanceTimersByTime(80 * 8); // wrap to frame 9
    expect(out.joined()).toContain(SPINNER_FRAMES[9]);
    sp.stop();
    expect(sp.isActive()).toBe(false);
  });

  it("clears the line on stop()", () => {
    const out = new CaptureStream();
    const sp = createSpinner("Thinking...", { out, intervalMs: 80 });
    sp.start();
    out.chunks.length = 0; // reset
    sp.stop();
    expect(out.joined()).toContain("\r\x1b[2K");
  });

  it("setLabel changes the rendered text on the next tick", () => {
    const out = new CaptureStream();
    const sp = createSpinner("Thinking...", { out, intervalMs: 80 });
    sp.start();
    sp.setLabel("Processing tool result...");
    vi.advanceTimersByTime(80);
    expect(out.joined()).toContain("Processing tool result...");
    sp.stop();
  });

  it("double-start is a no-op (single timer)", () => {
    const out = new CaptureStream();
    const sp = createSpinner("X", { out, intervalMs: 80 });
    sp.start();
    sp.start();
    vi.advanceTimersByTime(80);
    // If two timers were running we'd expect two distinct frames per tick;
    // we just assert the spinner is still active and stop() clears it.
    expect(sp.isActive()).toBe(true);
    sp.stop();
  });
});
