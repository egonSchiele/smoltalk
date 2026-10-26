import { describe, it, expect } from "vitest";
import { round, sanitizeAttributes, stripCodeFence } from "./util.js";

describe("round", () => {
  it("rounds to 2 decimal places", () => {
    expect(round(1.005, 2)).toBe(1);
    expect(round(1.235, 2)).toBe(1.24);
    expect(round(1.555, 2)).toBe(1.56);
  });

  it("rounds to 0 decimal places", () => {
    expect(round(4.5, 0)).toBe(5);
    expect(round(4.4, 0)).toBe(4);
  });

  it("rounds to 4 decimal places", () => {
    expect(round(1.23456789, 4)).toBe(1.2346);
  });

  it("handles negative numbers", () => {
    expect(round(-1.235, 2)).toBe(-1.24);
    expect(round(-0.5, 0)).toBe(-0);
  });

  it("handles zero", () => {
    expect(round(0, 2)).toBe(0);
  });

  it("handles integers", () => {
    expect(round(5, 2)).toBe(5);
  });
});

describe("stripCodeFence", () => {
  it("strips ```json fences", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips bare ``` fences", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("is case-insensitive on the language tag", () => {
    expect(stripCodeFence('```JSON\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("trims surrounding whitespace", () => {
    expect(stripCodeFence('  \n```json\n{"a":1}\n```\n  ')).toBe('{"a":1}');
  });

  it("returns the input unchanged when no fences are present", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("sanitizeAttributes", () => {
  it("drops the keys the caller owns and keeps the rest", () => {
    expect(sanitizeAttributes({ model: "x", top_k: 5 }, ["model"])).toEqual({ top_k: 5 });
  });

  it("warns once for each owned key it drops", () => {
    const warnings: unknown[][] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };
    sanitizeAttributes({ model: "x", messages: [], top_k: 5 }, ["model", "messages"], logger);
    expect(warnings).toHaveLength(2);
    expect(String(warnings[0])).toContain("model");
    expect(String(warnings[1])).toContain("messages");
  });

  it("still drops prototype keys", () => {
    const attrs = JSON.parse('{"__proto__": {"polluted": true}, "top_k": 5}');
    expect(sanitizeAttributes(attrs)).toEqual({ top_k: 5 });
  });
});
