export * from "./clients/google.js";
export * from "./clients/openai.js";
import { EgonLog } from "egonlog";
import { SmolGoogle } from "./clients/google.js";
import { SmolOpenAi } from "./clients/openai.js";
import { getModel, isTextModel } from "./models.js";
import { SmolError } from "./smolError.js";
import { SmolConfig } from "./types.js";
import { getLogger } from "./logger.js";

export function getClient(config: SmolConfig) {
  if (!config.openAiApiKey && !config.googleApiKey) {
    throw new SmolError(
      "No API key provided. Please provide an OpenAI or Google API key in the config using openAiApiKey or googleApiKey."
    );
  }

  // Initialize logger singleton with desired log level
  const logger = getLogger(config.logLevel);

  const model = getModel(config.model);
  if (model === undefined || !isTextModel(model)) {
    throw new SmolError(
      `Only text models are supported currently. ${config.model} is a ${model?.type} model.`
    );
  }
  const clientConfig = { ...config };
  switch (model.source) {
    case "openai":
      return new SmolOpenAi(clientConfig);
      break;
    case "google":
      return new SmolGoogle(clientConfig);
      break;
    default:
      throw new SmolError(`Model source ${model.source} is not supported.`);
  }
}
