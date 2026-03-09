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
  public provider: string | undefined;
  constructor(model: ModelLike, provider?: string) {
    super();
    this.model = Model.create(model);
    this.provider = provider;
  }

  toString() {
    const params = [`model: ${this.model.getResolvedModel()}`];
    if (this.provider) params.push(`provider: ${this.provider}`);
    return `IDStrategy(${params.join(", ")})`;
  }

  toShortString() {
    const params = [`model: ${this.model.getResolvedModel()}`];
    if (this.provider) params.push(`provider: ${this.provider}`);
    return `id(${params.join(", ")})`;
  }

  async _text(config: SmolPromptConfig) {
    return this._textSync(config);
  }

  async _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    const configOverrides = {
      model: this.model.getResolvedModel(),
      provider: config.provider || (this.provider as Provider | undefined),
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

  toJSON(): StrategyJSON {
    return {
      type: "id",
      params: { model: this.model.getResolvedModel(), provider: this.provider },
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
      const { modelName, provider } = parsedNameAndProvider.data;
      return new IDStrategy(modelName as ModelName, provider);
    }

    throw new Error(`Invalid IDStrategy JSON: ${JSON.stringify(json)}`);
  }
}
