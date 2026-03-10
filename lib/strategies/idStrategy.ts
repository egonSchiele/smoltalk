import { getClient } from "../client.js";
import { splitConfig } from "../functions.js";
import { Model } from "../model.js";
import { ModelName, Provider } from "../models.js";
import { ModelLike, PromptResult, Result, SmolPromptConfig } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import {
  IDStrategyJSON,
  IDStrategyJSONSchema,
  ModelNameAndProviderSchema,
  StrategyJSON,
} from "./types.js";

export class IDStrategy extends BaseStrategy {
  public model: Model;
  constructor(model: ModelLike, provider?: string) {
    super();
    this.model = Model.create(model, provider as Provider | undefined);
  }

  toString() {
    return `IDStrategy(${this.model.toString()})`;
  }

  toShortString() {
    return `id(${this.model.toString()})`;
  }

  async _text(config: SmolPromptConfig) {
    return this._textSync(config);
  }

  async _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    const configOverrides = {
      model: this.model.getResolvedModel(),
      provider: this.model.getProvider(),
    };
    const { smolConfig, promptConfig } = splitConfig({
      ...config,
      ...configOverrides,
    });
    const client = getClient({
      ...smolConfig,
      ...configOverrides,
    });
    return client.textSync(promptConfig);
  }

  // todo: this toJSON isn't fully accurate as it resolves the model,
  // so strategy vs strategy.fromJSON(strategy.toJSON()) won't be the same
  toJSON(): StrategyJSON {
    return {
      type: "id",
      params: {
        model: this.model.getResolvedModel(),
        provider: this.model.getProvider(),
      },
    };
  }

  static fromJSON(json: unknown): IDStrategy {
    const parsed = IDStrategyJSONSchema.safeParse(json);
    if (parsed.success) {
      return new IDStrategy(
        parsed.data.params.model as ModelName,
        parsed.data.params.provider,
      );
    }

    const parsedNameAndProvider = ModelNameAndProviderSchema.safeParse(json);
    if (parsedNameAndProvider.success) {
      const { model, provider } = parsedNameAndProvider.data;
      return new IDStrategy(model as ModelName, provider);
    }

    throw new Error(`Invalid IDStrategy JSON: ${JSON.stringify(json)}`);
  }
}
