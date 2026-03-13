import { latencyTracker } from "../latencyTracker.js";
import { getLogger } from "../util/logger.js";
import { Model } from "../model.js";
import {
  getModel,
  isTextModel,
  ModelName,
  Provider,
  TextModel,
} from "../models.js";
import { ModelLike, PromptResult, Result, SmolPromptConfig, StreamChunk } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { IDStrategy } from "./idStrategy.js";
import {
  FastestStrategyJSONSchema,
  StrategyJSON,
} from "./types.js";

// what percentage of the time to explore (pick a random model instead of the fastest) - this prevents us from getting stuck on a model that was fast in the past but has since become slow
const DEFAULT_EPSILON = 0.1;

export class FastestStrategy extends BaseStrategy {
  public models: (string | Model)[];
  public epsilon: number;

  constructor(
    models: (string | Model)[],
    epsilon: number = DEFAULT_EPSILON,
  ) {
    super();
    this.models = models;
    this.epsilon = epsilon;
  }

  toString() {
    return `FastestStrategy([${this.models.map((s) => s.toString()).join(", ")}])`;
  }

  toShortString() {
    return `fastest([${this.models.map((s) => s.toString()).join(", ")}])`;
  }

  private chooseModel(config: SmolPromptConfig): Model {
    const resolved = this.models.map((model) => Model.create(model));
    const logger = getLogger(config.logLevel);

    if (Math.random() < this.epsilon) {
      // Explore: pick a random model
      const chosen = resolved[Math.floor(Math.random() * resolved.length)];
      logger.debug("fastest strategy - exploring random model", {
        model: chosen.getResolvedModel(),
      });
      this.statelogClient?.debug("fastest strategy - picking random model", {
        model: chosen.getResolvedModel(),
      });
      return chosen;
    }

    // Exploit: pick the fastest model by tracked latency
    const fastest = this.pickFastest(resolved);
    if (fastest) {
      logger.debug("fastest strategy - exploiting fastest model", {
        model: fastest.getResolvedModel(),
      });
      this.statelogClient?.debug("fastest strategy - using fastest model", {
        model: fastest.getResolvedModel(),
      });
      return fastest;
    }

    // we don't have latency data for any model, so just pick randomly
    const chosen = resolved[Math.floor(Math.random() * resolved.length)];
    logger.debug(
      "fastest strategy - no latency data, picking random model",
      {
        models: resolved.map((m) => m.getResolvedModel()),
        chosen: chosen.getResolvedModel(),
      },
    );
    this.statelogClient?.debug(
      "fastest strategy - no latency data, picking random model",
      {
        models: resolved.map((m) => m.getResolvedModel()),
        chosen,
      },
    );
    return chosen;
  }

  async _text(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    const chosen = this.chooseModel(config);
    const strategy = new IDStrategy(chosen);
    return strategy.text(config) as Promise<Result<PromptResult>>;
  }

  async *_textStream(config: SmolPromptConfig): AsyncGenerator<StreamChunk> {
    const chosen = this.chooseModel(config);
    const strategy = new IDStrategy(chosen);
    yield* strategy.textStream(config);
  }

  private pickFastest(models: Model[]): Model | null {
    let best = null;
    let bestSpeed = 0;

    for (let model of models) {
      const speed = this.getSpeed(model);
      if (speed && speed > bestSpeed) {
        bestSpeed = speed;
        best = model;
      }
    }
    return best;
  }

  /** Get tokens/sec for a model: tracked latency first, then static estimate, then 0. */
  private getSpeed(model: Model): number | null {
    const MIN_SAMPLES = 3;
    const tracked = latencyTracker.getTokensPerSecond(
      model.getResolvedModel(),
      MIN_SAMPLES,
    );
    return tracked;
  }

  toJSON(): StrategyJSON {
    return {
      type: "fastest",
      params: {
        models: this.models.map((s) => (s instanceof Model ? s.toJSON() : s)),
      },
    };
  }

  static fromJSON(json: unknown): FastestStrategy {
    const parsed = FastestStrategyJSONSchema.parse(json);
    const models = parsed.params.models;
    return new FastestStrategy(models);
  }
}
