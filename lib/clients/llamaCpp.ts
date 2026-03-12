import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { BaseClient } from "./baseClient.js";
import {
  ModelParam,
  PromptConfig,
  PromptResult,
  promptResult,
  ResolvedSmolConfig,
  Result,
  success,
} from "../types.js";
import path from "path";

export class LlamaCPP extends BaseClient {
  private llama: Awaited<ReturnType<typeof getLlama>> | null = null;
  private llamaModel: Awaited<
    ReturnType<Awaited<ReturnType<typeof getLlama>>["loadModel"]>
  > | null = null;
  private modelDir: string;
  private model: string;
  constructor(config: ResolvedSmolConfig) {
    super(config);
    if (!config.llamaCppModelDir) {
      throw new Error(
        "llamaCppModelDir is required in the config when using the LlamaCPP client.",
      );
    }
    this.model = config.model;
    this.modelDir = config.llamaCppModelDir;
  }

  async setup() {
    this.llama = await getLlama();
    this.llamaModel = await this.llama.loadModel({
      modelPath: path.join(this.modelDir, this.model),
    });
  }

  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    if (!this.llama || !this.llamaModel) {
      await this.setup();
    }
    const setupLlama = this.llama!;
    const setupModel = this.llamaModel!;
    let grammar;
    if (config.responseFormat) {
      grammar = await setupLlama.createGrammarForJsonSchema(
        config.responseFormat.toJSONSchema() as any,
      );
    }
    const context = await setupModel.createContext();
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });
    const message = config.messages[0];
    if (!message) {
      return success(promptResult({ output: "" }));
    }
    const response = await session.prompt(message.content, {
      grammar: grammar ?? undefined,
    });

    return success(promptResult({ output: response }));
  }
}
