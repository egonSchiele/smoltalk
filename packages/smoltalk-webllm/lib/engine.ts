import type { MLCEngine } from "@mlc-ai/web-llm";
import { SmolError } from "smoltalk";

const engines = new Map<string, MLCEngine>();

export function getEngine(id: string): MLCEngine {
  const e = engines.get(id);
  if (!e) {
    throw new SmolError(`Model not loaded: call loadModel("${id}") first`);
  }
  return e;
}

export function isLoaded(id: string): boolean {
  return engines.has(id);
}

export async function unloadModel(id: string): Promise<void> {
  const e = engines.get(id);
  if (e) {
    await e.unload();
    engines.delete(id);
  }
}

/** @internal — test-only */
export function __setEngineForTesting(id: string, engine: MLCEngine): void {
  engines.set(id, engine);
}

/** @internal — test-only */
export function __clearEnginesForTesting(): void {
  engines.clear();
}

/** @internal */
export function __getEngineMap(): Map<string, MLCEngine> {
  return engines;
}
