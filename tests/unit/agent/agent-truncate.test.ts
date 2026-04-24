import { describe, it, expect } from "vitest";
import { truncateToolResult } from "../../../src/agent/tools/truncate.js";

describe("truncateToolResult", () => {
  it("returns full JSON when under budget", () => {
    const obj = { a: 1, b: "hello" };
    const result = truncateToolResult(obj, 1024);
    expect(result).toBe(JSON.stringify(obj));
  });

  it("result is always valid JSON", () => {
    const largeObj = { data: "x".repeat(10000) };
    const result = truncateToolResult(largeObj, 100);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("truncates array by dropping tail entries", () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const result = truncateToolResult(arr, 500);
    const parsed = JSON.parse(result);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.kept).toBeLessThan(100);
    expect(parsed.original).toBe(100);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  it("keeps array items in original order", () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const result = truncateToolResult(arr, 100);
    const parsed = JSON.parse(result);
    if (parsed.__truncated) {
      // Items kept should be the FIRST N (tail dropped)
      for (let i = 0; i < parsed.items.length; i++) {
        expect(parsed.items[i].id).toBe(i + 1);
      }
    }
  });

  it("wraps large objects with __truncated marker", () => {
    const obj = { key: "x".repeat(10000) };
    const result = truncateToolResult(obj, 200);
    const parsed = JSON.parse(result);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.raw).toBeDefined();
  });

  it("handles empty array gracefully", () => {
    const result = truncateToolResult([], 10);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("passes small arrays unchanged", () => {
    const arr = [1, 2, 3];
    const result = truncateToolResult(arr, 10000);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it("returns zero-item truncated array when budget too small", () => {
    const arr = Array.from({ length: 5 }, (_, i) => ({ id: i, bigData: "x".repeat(200) }));
    const result = truncateToolResult(arr, 50);
    const parsed = JSON.parse(result);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.kept).toBe(0);
  });
});
