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
  let entry;
  try {
    entry = await acquireEmbeddingEntry(modelPath);
  } catch (err) {
    return failure(
      `smoltalk-llama-cpp: could not load ${modelPath} for embeddings: ${errorMessage(err)}`,
    );
  }
  const dimensions = config.dimensions;
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
        inputTokens += entry.model.tokenize(text).length;
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
