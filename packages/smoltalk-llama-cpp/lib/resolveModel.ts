import { stat } from "fs/promises";
import path from "path";
import { resolveModelFile } from "node-llama-cpp";

/**
 * Resolve a model reference to a local .gguf path. An existing file path is
 * returned as an absolute path (so the result is always directly consumable
 * as `config.model` — a bare relative filename would otherwise be mistaken
 * for a model name); anything else (hf: URIs, URLs, model names) is handed
 * to node-llama-cpp's resolveModelFile, which downloads into `cacheDir` with
 * CLI progress output.
 */
export async function resolveModel(
  uriOrPath: string,
  cacheDir: string,
): Promise<string> {
  let existingFile = false;
  try {
    const stats = await stat(uriOrPath);
    existingFile = stats.isFile();
  } catch {
    existingFile = false;
  }
  if (existingFile) {
    return path.resolve(uriOrPath);
  }
  return resolveModelFile(uriOrPath, { directory: cacheDir, cli: true });
}
