export type LatencySample = {
  /** Milliseconds per output token */
  msPerToken: number;
  /** Timestamp when sample was recorded */
  timestamp: number;
};

const DEFAULT_WINDOW_SIZE = 10;

class LatencyTracker {
  private samples: Map<string, LatencySample[]> = new Map();
  private windowSize: number;

  constructor(windowSize: number = DEFAULT_WINDOW_SIZE) {
    this.windowSize = windowSize;
  }

  /** Record a latency sample for a model. */
  record(model: string, elapsedMs: number, outputTokens: number): void {
    if (outputTokens <= 0 || elapsedMs <= 0) return;

    const msPerToken = elapsedMs / outputTokens;
    const samples = this.samples.get(model) ?? [];
    samples.push({ msPerToken, timestamp: Date.now() });

    // Keep only the last windowSize samples
    if (samples.length > this.windowSize) {
      samples.splice(0, samples.length - this.windowSize);
    }

    this.samples.set(model, samples);
  }

  /** Get the windowed mean ms-per-token for a model, or null if no samples. */
  getMeanMsPerToken(model: string): number | null {
    const samples = this.samples.get(model);
    if (!samples || samples.length === 0) return null;

    const sum = samples.reduce((acc, s) => acc + s.msPerToken, 0);
    return sum / samples.length;
  }

  /**
   * Get estimated output tokens per second for a model based on tracked latency.
   * Returns null if no samples exist.
   */
  getTokensPerSecond(model: string): number | null {
    const msPerToken = this.getMeanMsPerToken(model);
    if (msPerToken === null || msPerToken === 0) return null;
    return 1000 / msPerToken;
  }

  /** Get the number of samples recorded for a model. */
  getSampleCount(model: string): number {
    return this.samples.get(model)?.length ?? 0;
  }

  /** Get all samples for a model (defensive copy). */
  getSamples(model: string): LatencySample[] {
    return [...(this.samples.get(model) ?? [])];
  }

  /** Clear all samples for a model. */
  clear(model?: string): void {
    if (model) {
      this.samples.delete(model);
    } else {
      this.samples.clear();
    }
  }

  /** Update the window size. Existing samples beyond the new size are trimmed. */
  setWindowSize(size: number): void {
    this.windowSize = size;
    for (const [model, samples] of this.samples) {
      if (samples.length > size) {
        samples.splice(0, samples.length - size);
      }
    }
  }

  getWindowSize(): number {
    return this.windowSize;
  }
}

/** Global singleton latency tracker. */
export const latencyTracker = new LatencyTracker();
