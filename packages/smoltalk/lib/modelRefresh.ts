/**
 * Fetching refreshed model data from a remote or on-disk catalog.
 *
 * Split out of modelData.ts so that module — and therefore models.ts, and
 * therefore the model registry — stays pure. This file reaches the platform
 * through #platform: a `file:` URL works on Node and throws in a browser,
 * and `https:` works on both.
 */
import { env, readTextFromFileUrl } from "#platform";
import { utf8ByteLength } from "./util/base64.js";
import { parseModelDataBlob, type ModelDataBlob } from "./modelData.js";
import { Result, failure } from "./types/result.js";

export const DEFAULT_MODEL_DATA_URL =
  "https://raw.githubusercontent.com/egonSchiele/smoltalk/main/packages/smoltalk/data/model-data.json";

const MAX_BYTES = 10_000_000;
const TIMEOUT_MS = 15_000;

export type Fetcher = (url: string, signal?: AbortSignal) => Promise<string>;

export type RefreshOptions = {
  url?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
};

function enforceSizeCap(text: string): string {
  if (utf8ByteLength(text) > MAX_BYTES) {
    throw new Error(`Model data exceeds the ${MAX_BYTES}-byte cap`);
  }
  return text;
}

// The default fetcher supports remote https:// URLs and local file:// URLs.
// file:// lets users point at a self-hosted on-disk catalog (and powers the
// integration test). Any other scheme is rejected.
async function defaultFetcher(url: string, signal?: AbortSignal): Promise<string> {
  if (url.startsWith("file://")) {
    return enforceSizeCap(await readTextFromFileUrl(url));
  }
  if (url.startsWith("https://")) {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return enforceSizeCap(await res.text());
  }
  throw new Error(
    `Unsupported model-data URL scheme (expected https:// or file://): ${url}`,
  );
}

export async function refreshModels(
  opts: RefreshOptions = {},
): Promise<Result<ModelDataBlob>> {
  let url = DEFAULT_MODEL_DATA_URL;
  const fromEnv = env("SMOLTALK_MODEL_DATA_URL");
  if (fromEnv) {
    url = fromEnv;
  }
  if (opts.url) {
    url = opts.url;
  }

  let fetcher = defaultFetcher;
  if (opts.fetcher) {
    fetcher = opts.fetcher;
  }

  // Always drive the fetcher off our own controller so the timeout can abort
  // it. Forward an externally-supplied signal into the same controller so both
  // the timeout and the caller can cancel.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort();
    } else {
      opts.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  let raw: string;
  try {
    raw = await fetcher(url, controller.signal);
  } catch (err) {
    return failure(`Could not fetch model data from ${url}: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  return parseModelDataBlob(raw);
}
