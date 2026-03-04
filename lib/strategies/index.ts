import { Model } from "../model.js";
import { ModelLike } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { FallbackStrategy } from "./fallbackStrategy.js";
import { IDStrategy } from "./idStrategy.js";
import { RaceStrategy } from "./raceStrategy.js";
import { FallbackStrategyConfig, Strategy, StrategyJSON } from "./types.js";

export * from "./baseStrategy.js";
export * from "./fallbackStrategy.js";
export * from "./idStrategy.js";
export * from "./raceStrategy.js";
export * from "./types.js";

export function race(..._strategies: (Strategy | ModelLike)[]): Strategy {
  const strategies = _strategies.map((s) =>
    s instanceof BaseStrategy
      ? s
      : new IDStrategy(Model.create(s as ModelLike)),
  );
  return new RaceStrategy(strategies);
}

export function id(model: ModelLike): Strategy {
  return new IDStrategy(Model.create(model));
}

export function fallback(
  _strategies: (Strategy | ModelLike)[],
  config: FallbackStrategyConfig,
): Strategy {
  const strategies = _strategies.map((s) =>
    s instanceof BaseStrategy
      ? s
      : new IDStrategy(Model.create(s as ModelLike)),
  );

  return new FallbackStrategy(strategies, config);
}

export function fromJSON(json: StrategyJSON): Strategy {
  if (typeof json === "string") {
    return id(json as ModelLike);
  }
  switch (json.type) {
    case "id":
      return id(json.params.model as ModelLike);
    case "race":
      return race(...json.params.strategies.map(fromJSON));
    case "fallback":
      return fallback(
        json.params.strategies.map(fromJSON),
        json.params.config,
      );
    default:
      throw new Error(`Unknown strategy type: ${(json as any).type}`);
  }
}
