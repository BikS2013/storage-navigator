import { describe, it, expect, vi, afterEach } from "vitest";
import { createAgentLogger } from "../../../src/agent/logging.js";
import { redactString } from "../../../src/util/redact.js";

describe("redactString", () => {
  it("redacts Bearer tokens", () => {
    const line = "Authorization: Bearer eyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef";
    const result = redactString(line);
    expect(result).not.toContain("eyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts JWT-shaped strings", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SomeSignature";
    const result = redactString(`token: ${jwt}`);
    expect(result).not.toContain(jwt);
  });

  it("redacts API key-shaped values in JSON", () => {
    const line = `{"apiKey": "sk-1234567890abcdef"}`;
    const result = redactString(line);
    expect(result).not.toContain("sk-1234567890abcdef");
    expect(result).toContain("[REDACTED]");
  });

  it("passes safe strings through unchanged", () => {
    const safe = "Listed 3 containers: a, b, c";
    expect(redactString(safe)).toBe(safe);
  });
});

describe("createAgentLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info lines to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createAgentLogger({ verbose: true }, { quiet: false });
    logger.info("test message");
    expect(spy).toHaveBeenCalled();
    const written = (spy.mock.calls[0][0] as string);
    expect(written).toContain("INFO");
    expect(written).toContain("test message");
  });

  it("does not write to stderr in quiet mode", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createAgentLogger({ verbose: true }, { quiet: true });
    logger.info("should be quiet");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not emit step logs when verbose is false", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createAgentLogger({ verbose: false }, { quiet: false });
    logger.step({ index: 1, tool: "list_blobs", args: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits step logs when verbose is true", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createAgentLogger({ verbose: true }, { quiet: false });
    logger.step({ index: 1, tool: "list_blobs", args: { container: "prompts" } });
    expect(spy).toHaveBeenCalled();
    const written = (spy.mock.calls[0][0] as string);
    expect(written).toContain("list_blobs");
  });

  it("redacts secrets in log output", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createAgentLogger({ verbose: true }, { quiet: false });
    logger.info("key=sk-1234567890abcdef and other data");
    const written = (spy.mock.calls[0][0] as string);
    // Should not contain a raw API key
    expect(written).not.toContain("sk-1234567890abcdef");
  });

  it("close resolves when no log file", async () => {
    const logger = createAgentLogger({ verbose: false }, { quiet: true });
    await expect(logger.close()).resolves.toBeUndefined();
  });
});
