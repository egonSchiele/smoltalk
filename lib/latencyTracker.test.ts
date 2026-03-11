import { describe, it, expect, beforeEach } from "vitest";
import { latencyTracker } from "./latencyTracker.js";

describe("latencyTracker", () => {
  beforeEach(() => {
    latencyTracker.clear();
    latencyTracker.setWindowSize(10);
  });

  it("records and retrieves mean ms per token", () => {
    latencyTracker.record("gpt-4o", 1000, 100); // 10 ms/token
    latencyTracker.record("gpt-4o", 2000, 100); // 20 ms/token
    expect(latencyTracker.getMeanMsPerToken("gpt-4o")).toBe(15);
  });

  it("returns null for unknown model", () => {
    expect(latencyTracker.getMeanMsPerToken("unknown")).toBeNull();
    expect(latencyTracker.getTokensPerSecond("unknown")).toBeNull();
  });

  it("converts to tokens per second", () => {
    latencyTracker.record("gpt-4o", 1000, 100); // 10 ms/token = 100 tok/s
    expect(latencyTracker.getTokensPerSecond("gpt-4o")).toBe(100);
  });

  it("ignores samples with zero or negative tokens/elapsed", () => {
    latencyTracker.record("gpt-4o", 1000, 0);
    latencyTracker.record("gpt-4o", 0, 100);
    latencyTracker.record("gpt-4o", -1, 100);
    latencyTracker.record("gpt-4o", 1000, -5);
    expect(latencyTracker.getSampleCount("gpt-4o")).toBe(0);
  });

  it("keeps only the last N samples (window size)", () => {
    latencyTracker.setWindowSize(3);
    latencyTracker.record("gpt-4o", 100, 10); // 10 ms/tok
    latencyTracker.record("gpt-4o", 200, 10); // 20 ms/tok
    latencyTracker.record("gpt-4o", 300, 10); // 30 ms/tok
    latencyTracker.record("gpt-4o", 400, 10); // 40 ms/tok — pushes out first

    expect(latencyTracker.getSampleCount("gpt-4o")).toBe(3);
    // Mean of 20, 30, 40
    expect(latencyTracker.getMeanMsPerToken("gpt-4o")).toBe(30);
  });

  it("clears samples for a specific model", () => {
    latencyTracker.record("gpt-4o", 1000, 100);
    latencyTracker.record("o3", 500, 50);
    latencyTracker.clear("gpt-4o");
    expect(latencyTracker.getSampleCount("gpt-4o")).toBe(0);
    expect(latencyTracker.getSampleCount("o3")).toBe(1);
  });

  it("clears all samples", () => {
    latencyTracker.record("gpt-4o", 1000, 100);
    latencyTracker.record("o3", 500, 50);
    latencyTracker.clear();
    expect(latencyTracker.getSampleCount("gpt-4o")).toBe(0);
    expect(latencyTracker.getSampleCount("o3")).toBe(0);
  });

  it("trims existing samples when window size is reduced", () => {
    latencyTracker.record("gpt-4o", 100, 10);
    latencyTracker.record("gpt-4o", 200, 10);
    latencyTracker.record("gpt-4o", 300, 10);
    latencyTracker.record("gpt-4o", 400, 10);
    latencyTracker.record("gpt-4o", 500, 10);

    latencyTracker.setWindowSize(2);
    expect(latencyTracker.getSampleCount("gpt-4o")).toBe(2);
    // Should keep the last 2: 40 ms/tok and 50 ms/tok
    expect(latencyTracker.getMeanMsPerToken("gpt-4o")).toBe(45);
  });

  it("returns defensive copy from getSamples", () => {
    latencyTracker.record("gpt-4o", 1000, 100);
    const samples = latencyTracker.getSamples("gpt-4o");
    samples.push({ msPerToken: 999, timestamp: 0 });
    expect(latencyTracker.getSampleCount("gpt-4o")).toBe(1);
  });
});
