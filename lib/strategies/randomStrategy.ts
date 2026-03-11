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
import { RandomStrategyJSONSchema, Strategy, StrategyJSON } from "./types.js";

export class RandomStrategy extends BaseStrategy {
  public strategies: Strategy[];
  constructor(...strategies: (Strategy | ModelParam)[]) {
    super();
    this.strategies = strategies.map((s) =>
      s instanceof BaseStrategy ? s : new IDStrategy(s as ModelLike),
    );
  }

  toString() {
    return `RandomStrategy([${this.strategies.map((s) => s.toString()).join(", ")}])`;
  }

  toShortString() {
    return `random([${this.strategies.map((s) => s.toString()).join(", ")}])`;
  }

  async _text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    const randomIndex = Math.floor(Math.random() * this.strategies.length);
    const strategy = this.strategies[randomIndex];
    this.statelogClient?.debug("random strategy chosen", {
      strategy,
    });
    const result = await strategy.text(config);
    return result;
  }

  toJSON(): StrategyJSON {
    return {
      type: "random",
      params: {
        strategies: this.strategies.map((s) => s.toJSON()),
      },
    };
  }

  static fromJSON(json: unknown): RandomStrategy {
    const parsed = RandomStrategyJSONSchema.parse(json);
    const strategies = parsed.params.strategies.map(
      (s) => fromJSON(s) as Strategy,
    );
    return new RandomStrategy(...strategies);
  }
}
