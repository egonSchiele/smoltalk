import { pathToFileURL } from "url";
import type { BaseClient } from "./baseClient.js";
import { hasProvider, registerProvider } from "../client.js";
import { SmolError } from "../smolError.js";

/**
 * Minimal structural view of smoltalk-llama-cpp's module. Declared here (not
 * imported from the plugin) so smoltalk compiles without the plugin installed
 * and the workspace gains no build-order cycle.
 */
export type LlamaCppModule = {
  LlamaCPP: typeof BaseClient;
  resolveModel: (uriOrPath: string, cacheDir: string) => Promise<string>;
};

type ImportFn = (specifier: string) => Promise<Record<string, unknown>>;

const realImport: ImportFn = (specifier) => import(specifier);

let importFn: ImportFn = realImport;
let cachedLoad: Promise<LlamaCppModule> | undefined;

/**
 * Test-only: swap the dynamic import (pass undefined to restore the real one)
 * and clear the load cache. Deliberately NOT exported from the package index.
 */
export function _setImportForTests(fn?: ImportFn): void {
  if (fn) {
    importFn = fn;
  } else {
    importFn = realImport;
  }
  cachedLoad = undefined;
}

/**
 * Load and register the optional smoltalk-llama-cpp plugin, once per process.
 *
 * - Without options, imports the bare specifier "smoltalk-llama-cpp" using
 *   Node resolution from smoltalk's location. The optional peer declaration
 *   in package.json is what makes that resolvable under pnpm's strict layout.
 * - `entryPath` is the escape hatch for hosts whose plugin install is not
 *   resolvable from smoltalk (e.g. globally-installed CLIs): the file is
 *   imported directly and Node resolution is skipped. Hosts own discovering
 *   that path; smoltalk never probes global npm roots and reads no env vars.
 * - Registers the module's LlamaCPP class under "llama-cpp" unless that name
 *   is already registered. An existing registration is left untouched, but
 *   the module is still imported, validated, and returned — an existing
 *   registration wins the registry, never the return value. Registration is
 *   re-ensured from the cached module on EVERY call, so a later
 *   unregisterProvider("llama-cpp") is undone by the next load call without
 *   a second import.
 * - Concurrent first calls share one in-flight load. A failed load clears
 *   the cache so a later call can retry (e.g. after installing the package).
 *   A second call with a different entryPath after a successful load returns
 *   the already-loaded module (first load wins).
 */
export function loadLlamaCpp(options?: {
  entryPath?: string;
}): Promise<LlamaCppModule> {
  if (!cachedLoad) {
    const load = doLoad(options?.entryPath);
    cachedLoad = load;
    load.catch(() => {
      if (cachedLoad === load) {
        cachedLoad = undefined;
      }
    });
  }
  // Registration happens on EVERY call, not only inside the first load: a
  // consumer can unregisterProvider("llama-cpp") after a successful load,
  // and the cached module must be re-registered on the next call or the
  // provider stays missing for the life of the process.
  return cachedLoad.then((plugin) => {
    if (!hasProvider("llama-cpp")) {
      registerProvider("llama-cpp", plugin.LlamaCPP);
    }
    return plugin;
  });
}

async function doLoad(entryPath?: string): Promise<LlamaCppModule> {
  let importSource: string;
  if (entryPath) {
    importSource = pathToFileURL(entryPath).href;
  } else {
    importSource = "smoltalk-llama-cpp";
  }

  let mod: Record<string, unknown>;
  try {
    mod = await importFn(importSource);
  } catch (error) {
    if (!entryPath && isPluginNotInstalledError(error)) {
      throw new SmolError(
        "The llama-cpp provider needs the optional smoltalk-llama-cpp package. " +
          "Install it (npm i smoltalk-llama-cpp) and try again.",
        { cause: error },
      );
    }
    throw new SmolError(
      `Failed to load smoltalk-llama-cpp from ${importSource}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (typeof mod.LlamaCPP !== "function") {
    throw new SmolError(
      `The module imported as ${importSource} does not export LlamaCPP — ` +
        "it does not appear to be the smoltalk-llama-cpp package.",
    );
  }
  if (typeof mod.resolveModel !== "function") {
    throw new SmolError(
      "Your installed smoltalk-llama-cpp is too old for this version of smoltalk. " +
        "Upgrade it (npm i smoltalk-llama-cpp@latest; >=0.2.0 required).",
    );
  }

  return mod as unknown as LlamaCppModule;
}

/**
 * True only when the smoltalk-llama-cpp specifier itself failed to resolve —
 * not when the package exists but its own import chain broke (e.g. a
 * node-llama-cpp binary problem), where an install hint would mislead.
 */
function isPluginNotInstalledError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== "ERR_MODULE_NOT_FOUND") {
    return false;
  }
  return errorMessage(error).includes("'smoltalk-llama-cpp'");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
