import { LlamaVocabularyType } from "node-llama-cpp";
import type { LlamaModel, Token } from "node-llama-cpp";
import type { EmbedConfig, EmbedProvider, EmbedResult, Result } from "smoltalk";
import { failure, success } from "smoltalk";
import { acquireEmbeddingEntry } from "./nativeRegistry.js";

/** Two-plus characters before the colon, so a Windows drive letter is a
 *  path. The same rule LlamaCPP applies to config.model. */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

const ZERO_COST = { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Cut a vector to `dimensions` entries and scale it back to unit length,
 *  which is what a model trained for truncation (nomic-embed-text v1.5,
 *  the Qwen3 embedding family) expects. A model not trained for it gets
 *  a silently degraded vector; llama.cpp cannot tell us which kind we
 *  have, so the README carries the warning. */
function truncate(vector: readonly number[], dimensions: number): number[] {
  const cut = vector.slice(0, dimensions);
  const norm = Math.sqrt(cut.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) {
    return cut;
  }
  return cut.map((x) => x / norm);
}

/**
 * The beginning/end tokens getEmbeddingFor() adds around the text before
 * evaluating it. node-llama-cpp keeps these resolvers private
 * (utils/tokenizerUtils.ts), so this mirrors them from the public model
 * properties; they follow llama.cpp's llama_tokenize_internal.
 */
function beginningToken(model: LlamaModel): Token | null {
  const vocab = model.vocabularyType;
  if (vocab === LlamaVocabularyType.rwkv) {
    return null;
  }
  if (vocab === LlamaVocabularyType.wpm) {
    return model.tokens.bos;
  }
  if (vocab === LlamaVocabularyType.ugm) {
    return null;
  }
  if (model.tokens.shouldPrependBosToken) {
    return model.tokens.bos;
  }
  return null;
}

function endToken(model: LlamaModel): Token | null {
  const vocab = model.vocabularyType;
  if (vocab === LlamaVocabularyType.rwkv) {
    return null;
  }
  if (vocab === LlamaVocabularyType.wpm) {
    return model.tokens.sep;
  }
  if (vocab === LlamaVocabularyType.ugm) {
    return model.tokens.eos;
  }
  if (model.tokens.shouldAppendEosToken) {
    return model.tokens.eos;
  }
  return null;
}

/** The number of tokens getEmbeddingFor(text) actually evaluates: the raw
 *  tokenization plus the beginning/end markers it adds when they are not
 *  already there. Empty text is not evaluated at all. */
function countEvaluatedTokens(model: LlamaModel, text: string): number {
  const tokens = model.tokenize(text);
  if (tokens.length === 0) {
    return 0;
  }
  let count = tokens.length;
  const begin = beginningToken(model);
  if (begin !== null && tokens[0] !== begin) {
    count += 1;
  }
  const end = endToken(model);
  if (end !== null && tokens[tokens.length - 1] !== end) {
    count += 1;
  }
  return count;
}

/**
 * Embeddings computed in process by node-llama-cpp. `config.model` is a
 * local .gguf path; resolve a URI or a catalog name with resolveModel()
 * first. One embedding context per model file, kept for the life of the
 * process (see nativeRegistry). Calls on one model run one at a time.
 */
export const embed: EmbedProvider = async (
  inputs: string[],
  config: EmbedConfig,
): Promise<Result<EmbedResult>> => {
  const modelPath = config.model;
  if (URI_SCHEME.test(modelPath)) {
    return failure(
      `smoltalk-llama-cpp: embeddings need a local .gguf path. ` +
        `To download or resolve "${modelPath}", call resolveModel() first and pass its result as the model.`,
    );
  }
  const dimensions = config.dimensions;
  if (dimensions !== undefined) {
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      return failure(
        `smoltalk-llama-cpp: dimensions must be a positive integer, got ${dimensions}.`,
      );
    }
  }
  let entry;
  try {
    entry = await acquireEmbeddingEntry(modelPath);
  } catch (err) {
    return failure(
      `smoltalk-llama-cpp: could not load ${modelPath} for embeddings: ${errorMessage(err)}`,
    );
  }
  try {
    return await entry.lock.runExclusive(async () => {
      const embeddings: number[][] = [];
      let inputTokens = 0;
      for (const text of inputs) {
        const embedding = await entry.context.getEmbeddingFor(text);
        if (dimensions !== undefined) {
          embeddings.push(truncate(embedding.vector, dimensions));
        } else {
          embeddings.push([...embedding.vector]);
        }
        inputTokens += countEvaluatedTokens(entry.model, text);
      }
      return success({
        embeddings,
        model: modelPath,
        tokenUsage: { inputTokens, outputTokens: 0 },
        costEstimate: ZERO_COST,
      });
    });
  } catch (err) {
    return failure(
      `smoltalk-llama-cpp: embedding with ${modelPath} failed: ${errorMessage(err)}`,
    );
  }
};
