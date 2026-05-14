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

// Lazy import of @mlc-ai/web-llm — keeps this package SSR-safe.
// The browser-global references (navigator, WebGPU, etc.) inside web-llm
// only get evaluated when loadModel() is actually called.
const defaultFactory: EngineFactory = async (id, opts, custom) => {
  const webllm = await import("@mlc-ai/web-llm");
  const initProgressCallback = (r: { progress?: number; text?: string }) => {
    opts?.onProgress?.(normalizeProgress(r));
  };
  if (custom) {
    return webllm.CreateMLCEngine(id, {
      initProgressCallback,
      appConfig: {
        model_list: [
          {
            model: custom.modelUrl,
            model_id: id,
            model_lib: custom.modelLibUrl,
          },
        ],
      },
    } as any);
  }
  return webllm.CreateMLCEngine(id, { initProgressCallback });
};

let factory: EngineFactory = defaultFactory;
const loading = new Map<string, Promise<MLCEngine>>();

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
  if (loading.has(id)) {
    await loading.get(id);
    return;
  }

  if (opts?.signal?.aborted) {
    throw new SmolError("Model load aborted");
  }

  const factoryPromise = factory(id, opts, custom);
  loading.set(id, factoryPromise);

  // Race the load against an abort; if abort wins, also unload the engine
  // when it eventually arrives so we don't leak GPU memory.
  if (opts?.signal) {
    const signal = opts.signal;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new SmolError("Model load aborted")),
        { once: true },
      );
    });

    // Cleanup the engine if it arrives after abort.
    factoryPromise
      .then((engine) => {
        if (signal.aborted && !engines.has(id)) {
          engine.unload().catch(() => {});
        }
      })
      .catch(() => {});

    try {
      const engine = await Promise.race([factoryPromise, abortPromise]);
      engines.set(id, engine);
    } finally {
      loading.delete(id);
    }
    return;
  }

  try {
    const engine = await factoryPromise;
    engines.set(id, engine);
  } finally {
    loading.delete(id);
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
