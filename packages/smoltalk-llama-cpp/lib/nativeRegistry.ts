import { getLlama, LlamaLogLevel } from "node-llama-cpp";
import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaContextSequence,
} from "node-llama-cpp";
import { getLogger } from "smoltalk";
import path from "path";

/**
 * Module-level cache of native llama resources keyed by resolved model path.
 *
 * Why module-level and not on the LlamaCPP instance: smoltalk constructs a
 * fresh client per `text()` call (getClient in smoltalk core), so instance
 * state would create — and, because the client is discarded, never free — a
 * context per call. See smoltalk-llama-cpp-native-reuse-spec.md.
 *
 * The context + sequence are created ONCE per model and reused for the life of
 * the process. They are only ever disposed via disposeAll()/disposeModel(),
 * with nothing in flight. The generation path never disposes the context —
 * that per-call teardown races node-llama-cpp's fire-and-forget checkpoint
 * worker on SWA/hybrid models and produces a native use-after-free (bug.md).
 */

/** Native resources for one model, shared across all calls for that model. */
export type ModelEntry = {
  llama: Llama;
  model: LlamaModel;
  context: LlamaContext;
  sequence: LlamaContextSequence;
  lock: AsyncLock;
};

/**
 * A minimal FIFO async mutex. Generation on a shared sequence must be
 * serialized: overlapping generateResponse calls on one sequence corrupt KV
 * state, and disposal must not race an in-flight call.
 */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Wait for exclusive access; returns a release function. Callers MUST call
   * release() (in a finally) exactly once, even on error/abort, or the lock
   * wedges. Used by the streaming path, which holds the lock across the whole
   * generator lifetime.
   */
  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = this.tail.then(() => next);
    await prev;
    return release;
  }

  /** Run fn under the lock, releasing even if fn throws. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// One Llama binding per process — getLlama() is not memoized upstream, so we
// share a single promise rather than paying for a new binding per model.
let llamaPromise: Promise<Llama> | null = null;

function getSharedLlama(): Promise<Llama> {
  if (!llamaPromise) {
    llamaPromise = getLlama({ logLevel: LlamaLogLevel.error });
  }
  return llamaPromise;
}

// Store the PROMISE of an entry, not the resolved entry, so two concurrent
// first calls for the same model share one loadModel()/createContext().
const registry: Record<string, Promise<ModelEntry>> = Object.create(null);

function keyFor(modelDir: string, modelFile: string): string {
  return path.resolve(path.join(modelDir, modelFile));
}

async function createEntry(modelPath: string): Promise<ModelEntry> {
  const llama = await getSharedLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();
  const sequence = context.getSequence();
  return { llama, model, context, sequence, lock: new AsyncLock() };
}

/**
 * Get (loading on first use) the shared native resources for a model. The
 * returned entry's context/sequence live until disposeAll()/disposeModel().
 */
export function acquireModelEntry(
  modelDir: string,
  modelFile: string,
): Promise<ModelEntry> {
  const key = keyFor(modelDir, modelFile);
  let entryPromise = registry[key];
  if (!entryPromise) {
    entryPromise = createEntry(key);
    registry[key] = entryPromise;
    // If loading fails, drop the cached rejection so a later call can retry.
    entryPromise.catch(() => {
      if (registry[key] === entryPromise) delete registry[key];
    });
  }
  return entryPromise;
}

/**
 * Dispose one model's native state. Awaits the per-model lock (nothing in
 * flight), drains pending checkpoint work under the context lock via
 * clearHistory(), then frees the context and model. If the drain throws, the
 * context is intentionally leaked rather than freed (see below). Safe no-op for
 * unknown keys. `key` is the resolved model path (see acquireModelEntry).
 */
export async function disposeModel(key: string): Promise<void> {
  const entryPromise = registry[key];
  if (!entryPromise) return;
  delete registry[key];

  let entry: ModelEntry;
  try {
    entry = await entryPromise;
  } catch {
    // Entry never finished loading; nothing native to free.
    return;
  }

  await entry.lock.runExclusive(async () => {
    // Drain pending checkpoint work under the context lock. This is what makes
    // context.dispose() safe: clearHistory() serializes behind the fire-and-
    // forget checkpoint worker (bug.md). If it throws we can't assume the
    // worker finished, so freeing the context now would re-open the very
    // use-after-free this package exists to prevent — leak instead of crash.
    try {
      await entry.sequence.clearHistory();
    } catch (error) {
      getLogger().warn(
        "llama.cpp: clearHistory during dispose failed; leaking native context " +
          "to avoid a use-after-free:",
        (error as Error).message,
      );
      return;
    }
    await entry.context.dispose();
    await entry.model.dispose();
  });
}

/** Resolve the registry key for a (dir, file) pair, e.g. for disposeModel. */
export function modelKey(modelDir: string, modelFile: string): string {
  return keyFor(modelDir, modelFile);
}

/**
 * Dispose every loaded model. For tests and long-lived embedders; normal CLI
 * runs can just exit. Callers must ensure nothing is mid-generation.
 */
export async function disposeAll(): Promise<void> {
  const keys = Object.keys(registry);
  await Promise.all(keys.map((key) => disposeModel(key)));
}
