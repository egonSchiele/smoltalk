import { SmolPromptConfig } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { Strategy, StrategyJSON } from "./types.js";

export class RaceStrategy extends BaseStrategy {
  public strategies: Strategy[];
  constructor(strategies: Strategy[]) {
    super();
    this.strategies = strategies;
  }

  toString() {
    return `RaceStrategy([${this.strategies.map((s) => s.toString()).join(", ")}])`;
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

    return Promise.race(
      promises.map((p, i) =>
        p.then((result) => {
          for (let j = 0; j < controllers.length; j++) {
            if (j !== i) controllers[j].abort();
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
}
