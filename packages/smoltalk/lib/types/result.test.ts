import { describe, it, expect } from "vitest";
import { success, failure, mergeResults } from "./result.js";

describe("success", () => {
  it("creates a Success result", () => {
    const r = success(42);
    expect(r.success).toBe(true);
    expect(r.value).toBe(42);
  });

  it("wraps any value type", () => {
    const r = success({ name: "Alice" });
    expect(r.success).toBe(true);
    expect(r.value).toEqual({ name: "Alice" });
  });

  it("wraps null", () => {
    const r = success(null);
    expect(r.success).toBe(true);
    expect(r.value).toBe(null);
  });
});

describe("failure", () => {
  it("creates a Failure result", () => {
    const r = failure("something went wrong");
    expect(r.success).toBe(false);
    expect(r.error).toBe("something went wrong");
  });
});

describe("mergeResults", () => {
  it("merges all successes into a single success array", () => {
    const results = [success(1), success(2), success(3)];
    const merged = mergeResults(results);
    expect(merged.success).toBe(true);
    if (merged.success) {
      expect(merged.value).toEqual([1, 2, 3]);
    }
  });

  it("returns the first failure if any result fails", () => {
    const results = [success(1), failure("oops"), success(3)];
    const merged = mergeResults(results);
    expect(merged.success).toBe(false);
    if (!merged.success) {
      expect(merged.error).toBe("oops");
    }
  });

  it("returns the first failure even when multiple fail", () => {
    const results = [failure("first"), failure("second")];
    const merged = mergeResults(results);
    expect(merged.success).toBe(false);
    if (!merged.success) {
      expect(merged.error).toBe("first");
    }
  });

  it("returns success with empty array for empty input", () => {
    const merged = mergeResults([]);
    expect(merged.success).toBe(true);
    if (merged.success) {
      expect(merged.value).toEqual([]);
    }
  });

  it("works with complex value types", () => {
    const results = [
      success({ id: 1, name: "a" }),
      success({ id: 2, name: "b" }),
    ];
    const merged = mergeResults(results);
    expect(merged.success).toBe(true);
    if (merged.success) {
      expect(merged.value).toEqual([
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ]);
    }
  });
});
