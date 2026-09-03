import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCost,
  formatCostPerMillion,
  formatTokens,
} from "./format";

describe("formatTokens", () => {
  it("uses compact notation for large context windows", () => {
    expect(formatTokens(1048576)).toBe("1M");
    expect(formatTokens(1000000)).toBe("1M");
    expect(formatTokens(200000)).toBe("200K");
    expect(formatTokens(128000)).toBe("128K");
  });

  it("keeps one decimal when it carries information", () => {
    expect(formatTokens(65536)).toBe("65.5K");
    expect(formatTokens(1050000)).toBe("1.1M");
  });

  it("shows small numbers exactly", () => {
    expect(formatTokens(4096)).toBe("4.1K");
    expect(formatTokens(200)).toBe("200");
  });

  it("renders an em dash for missing values", () => {
    expect(formatTokens(undefined)).toBe("—");
  });
});

describe("formatCost", () => {
  it("shows two decimals at or above a dollar", () => {
    expect(formatCost(10)).toBe("$10.00");
    expect(formatCost(4.5)).toBe("$4.50");
    expect(formatCost(180)).toBe("$180.00");
  });

  it("keeps sub-dollar precision without trailing zeros", () => {
    expect(formatCost(0.075)).toBe("$0.075");
    expect(formatCost(0.02)).toBe("$0.02");
    expect(formatCost(0.005)).toBe("$0.005");
  });

  it("distinguishes free from missing", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(undefined)).toBe("—");
  });
});

describe("formatCostPerMillion", () => {
  it("scales a per-unit cost up to a per-million cost", () => {
    // tts-1 bills $0.000015 per character.
    expect(formatCostPerMillion(0.000015)).toBe("$15.00");
    expect(formatCostPerMillion(undefined)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("renders upload caps in binary units", () => {
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(14_000_000)).toBe("13.4 MB");
    expect(formatBytes(undefined)).toBe("—");
  });
});
