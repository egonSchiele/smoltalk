import { getLogger } from "../logger.js";
import { ModelLike, ModelParam, SmolPromptConfig } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { fromJSON, IDStrategy } from "./index.js";
import {
  RaceStrategyJSON,
  RaceStrategyJSONSchema,
  Strategy,
  StrategyJSON,
} from "./types.js";

export class RaceStrategy extends BaseStrategy {
  public strategies: Strategy[];
  constructor(strategies: ModelParam[]) {
    super();
    this.strategies = strategies.map((s) =>
      s instanceof BaseStrategy ? s : new IDStrategy(s as ModelLike),
    );
  }

  toString() {
    return `RaceStrategy([${this.strategies.map((s) => s.toString()).join(", ")}])`;
  }

  toShortString() {
    return `race(${this.strategies.map((s) => s.toShortString?.() || s.toString()).join(", ")})`;
  }

  async _text(config: SmolPromptConfig) {
    const controllers = this.strategies.map(() => new AbortController());

    // Link to any existing abort signal so external cancellation still works
    if (config.abortSignal) {
      const external = config.abortSignal;
      for (const controller of controllers) {
        external.addEventListener(
          "abort",
          () => controller.abort(external.reason),
          { once: true },
        );
      }
    }

    const promises = this.strategies.map((strategy, i) => {
      return strategy.text({
        ...config,
        abortSignal: controllers[i].signal,
      });
    });

    let winnerIndex: number | null = null;

    return Promise.race(
      promises.map((p, i) =>
        p.then((result) => {
          if (winnerIndex !== null) {
            // This strategy resolved after the winner (e.g. due to being aborted).
            // Do not attempt to abort other strategies again.
            return result;
          }
          winnerIndex = i;
          for (let j = 0; j < controllers.length; j++) {
            if (j !== i) {
              const logger = getLogger();
              logger.debug(
                `RaceStrategy: aborting strategy ${this.strategies[j]} because strategy ${this.strategies[i]} won the race.`,
              );
              this.statelogClient?.debug(
                "RaceStrategy: aborting losing strategy",
                {
                  winner: this.strategies[i].toString(),
                  aborted: this.strategies[j].toString(),
                },
              );
              controllers[j].abort();
            }
          }
          return result;
        }),
      ),
    );
  }

  toJSON(): StrategyJSON {
    return {
      type: "race",
      params: { strategies: this.strategies.map((s) => s.toJSON()) },
    };
  }

  static fromJSON(json: unknown): RaceStrategy {
    const parsed = RaceStrategyJSONSchema.parse(json);
    const strategies = parsed.params.strategies.map((s) => fromJSON(s));
    return new RaceStrategy(strategies);
  }
}
