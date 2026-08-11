import { stat } from "fs/promises";
import { resolveModelFile } from "node-llama-cpp";

/**
 * Resolve a model reference to a local .gguf path. An existing file path is
 * returned unchanged; anything else (hf: URIs, URLs, model names) is handed
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
    return uriOrPath;
  }
  return resolveModelFile(uriOrPath, { directory: cacheDir, cli: true });
}
