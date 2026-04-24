/**
 * Clipboard tests — platform dispatch via mocked spawn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// Hoisted mock so import inside copyToClipboard sees it.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stderr = new PassThrough();
}

let originalPlatform: PropertyDescriptor | undefined;
function setPlatform(p: NodeJS.Platform): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}
function restorePlatform(): void {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("copyToClipboard", () => {
  it("uses pbcopy on macOS", async () => {
    setPlatform("darwin");
    spawnMock.mockImplementation(() => {
      const p = new FakeProc();
      setImmediate(() => p.emit("close", 0));
      return p;
    });
    const { copyToClipboard } = await import("../clipboard.js");
    await copyToClipboard("hello");
    expect(spawnMock).toHaveBeenCalledWith("pbcopy", [], expect.any(Object));
    restorePlatform();
  });

  it("uses xclip on Linux", async () => {
    setPlatform("linux");
    delete process.env["WSL_DISTRO_NAME"];
    spawnMock.mockImplementation(() => {
      const p = new FakeProc();
      setImmediate(() => p.emit("close", 0));
      return p;
    });
    vi.resetModules();
    const { copyToClipboard } = await import("../clipboard.js");
    await copyToClipboard("hello");
    expect(spawnMock).toHaveBeenCalledWith(
      "xclip",
      ["-selection", "clipboard"],
      expect.any(Object)
    );
    restorePlatform();
  });

  it("uses clip on Windows", async () => {
    setPlatform("win32");
    spawnMock.mockImplementation(() => {
      const p = new FakeProc();
      setImmediate(() => p.emit("close", 0));
      return p;
    });
    vi.resetModules();
    const { copyToClipboard } = await import("../clipboard.js");
    await copyToClipboard("hello");
    expect(spawnMock).toHaveBeenCalledWith("clip", [], expect.any(Object));
    restorePlatform();
  });

  it("throws a user-visible error when the binary is missing (non-zero exit)", async () => {
    setPlatform("darwin");
    spawnMock.mockImplementation(() => {
      const p = new FakeProc();
      setImmediate(() => p.emit("error", new Error("spawn pbcopy ENOENT")));
      return p;
    });
    vi.resetModules();
    const { copyToClipboard } = await import("../clipboard.js");
    await expect(copyToClipboard("hello")).rejects.toThrow(/clipboard not available/);
    restorePlatform();
  });
});
