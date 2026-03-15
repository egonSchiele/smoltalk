import { z } from "zod";
import {
  ModelLike,
  ModelParam,
  PromptResult,
  Result,
  SmolPromptConfig,
  StreamChunk,
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
    const result = await (strategy.text(config) as Promise<Result<PromptResult>>);
    return result;
  }

  async *_textStream(config: SmolPromptConfig): AsyncGenerator<StreamChunk> {
    const randomIndex = Math.floor(Math.random() * this.strategies.length);
    const strategy = this.strategies[randomIndex];
    this.statelogClient?.debug("random strategy chosen (stream)", {
      strategy,
    });
    yield* strategy.textStream(config);
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
    const result = RandomStrategyJSONSchema.safeParse(json);
    if (!result.success) {
      console.error("Failed to parse RandomStrategy");
      console.error(JSON.stringify(json, null, 2));
      console.error(z.prettifyError(result.error));
      throw new Error("Failed to parse RandomStrategy");
    }
    const strategies = result.data.params.strategies.map(
      (s) => fromJSON(s) as Strategy,
    );
    return new RandomStrategy(...strategies);
  }
}
