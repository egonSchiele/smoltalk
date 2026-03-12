import { Model } from "../model.js";
import { ModelName } from "../models.js";
import { ModelLike, ModelParam } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { FallbackStrategy } from "./fallbackStrategy.js";
import { FastestStrategy } from "./fastestStrategy.js";
import { IDStrategy } from "./idStrategy.js";
import { RaceStrategy } from "./raceStrategy.js";
import { RandomStrategy } from "./randomStrategy.js";
import { TimeoutStrategy } from "./timeoutStrategy.js";
import {
  FallbackStrategyConfig,
  FallbackStrategyJSON,
  FallbackStrategyJSONSchema,
  FastestStrategyJSON,
  FastestStrategyJSONSchema,
  IDStrategyJSON,
  IDStrategyJSONSchema,
  ModelNameAndProvider,
  ModelNameAndProviderSchema,
  RaceStrategyJSON,
  RaceStrategyJSONSchema,
  RandomStrategyJSON,
  RandomStrategyJSONSchema,
  Strategy,
  StrategyJSON,
  TimeoutStrategyJSON,
  TimeoutStrategyJSONSchema,
} from "./types.js";

export * from "./baseStrategy.js";
export * from "./fallbackStrategy.js";
export * from "./idStrategy.js";
export * from "./raceStrategy.js";
export * from "./randomStrategy.js";
export * from "./timeoutStrategy.js";
export * from "./types.js";

export function race(...strategies: ModelParam[]): Strategy {
  return new RaceStrategy(strategies);
}

export function random(...strategies: ModelParam[]): Strategy {
  return new RandomStrategy(...strategies);
}

export function fastest(
  models: (string | ModelNameAndProvider | Model)[],
  epsilon?: number,
): Strategy {
  return new FastestStrategy(models, epsilon);
}

export function id(model: ModelLike): Strategy {
  return new IDStrategy(model);
}

export function timeout(strategy: ModelParam, timeoutMs: number): Strategy {
  return new TimeoutStrategy(strategy, timeoutMs);
}

export function fallback(
  primaryStrategy: ModelParam,
  config: FallbackStrategyConfig | string | string[],
): Strategy {
  let resolvedConfig: FallbackStrategyConfig;
  if (typeof config === "string") {
    resolvedConfig = { error: [config] };
  } else if (Array.isArray(config)) {
    resolvedConfig = { error: config };
  } else {
    resolvedConfig = config;
  }
  return new FallbackStrategy(primaryStrategy, resolvedConfig);
}

export function fromJSON(json: StrategyJSON): Strategy {
  if (IDStrategyJSONSchema.safeParse(json).success) {
    return IDStrategy.fromJSON(json as IDStrategyJSON);
  } else if (ModelNameAndProviderSchema.safeParse(json).success) {
    return IDStrategy.fromJSON(json as IDStrategyJSON);
  } else if (RaceStrategyJSONSchema.safeParse(json).success) {
    return RaceStrategy.fromJSON(json as RaceStrategyJSON);
  } else if (FallbackStrategyJSONSchema.safeParse(json).success) {
    return FallbackStrategy.fromJSON(json as FallbackStrategyJSON);
  } else if (RandomStrategyJSONSchema.safeParse(json).success) {
    return RandomStrategy.fromJSON(json as RandomStrategyJSON);
  } else if (FastestStrategyJSONSchema.safeParse(json).success) {
    return FastestStrategy.fromJSON(json as FastestStrategyJSON);
  } else if (TimeoutStrategyJSONSchema.safeParse(json).success) {
    return TimeoutStrategy.fromJSON(json as TimeoutStrategyJSON);
  } else if (typeof json === "string") {
    return id(json as ModelName);
  } else {
    throw new Error(`Unknown strategy JSON: ${JSON.stringify(json)}`);
  }
}
