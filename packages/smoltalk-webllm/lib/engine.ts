import type { MLCEngine } from "@mlc-ai/web-llm";
import { SmolError } from "smoltalk";
import type {
  CustomModel,
  LoadInput,
  LoadOptions,
  LoadProgress,
} from "./types.js";

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

type EngineFactory = (
  id: string,
  opts: LoadOptions | undefined,
  custom: CustomModel | undefined,
) => Promise<MLCEngine>;

// Lazy import of @mlc-ai/web-llm via dynamic `import()` — required for SSR safety.
//
// Why this matters:
// `@mlc-ai/web-llm` references browser-only globals (`navigator`, `window`,
// `navigator.gpu`, etc.) at module-evaluation time. With a static `import`,
// those references would be evaluated as soon as ANY file in this package is
// imported — including in Node/SSR contexts where they're undefined. That
// would crash with `ReferenceError: navigator is not defined` even if the
// caller never invokes `loadModel()`.
//
// Hybrid frameworks where this matters: Next.js (server components / API
// routes), Remix loaders, SvelteKit `+page.server.ts`, Astro server islands,
// any file shared between client and server bundles.
//
// Using `await import("@mlc-ai/web-llm")` inside the factory defers the
// module's top-level evaluation until `loadModel()` is actually called — by
// which point the caller has already chosen to opt in to the browser path
// and the WebGPU check above has confirmed we're in a browser-like
// environment.
const defaultFactory: EngineFactory = async (id, opts, custom) => {
  const webllm = await import("@mlc-ai/web-llm");
  const initProgressCallback = (r: { progress?: number; text?: string }) => {
    opts?.onProgress?.(normalizeProgress(r));
  };
  if (custom) {
    const overrides: Record<string, number> = {};
    if (custom.contextWindow !== undefined) {
      overrides.context_window_size = custom.contextWindow;
    }
    if (custom.maxOutputTokens !== undefined) {
      overrides.max_tokens = custom.maxOutputTokens;
    }
    return webllm.CreateMLCEngine(id, {
      initProgressCallback,
      appConfig: {
        model_list: [
          {
            model: custom.modelUrl,
            model_id: id,
            model_lib: custom.modelLibUrl,
            ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
          },
        ],
      },
    } as any);
  }
  return webllm.CreateMLCEngine(id, { initProgressCallback });
};

let factory: EngineFactory = defaultFactory;

// In-flight loads. Each entry holds a `done` promise that resolves once the
// engine is registered (or rejects if the load itself failed) and a `waiters`
// counter so we can decide whether to free GPU memory when every caller has
// aborted before the engine arrives.
type LoadOperation = {
  done: Promise<void>;
  waiters: number;
};
const loading = new Map<string, LoadOperation>();

export async function loadModel(
  input: LoadInput,
  opts?: LoadOptions,
): Promise<void> {
  if (!(globalThis as any).navigator?.gpu) {
    throw new SmolError(
      "WebGPU is not available in this environment. " +
        "smoltalk-webllm requires a browser with WebGPU support.",
    );
  }

  const id = typeof input === "string" ? input : input.id;
  const custom = typeof input === "string" ? undefined : input;

  if (engines.has(id)) return;
  if (opts?.signal?.aborted) {
    throw new SmolError("Model load aborted");
  }

  // Start the load if no one else has, otherwise share the existing operation.
  let op = loading.get(id);
  if (!op) {
    const factoryPromise = factory(id, opts, custom);
    const operation: LoadOperation = {
      waiters: 0,
      done: (async () => {
        try {
          const engine = await factoryPromise;
          if (operation.waiters > 0) {
            // At least one caller is still waiting — register the engine so
            // every waiter resolves with it.
            engines.set(id, engine);
          } else {
            // Everyone aborted before the engine arrived. Free the GPU.
            await engine.unload().catch(() => {});
          }
        } finally {
          loading.delete(id);
        }
      })(),
    };
    op = operation;
    loading.set(id, op);
    // Don't let an unhandled rejection escape if every caller aborts before
    // the inner promise rejects.
    op.done.catch(() => {});
  }

  op.waiters++;
  try {
    if (opts?.signal) {
      const signal = opts.signal;
      const abortPromise = new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new SmolError("Model load aborted")),
          { once: true },
        );
      });
      await Promise.race([op.done, abortPromise]);
    } else {
      await op.done;
    }
  } finally {
    op.waiters--;
  }
}

function normalizeProgress(r: {
  progress?: number;
  text?: string;
}): LoadProgress {
  const text = r.text ?? "";
  const progress = r.progress ?? 0;
  const stage: LoadProgress["stage"] =
    progress >= 1
      ? "ready"
      : /compil|load.*model/i.test(text)
        ? "compiling"
        : "downloading";
  return {
    stage,
    loaded: Math.round(progress * 100),
    total: 100,
    text,
  };
}

/** @internal — test-only */
export function __setEngineFactoryForTesting(f: EngineFactory): void {
  factory = f;
}

/**
 * Returns the model IDs available in the underlying @mlc-ai/web-llm prebuilt
 * config. Lazily imports web-llm so this is SSR-safe.
 */
export async function listModels(): Promise<string[]> {
  const webllm = await import("@mlc-ai/web-llm");
  return webllm.prebuiltAppConfig.model_list.map((m: any) => m.model_id);
}

/** Returns true if the given id is in web-llm's prebuilt model list. */
export async function isWebLLMModel(id: string): Promise<boolean> {
  const ids = await listModels();
  return ids.includes(id);
}
