import { Model } from "../model.js";
import { ModelName } from "../models.js";
import { ModelLike } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { FallbackStrategy } from "./fallbackStrategy.js";
import { IDStrategy } from "./idStrategy.js";
import { RaceStrategy } from "./raceStrategy.js";
import {
  FallbackStrategyConfig,
  FallbackStrategyJSON,
  FallbackStrategyJSONSchema,
  IDStrategyJSON,
  IDStrategyJSONSchema,
  RaceStrategyJSON,
  RaceStrategyJSONSchema,
  Strategy,
  StrategyJSON,
} from "./types.js";

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
  if (IDStrategyJSONSchema.safeParse(json).success) {
    return IDStrategy.fromJSON(json as IDStrategyJSON);
  } else if (RaceStrategyJSONSchema.safeParse(json).success) {
    return RaceStrategy.fromJSON(json as RaceStrategyJSON);
  } else if (FallbackStrategyJSONSchema.safeParse(json).success) {
    return FallbackStrategy.fromJSON(json as FallbackStrategyJSON);
  } else if (typeof json === "string") {
    return id(json as ModelName);
  } else {
    throw new Error(`Unknown strategy JSON: ${JSON.stringify(json)}`);
  }
}
