import { SmolTimeoutError } from "../smolError.js";
import {
  ModelLike,
  ModelParam,
  PromptResult,
  Result,
  SmolPromptConfig,
} from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { IDStrategy } from "./idStrategy.js";
import { fromJSON } from "./index.js";
import {
  Strategy,
  StrategyJSON,
  TimeoutStrategyJSON,
  TimeoutStrategyJSONSchema,
} from "./types.js";

export class TimeoutStrategy extends BaseStrategy {
  public strategy: Strategy;
  public timeoutMs: number;

  constructor(strategy: ModelParam, timeoutMs: number) {
    super();
    this.strategy =
      strategy instanceof BaseStrategy
        ? strategy
        : new IDStrategy(strategy as ModelLike);
    this.timeoutMs = timeoutMs;
  }

  toString() {
    return `TimeoutStrategy(${this.strategy.toString()}, ${this.timeoutMs}ms)`;
  }

  toShortString() {
    return `timeout(${this.strategy.toShortString?.() || this.strategy.toString()}, ${this.timeoutMs}ms)`;
  }

  async _text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    const controller = new AbortController();

    // Link to any existing abort signal
    if (config.abortSignal) {
      const external = config.abortSignal;
      external.addEventListener(
        "abort",
        () => controller.abort(external.reason),
        { once: true },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(
          new SmolTimeoutError(
            `Strategy timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);

      // Clear timeout if the controller is aborted externally
      controller.signal.addEventListener(
        "abort",
        () => clearTimeout(timer),
        { once: true },
      );
    });

    const resultPromise = this.strategy.text({
      ...config,
      abortSignal: controller.signal,
    }) as Promise<Result<PromptResult>>;

    return Promise.race([resultPromise, timeoutPromise]);
  }

  toJSON(): StrategyJSON {
    return {
      type: "timeout",
      params: {
        strategy: this.strategy.toJSON(),
        timeoutMs: this.timeoutMs,
      },
    };
  }

  static fromJSON(json: unknown): TimeoutStrategy {
    const parsed = TimeoutStrategyJSONSchema.parse(json);
    const strategy = fromJSON(parsed.params.strategy) as Strategy;
    return new TimeoutStrategy(strategy, parsed.params.timeoutMs);
  }
}
