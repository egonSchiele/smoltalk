# llama-cpp Optional Peer Dependency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `text({ provider: "llama-cpp", model: "/path/to/model.gguf" })` works out of the box when smoltalk-llama-cpp is installed — smoltalk lazily loads and registers the plugin itself, with instructive errors when it's missing.

**Architecture:** smoltalk declares `smoltalk-llama-cpp` as an *optional* peer dependency and gains a loader module (`lib/clients/llamaCppLoader.ts`) that dynamically imports, validates, and registers the plugin once per process. `textSync`/`textStream` trigger the loader when `config.provider === "llama-cpp"` and no `llama-cpp` provider is registered yet. The plugin gains path-shaped-model support in its constructor and a `resolveModel` download helper.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), vitest, pnpm workspace. Spec: `packages/smoltalk/2026-08-11-llama-cpp-optional-peer-spec.md` (read it if anything here seems ambiguous — it is the authority).

## Global Constraints

- **Branch first, never commit to main:** run `git checkout -b llama-cpp-optional-peer` before Task 1's first commit. All work lands via PR (repo owner's standing rule).
- **No ternaries, no conditional spreads** — use explicit `if` statements (repo owner's standing style rule).
- **ESM imports:** every relative import ends in `.js` (e.g. `from "../client.js"`), even in TypeScript source.
- **Peer range, verbatim:** smoltalk peers on `"smoltalk-llama-cpp": ">=0.2.0 <1.0.0"` with `peerDependenciesMeta: { "smoltalk-llama-cpp": { "optional": true } }`. Do NOT touch smoltalk's `dependencies` and do NOT change the plugin's existing peer block (`"smoltalk": ">=0.5.1 <1.0.0"`).
- **No new workspace edges:** never add smoltalk-llama-cpp to smoltalk's devDependencies (or any smoltalk dependency on the plugin beyond the optional peer). The plugin already dev-depends on smoltalk (`workspace:*`); that stays.
- **Versions at the end:** plugin → `0.2.0`, smoltalk → `0.11.0` (Task 7 only; don't bump earlier).
- **Fixed provider name:** the registry name is exactly `"llama-cpp"`.
- **Error copy is part of the spec.** Use the exact strings given in each task.
- **Test commands:** run from the owning package directory: `cd /Users/adityabhargava/smoltalk/packages/smoltalk` (or `.../packages/smoltalk-llama-cpp`), then `pnpm exec vitest run <file>` (the bare `pnpm test` script starts watch mode — don't use it in automation). Typecheck with `pnpm typecheck`.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
packages/smoltalk/
├── package.json                          # MODIFY (Task 2: peer block; Task 7: version)
├── lib/client.ts                         # MODIFY (Task 1: hasProvider + specialized error)
├── lib/client.hasProvider.test.ts        # CREATE (Task 1)
├── lib/clients/llamaCppLoader.ts         # CREATE (Task 2: the loader — sole owner of plugin loading)
├── lib/clients/llamaCppLoader.test.ts    # CREATE (Task 2)
├── lib/functions.ts                      # MODIFY (Task 3: auto-load guard)
├── lib/functions.llamaCpp.test.ts        # CREATE (Task 3)
├── lib/index.ts                          # MODIFY (Task 2: export loadLlamaCpp + LlamaCppModule)
├── CHANGELOG.md                          # MODIFY (Task 7)
└── README.md                             # MODIFY (Task 7)

packages/smoltalk-llama-cpp/
├── package.json                          # MODIFY (Task 7: version)
├── lib/llamaCpp.ts                       # MODIFY (Task 4: model classification in constructor)
├── lib/llamaCpp.test.ts                  # MODIFY (Task 4: derivation/rejection tests)
├── lib/resolveModel.ts                   # CREATE (Task 5)
├── lib/resolveModel.test.ts              # CREATE (Task 5)
├── lib/index.ts                          # MODIFY (Task 5: export resolveModel)
├── lib/loader.integration.test.ts        # CREATE (Task 6)
├── CHANGELOG.md                          # MODIFY (Task 7)
└── README.md                             # MODIFY (Task 7)
```

---

### Task 1: `hasProvider` + specialized `getClient` error (smoltalk)

**Files:**
- Modify: `packages/smoltalk/lib/client.ts`
- Test: `packages/smoltalk/lib/client.hasProvider.test.ts` (create)

**Interfaces:**
- Consumes: existing `registeredProviders` registry, `registerProvider`, `unregisterProvider`, `SmolError` — all already in `client.ts`.
- Produces: `export function hasProvider(providerName: string): boolean` (used by Tasks 2 and 3), and a `"llama-cpp"`-specific unknown-provider error in `getClient`.

- [ ] **Step 0: Create the working branch**

```bash
cd /Users/adityabhargava/smoltalk
git checkout -b llama-cpp-optional-peer
```

- [ ] **Step 1: Write the failing test**

Create `packages/smoltalk/lib/client.hasProvider.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import {
  getClient,
  hasProvider,
  registerProvider,
  unregisterProvider,
} from "./client.js";
import { TestProvider } from "./testing/index.js";

afterEach(() => {
  unregisterProvider("llama-cpp");
});

describe("hasProvider", () => {
  it("is false for unregistered names and for built-ins alike", () => {
    expect(hasProvider("llama-cpp")).toBe(false);
    // Built-in switch cases are not its concern — only the custom registry.
    expect(hasProvider("openai")).toBe(false);
  });

  it("reflects register/unregister", () => {
    registerProvider("llama-cpp", TestProvider);
    expect(hasProvider("llama-cpp")).toBe(true);
    unregisterProvider("llama-cpp");
    expect(hasProvider("llama-cpp")).toBe(false);
  });
});

describe("getClient unknown-provider error for llama-cpp", () => {
  it("points at auto-loading and loadLlamaCpp instead of registerProvider", () => {
    expect(() =>
      getClient({ model: "/models/x.gguf", provider: "llama-cpp", messages: [] }),
    ).toThrow(/loads automatically.*loadLlamaCpp/s);
  });

  it("keeps the generic message for other unknown providers", () => {
    expect(() =>
      getClient({ model: "m", provider: "no-such-provider", messages: [] }),
    ).toThrow(/registerProvider/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk
pnpm exec vitest run lib/client.hasProvider.test.ts
```

Expected: FAIL — `hasProvider` is not exported, and the llama-cpp error test gets the generic `registerProvider` message.

- [ ] **Step 3: Implement**

In `packages/smoltalk/lib/client.ts`, add directly after the `unregisterProvider` function (after line 44):

```typescript
/**
 * True when `providerName` has been registered via registerProvider().
 * Built-in providers (the switch cases in getClient) are not its concern —
 * this only consults the custom registry.
 */
export function hasProvider(providerName: string): boolean {
  return providerName in registeredProviders;
}
```

In the same file, replace the `default:` case of `getClient`'s switch (currently lines 120–127) with:

```typescript
    default:
      if (provider in registeredProviders) {
        const ClientClass = registeredProviders[provider];
        return new ClientClass(clientConfig);
      }
      if (provider === "llama-cpp") {
        throw new SmolError(
          "The llama-cpp provider loads automatically when called through text()/textSync()/textStream(). " +
            "For direct getClient() use, await loadLlamaCpp() first (install smoltalk-llama-cpp if it is missing).",
        );
      }
      throw new SmolError(
        `Model provider ${provider} is not supported. To use a custom provider, register it first via registerProvider(name, ClientClass).`,
      );
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run lib/client.hasProvider.test.ts
```

Expected: PASS (4 tests). Also run `pnpm exec vitest run lib/client.test.ts` to confirm no existing client test regressed, and `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk/lib/client.ts packages/smoltalk/lib/client.hasProvider.test.ts
git commit -m "llama-cpp loader groundwork: hasProvider() + specialized getClient error

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The loader module + optional peer declaration (smoltalk)

**Files:**
- Create: `packages/smoltalk/lib/clients/llamaCppLoader.ts`
- Test: `packages/smoltalk/lib/clients/llamaCppLoader.test.ts` (create)
- Modify: `packages/smoltalk/lib/index.ts` (public exports)
- Modify: `packages/smoltalk/package.json` (peer block)

**Interfaces:**
- Consumes: `hasProvider(name: string): boolean`, `registerProvider(name, ClientClass)` from `../client.js` (Task 1); `SmolError` from `../smolError.js` (its constructor takes `(message: string, options?: { cause?: unknown })`); `BaseClient` type from `./baseClient.js`.
- Produces:
  - `loadLlamaCpp(options?: { entryPath?: string }): Promise<LlamaCppModule>` — used by Task 3's guard, Task 6's integration test, and external hosts.
  - `type LlamaCppModule = { LlamaCPP: typeof BaseClient; resolveModel: (uriOrPath: string, cacheDir: string) => Promise<string> }`.
  - `_setImportForTests(fn?: (specifier: string) => Promise<Record<string, unknown>>): void` — test-only seam, resets the load cache; NOT exported from `lib/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/smoltalk/lib/clients/llamaCppLoader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _setImportForTests, loadLlamaCpp } from "./llamaCppLoader.js";
import {
  getClient,
  hasProvider,
  registerProvider,
  unregisterProvider,
} from "../client.js";
import { TestProvider } from "../testing/index.js";

const fakeResolveModel = async (uriOrPath: string, _cacheDir: string) =>
  uriOrPath;

function fakeModule(): Record<string, unknown> {
  return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
}

function moduleNotFound(packageName: string): Error {
  const err = new Error(
    `Cannot find package '${packageName}' imported from /app/node_modules/smoltalk/dist/clients/llamaCppLoader.js`,
  );
  (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

beforeEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

afterEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

describe("loadLlamaCpp", () => {
  it("imports, registers under llama-cpp, and returns the module", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    const mod = await loadLlamaCpp();

    expect(importCount).toBe(1);
    expect(mod.LlamaCPP).toBe(TestProvider);
    expect(typeof mod.resolveModel).toBe("function");
    expect(hasProvider("llama-cpp")).toBe(true);
  });

  it("caches a successful load (second call performs no import)", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    await loadLlamaCpp();
    await loadLlamaCpp();

    expect(importCount).toBe(1);
  });

  it("shares one in-flight load between concurrent first calls", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    const [a, b] = await Promise.all([loadLlamaCpp(), loadLlamaCpp()]);

    expect(importCount).toBe(1);
    expect(a).toBe(b);
  });

  it("clears the cache on failure so a later call can retry", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      if (importCount === 1) {
        throw new Error("transient breakage");
      }
      return fakeModule();
    });

    await expect(loadLlamaCpp()).rejects.toThrow(/transient breakage/);
    const mod = await loadLlamaCpp();

    expect(importCount).toBe(2);
    expect(mod.LlamaCPP).toBe(TestProvider);
  });

  it("gives the install hint when the package itself is missing", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound("smoltalk-llama-cpp");
    });

    await expect(loadLlamaCpp()).rejects.toThrow(
      /Install it \(npm i smoltalk-llama-cpp\) and try again/,
    );
  });

  it("wraps other failures without the install hint (broken import chain)", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound("node-llama-cpp");
    });

    const failure = (await loadLlamaCpp().catch((e: Error) => e)) as Error;

    expect(failure.message).toMatch(/Failed to load smoltalk-llama-cpp/);
    expect(failure.message).toMatch(/node-llama-cpp/);
    expect(failure.message).not.toMatch(/npm i smoltalk-llama-cpp\)/);
  });

  it("rejects a module without a LlamaCPP export as not-the-package", async () => {
    _setImportForTests(async () => ({ somethingElse: true }));

    await expect(loadLlamaCpp()).rejects.toThrow(/does not export LlamaCPP/);
  });

  it("rejects a 0.1.x-shaped module (no resolveModel) with the upgrade hint", async () => {
    _setImportForTests(async () => ({ LlamaCPP: TestProvider }));

    await expect(loadLlamaCpp()).rejects.toThrow(
      /too old for this version of smoltalk.*>=0\.2\.0/s,
    );
  });

  it("leaves a pre-existing registration untouched but still returns the module", async () => {
    class PreRegistered extends TestProvider {}
    registerProvider("llama-cpp", PreRegistered);
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    const mod = await loadLlamaCpp();

    expect(importCount).toBe(1);
    expect(mod.LlamaCPP).toBe(TestProvider);
    const client = getClient({
      model: "any-model",
      provider: "llama-cpp",
      messages: [],
    });
    expect(client).toBeInstanceOf(PreRegistered);
  });

  it("re-registers from the cached module after unregisterProvider", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    await loadLlamaCpp();
    unregisterProvider("llama-cpp");
    expect(hasProvider("llama-cpp")).toBe(false);

    await loadLlamaCpp();

    expect(importCount).toBe(1);
    expect(hasProvider("llama-cpp")).toBe(true);
  });

  it("imports from entryPath as a file URL when given", async () => {
    const seen: string[] = [];
    _setImportForTests(async (specifier) => {
      seen.push(specifier);
      return fakeModule();
    });

    await loadLlamaCpp({
      entryPath: "/opt/plugins/smoltalk-llama-cpp/dist/index.js",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith("file://")).toBe(true);
    expect(seen[0]).toContain("/opt/plugins/smoltalk-llama-cpp/dist/index.js");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk
pnpm exec vitest run lib/clients/llamaCppLoader.test.ts
```

Expected: FAIL — module `./llamaCppLoader.js` does not exist.

- [ ] **Step 3: Implement the loader**

Create `packages/smoltalk/lib/clients/llamaCppLoader.ts` (complete file):

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run lib/clients/llamaCppLoader.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 5: Add public exports and the peer declaration**

In `packages/smoltalk/lib/index.ts`, add after the `export * from "./functions.js";` line:

```typescript
// Explicit (not `export *`) so the test-only `_setImportForTests` stays off the public surface.
export { loadLlamaCpp } from "./clients/llamaCppLoader.js";
export type { LlamaCppModule } from "./clients/llamaCppLoader.js";
```

In `packages/smoltalk/package.json`, add these two top-level blocks after `"devDependencies"` (keep `"dependencies"` untouched):

```json
  "peerDependencies": {
    "smoltalk-llama-cpp": ">=0.2.0 <1.0.0"
  },
  "peerDependenciesMeta": {
    "smoltalk-llama-cpp": {
      "optional": true
    }
  }
```

Then regenerate the workspace lockfile so `pnpm install --frozen-lockfile` stays valid against the changed manifest:

```bash
cd /Users/adityabhargava/smoltalk
pnpm install --lockfile-only
git diff --stat pnpm-lock.yaml
```

Commit `pnpm-lock.yaml` with this task. If the diff turns out empty (pnpm may not record importer peer metadata in this lockfile version), say so in the commit body and move on — the point is that the lockfile was regenerated, not that it must change.

- [ ] **Step 6: Verify the whole package still builds and type-checks**

```bash
pnpm typecheck && pnpm exec vitest run lib/exports.test.ts lib/index.test.ts
```

Expected: typecheck clean; existing export/index tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk/lib/clients/llamaCppLoader.ts \
        packages/smoltalk/lib/clients/llamaCppLoader.test.ts \
        packages/smoltalk/lib/index.ts \
        packages/smoltalk/package.json \
        pnpm-lock.yaml
git commit -m "Add loadLlamaCpp(): lazy loader for optional smoltalk-llama-cpp peer

Imports and registers the plugin once per process, with distinct errors
for missing package / too-old plugin / broken import chain. Declares the
optional peer dependency that makes the bare import resolvable under pnpm.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Auto-load guard in `textSync` / `textStream` (smoltalk)

**Files:**
- Modify: `packages/smoltalk/lib/functions.ts`
- Test: `packages/smoltalk/lib/functions.llamaCpp.test.ts` (create — separate file from `functions.test.ts` so loader-state resets stay isolated)

**Interfaces:**
- Consumes: `loadLlamaCpp()` and `_setImportForTests` (Task 2), `hasProvider` (Task 1).
- Produces: no new API. Behavior change only: `text()`/`textSync()`/`textStream()` with `provider: "llama-cpp"` auto-load the plugin unless a `llama-cpp` provider is already registered.

- [ ] **Step 1: Write the failing tests**

Create `packages/smoltalk/lib/functions.llamaCpp.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { textSync, textStream } from "./functions.js";
import { _setImportForTests } from "./clients/llamaCppLoader.js";
import { registerProvider, unregisterProvider } from "./client.js";
import { TestProvider } from "./testing/index.js";
import { userMessage } from "./classes/message/index.js";
import type { StreamChunk } from "./types.js";

const fakeResolveModel = async (uriOrPath: string, _cacheDir: string) =>
  uriOrPath;

function llamaConfig() {
  return {
    model: "/models/llama-3.gguf",
    provider: "llama-cpp",
    metadata: { testResponse: "local hello" },
    messages: [userMessage("hi")],
  };
}

function moduleNotFound(): Error {
  const err = new Error(
    "Cannot find package 'smoltalk-llama-cpp' imported from /app/node_modules/smoltalk/dist/clients/llamaCppLoader.js",
  );
  (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

beforeEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

afterEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

describe("auto-load on provider: llama-cpp", () => {
  it("textSync loads the plugin once, then serves the call", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const result = await textSync(llamaConfig());

    expect(importCount).toBe(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe("local hello");
    }
  });

  it("concurrent first calls share one load", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const [a, b] = await Promise.all([
      textSync(llamaConfig()),
      textSync(llamaConfig()),
    ]);

    expect(importCount).toBe(1);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  it("textStream loads the plugin and streams", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const chunks: StreamChunk[] = [];
    for await (const c of textStream(llamaConfig())) {
      chunks.push(c);
    }

    expect(importCount).toBe(1);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  it("a pre-existing llama-cpp registration suppresses the import entirely", async () => {
    registerProvider("llama-cpp", TestProvider);
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const result = await textSync(llamaConfig());

    expect(importCount).toBe(0);
    expect(result.success).toBe(true);
  });

  it("missing package: textSync rejects with the install hint", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound();
    });

    await expect(textSync(llamaConfig())).rejects.toThrow(
      /Install it \(npm i smoltalk-llama-cpp\)/,
    );
  });

  it("missing package: textStream throws from the first next(), not an error chunk", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound();
    });

    const gen = textStream(llamaConfig());

    await expect(gen.next()).rejects.toThrow(
      /Install it \(npm i smoltalk-llama-cpp\)/,
    );
  });

  it("recovers after unregisterProvider: next call re-registers from cache", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const first = await textSync(llamaConfig());
    expect(first.success).toBe(true);
    unregisterProvider("llama-cpp");

    const second = await textSync(llamaConfig());

    expect(importCount).toBe(1);
    expect(second.success).toBe(true);
  });

  it("other providers never touch the loader", async () => {
    registerProvider("other-provider", TestProvider);
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const result = await textSync({
      model: "any-model",
      provider: "other-provider",
      metadata: { testResponse: "hi" },
      messages: [userMessage("x")],
    });

    expect(importCount).toBe(0);
    expect(result.success).toBe(true);
    unregisterProvider("other-provider");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk
pnpm exec vitest run lib/functions.llamaCpp.test.ts
```

Expected: FAIL — the llama-cpp calls throw `getClient`'s specialized error (Task 1) because nothing loads the plugin yet. The pre-existing-registration test and other-providers test may already pass; that's fine.

- [ ] **Step 3: Implement the guard**

In `packages/smoltalk/lib/functions.ts`:

Change the `getClient` import (line 6) to also pull `hasProvider`, and add the loader import:

```typescript
import { getClient, hasProvider } from "./client.js";
import { loadLlamaCpp } from "./clients/llamaCppLoader.js";
```

Replace the bodies of `textSync` and `textStream` (the `text()` dispatcher above them is untouched):

```typescript
export async function textSync(
  config: SmolConfig,
): Promise<Result<PromptResult>> {
  if (config.provider === "llama-cpp" && !hasProvider("llama-cpp")) {
    await loadLlamaCpp();
  }
  config.messages = fixMessagesIfNecessary(config.messages);
  return getClient(config).textSync(config);
}

export async function* textStream(
  config: SmolConfig,
): AsyncGenerator<StreamChunk> {
  if (config.provider === "llama-cpp" && !hasProvider("llama-cpp")) {
    await loadLlamaCpp();
  }
  config.messages = fixMessagesIfNecessary(config.messages);
  yield* getClient(config).textStream(config);
}
```

Note (spec §3): the trigger is the explicit provider name only — llama-cpp models are arbitrary `.gguf` paths that can never be inferred from the model registry. In `textStream` the guard runs on the first `next()` (async generator bodies are lazy); that is the intended surfacing point for the install-hint error.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run lib/functions.llamaCpp.test.ts lib/functions.test.ts
```

Expected: PASS — all new tests plus the existing `functions.test.ts` suite. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk/lib/functions.ts packages/smoltalk/lib/functions.llamaCpp.test.ts
git commit -m "Auto-load smoltalk-llama-cpp on first provider: llama-cpp call

text()/textSync()/textStream() now trigger loadLlamaCpp() when the
provider is llama-cpp and nothing is registered under that name yet, so
a pre-existing consumer registration keeps working unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Constructor model classification (smoltalk-llama-cpp)

**Files:**
- Modify: `packages/smoltalk-llama-cpp/lib/llamaCpp.ts` (constructor at lines 36–49, plus the three `acquireModelEntry` call sites at lines 58, 216, 331)
- Test: `packages/smoltalk-llama-cpp/lib/llamaCpp.test.ts` (append)

**Interfaces:**
- Consumes: nothing new from other tasks (this package change is independent of Tasks 1–3).
- Produces: `LlamaCPP` accepts a path-shaped `config.model`; rejects URI-shaped models. Adds private fields `modelDir: string` (exists) and `modelFile: string` (new — the bare filename passed to `acquireModelEntry` and `Model`). Task 6's integration test relies on the path-shaped form working.

- [ ] **Step 1: Write the failing tests**

Append to `packages/smoltalk-llama-cpp/lib/llamaCpp.test.ts`:

```typescript
describe("LlamaCPP model classification (no explicit llamaCppModelDir)", () => {
  it("splits a path-shaped model into dir + file", () => {
    const client = new LlamaCPP({ model: "/models/llama-3.gguf", messages: [] });
    expect((client as any).modelDir).toBe("/models");
    expect((client as any).modelFile).toBe("llama-3.gguf");
  });

  it("derives dir '/' for a root-level path", () => {
    const client = new LlamaCPP({ model: "/llama-3.gguf", messages: [] });
    expect((client as any).modelDir).toBe("/");
    expect((client as any).modelFile).toBe("llama-3.gguf");
  });

  it("classifies Windows drive-letter paths as paths, not URIs", () => {
    const client = new LlamaCPP({
      model: "C:\\models\\llama-3.gguf",
      messages: [],
    });
    expect((client as any).modelDir).toBe("C:\\models");
    expect((client as any).modelFile).toBe("llama-3.gguf");
  });

  it("rejects URI-shaped models with a resolveModel pointer", () => {
    expect(
      () => new LlamaCPP({ model: "hf:org/repo/llama-3.gguf", messages: [] }),
    ).toThrow(/local \.gguf path.*resolveModel\(\)/s);
  });

  it("bare filename without metadata still requires llamaCppModelDir", () => {
    expect(
      () => new LlamaCPP({ model: "llama-3.gguf", messages: [] }),
    ).toThrow(/metadata\.llamaCppModelDir is required/);
  });

  it("explicit llamaCppModelDir wins: model is used as-is, no classification", () => {
    const client = new LlamaCPP({
      model: "hf:org/repo/llama-3.gguf",
      messages: [],
      metadata: { llamaCppModelDir: "/explicit" },
    });
    expect((client as any).modelDir).toBe("/explicit");
    expect((client as any).modelFile).toBe("hf:org/repo/llama-3.gguf");
  });
});
```

(The `(client as any)` reaches the private fields deliberately — the split result has no public surface, and this keeps the fields private.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk-llama-cpp
pnpm exec vitest run lib/llamaCpp.test.ts
```

Expected: the four existing constructor tests PASS; every new test FAILS (path-shaped models currently throw `metadata.llamaCppModelDir is required`, and `modelFile` doesn't exist).

- [ ] **Step 3: Implement**

In `packages/smoltalk-llama-cpp/lib/llamaCpp.ts`:

Add above the class declaration:

```typescript
/**
 * Two-plus characters before the colon, so Windows drive-letter paths
 * (C:\models\x.gguf) are classified as paths, not URIs.
 */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
```

Replace the constructor (currently lines 36–49) and add the `modelFile` field next to `modelDir`:

```typescript
  private modelDir: string;
  private modelFile: string;
  private model: Model;
  private logger: ReturnType<typeof getLogger>;

  constructor(config: SmolConfig) {
    super(config);
    let modelDir = config.metadata?.llamaCppModelDir as string | undefined;
    let modelFile = config.model;

    // Explicit metadata wins: when llamaCppModelDir is present, config.model
    // is used as-is and no classification happens at all.
    if (!modelDir) {
      if (URI_SCHEME.test(modelFile)) {
        throw new Error(
          `smoltalk-llama-cpp: llama-cpp needs a local .gguf path. ` +
            `To download or resolve "${modelFile}", call resolveModel() first ` +
            `and pass its result as the model.`,
        );
      }
      const sepIndex = Math.max(
        modelFile.lastIndexOf("/"),
        modelFile.lastIndexOf("\\"),
      );
      if (sepIndex !== -1) {
        modelDir = modelFile.slice(0, sepIndex);
        if (modelDir === "") {
          modelDir = "/";
        }
        modelFile = modelFile.slice(sepIndex + 1);
      }
    }

    if (!modelDir) {
      throw new Error(
        "smoltalk-llama-cpp: metadata.llamaCppModelDir is required. " +
          "Pass the directory containing your .gguf models in config.metadata, " +
          'e.g. text({ ..., metadata: { llamaCppModelDir: "./models" } }), ' +
          "or pass a full .gguf path as the model.",
      );
    }
    this.model = new Model(modelFile);
    this.modelDir = modelDir;
    this.modelFile = modelFile;
    this.logger = getLogger();
  }
```

(Manual `lastIndexOf` split rather than `path.dirname`/`path.basename` so `\`-separated paths split identically on every platform — POSIX `path.basename` won't split on `\`.)

Then update the three `acquireModelEntry` call sites — in `setup()` (line 58), `_textSync` (line 216), and `_textStream` (line 331) — from:

```typescript
await acquireModelEntry(this.modelDir, this.config.model);
```

to:

```typescript
await acquireModelEntry(this.modelDir, this.modelFile);
```

(`this.config.model` may now be a full path; `this.modelFile` is always the bare filename the registry expects. In `_textSync`/`_textStream` keep the `const entry =` assignment.)

Finally: the top-of-file `import path from "path";` (line 28) has no remaining uses after this change — search the file for `path.` and delete the import if nothing else uses it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run lib/llamaCpp.test.ts && pnpm typecheck
```

Expected: PASS (all constructor tests, old and new); typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk-llama-cpp/lib/llamaCpp.ts packages/smoltalk-llama-cpp/lib/llamaCpp.test.ts
git commit -m "LlamaCPP: accept a .gguf path as the model

Path-shaped models are split into dir + filename (explicit metadata
still wins); URI-shaped models (hf:, https:) are rejected with an error
pointing at resolveModel() instead of being mangled by the split.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `resolveModel` export (smoltalk-llama-cpp)

**Files:**
- Create: `packages/smoltalk-llama-cpp/lib/resolveModel.ts`
- Test: `packages/smoltalk-llama-cpp/lib/resolveModel.test.ts` (create)
- Modify: `packages/smoltalk-llama-cpp/lib/index.ts`

**Interfaces:**
- Consumes: `resolveModelFile` from `node-llama-cpp` (already a direct dependency of this package).
- Produces: `resolveModel(uriOrPath: string, cacheDir: string): Promise<string>` — exported from the package index. This is the export the smoltalk loader's validation requires (Task 2), and what hosts use to download models.

- [ ] **Step 1: Write the failing test**

Create `packages/smoltalk-llama-cpp/lib/resolveModel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveModel } from "./resolveModel.js";

describe("resolveModel", () => {
  it("returns an existing .gguf path unchanged without touching the resolver", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "smoltalk-llama-"));
    const filePath = path.join(dir, "model.gguf");
    // Garbage bytes: if the resolver were consulted it would choke; returning
    // the path unchanged proves the early-exit worked.
    await writeFile(filePath, "not a real gguf");

    await expect(resolveModel(filePath, dir)).resolves.toBe(filePath);
  });
});
```

(Download behavior is not tested — it would hit the network. The thin wrapper delegates to node-llama-cpp's own well-tested `resolveModelFile`.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk-llama-cpp
pnpm exec vitest run lib/resolveModel.test.ts
```

Expected: FAIL — module `./resolveModel.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/smoltalk-llama-cpp/lib/resolveModel.ts` (complete file):

```typescript
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
```

Add to `packages/smoltalk-llama-cpp/lib/index.ts`:

```typescript
export { resolveModel } from "./resolveModel.js";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run lib/resolveModel.test.ts && pnpm typecheck
```

Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk-llama-cpp/lib/resolveModel.ts \
        packages/smoltalk-llama-cpp/lib/resolveModel.test.ts \
        packages/smoltalk-llama-cpp/lib/index.ts
git commit -m "smoltalk-llama-cpp: export resolveModel(uriOrPath, cacheDir)

Thin wrapper over node-llama-cpp's resolveModelFile; existing file paths
are returned unchanged, everything else downloads into cacheDir.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: entryPath registration integration test (smoltalk-llama-cpp)

**Files:**
- Test: `packages/smoltalk-llama-cpp/lib/loader.integration.test.ts` (create)

**Interfaces:**
- Consumes: `loadLlamaCpp`, `hasProvider`, `getClient`, `unregisterProvider` from `smoltalk` (workspace dep — resolves to smoltalk's **dist**, so both packages must be built first); the plugin's own built `dist/index.js` (with Task 4's path-shaped models and Task 5's `resolveModel`) as the `entryPath` target.
- Produces: proof that `loadLlamaCpp({ entryPath })` registers a working class under `"llama-cpp"` end-to-end, with no stubbing. No model inference — the existing heavyweight tests keep covering that.

- [ ] **Step 1: Build both packages (the test imports dist on both sides)**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk && pnpm build
cd /Users/adityabhargava/smoltalk/packages/smoltalk-llama-cpp && pnpm build
```

Expected: both `tsc` runs complete without errors.

- [ ] **Step 2: Write the test**

Create `packages/smoltalk-llama-cpp/lib/loader.integration.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadLlamaCpp, hasProvider, getClient, unregisterProvider } from "smoltalk";

// The loader dynamically imports plain JS, so it must target this package's
// built entry — run `pnpm build` here (and in packages/smoltalk) first.
const distEntry = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "index.js",
);

if (!existsSync(distEntry)) {
  throw new Error(
    "loader.integration.test.ts needs built dists: run `pnpm build` in " +
      "packages/smoltalk and packages/smoltalk-llama-cpp before running tests.",
  );
}

describe("loadLlamaCpp({ entryPath }) integration", () => {
  afterEach(() => {
    unregisterProvider("llama-cpp");
  });

  it("registers a working class under llama-cpp from an explicit entry path", async () => {
    const mod = await loadLlamaCpp({ entryPath: distEntry });

    expect(typeof mod.resolveModel).toBe("function");
    expect(hasProvider("llama-cpp")).toBe(true);

    // Path-shaped model, constructed through smoltalk's ordinary factory —
    // no model inference, just proof the registered class is usable.
    const client = getClient({
      model: "/models/fake.gguf",
      provider: "llama-cpp",
      messages: [],
    });
    expect(client.constructor.name).toBe("LlamaCPP");
    expect(typeof client.textSync).toBe("function");
  });
});
```

(An unbuilt dist fails LOUDLY with instructions rather than silently skipping — a skipped test would let routine runs report green without exercising the only real dynamic-import integration coverage. The `constructor.name` check — rather than `instanceof` the lib-source `LlamaCPP` — is deliberate: the dist class and the vitest-transformed lib class are different objects, and `getClient` duck-types registered classes by design.)

- [ ] **Step 3: Run the test and verify it passes**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk-llama-cpp
pnpm exec vitest run lib/loader.integration.test.ts
```

Expected: PASS (1 test). If it fails with the "needs built dists" error, rerun step 1.

- [ ] **Step 4: Run both packages' full suites**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk && pnpm exec vitest run --exclude '**/*.live.test.ts'
cd /Users/adityabhargava/smoltalk/packages/smoltalk-llama-cpp && pnpm exec vitest run
```

Expected: PASS across the board (live tests excluded — they need API keys).

- [ ] **Step 5: Commit**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk-llama-cpp/lib/loader.integration.test.ts
git commit -m "Integration test: loadLlamaCpp entryPath registers a working provider

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Versions, changelogs, READMEs, PR

**Files:**
- Modify: `packages/smoltalk/package.json` (version `0.10.1` → `0.11.0`)
- Modify: `packages/smoltalk-llama-cpp/package.json` (version `0.1.1` → `0.2.0`)
- Modify: `packages/smoltalk/CHANGELOG.md`
- Modify: `packages/smoltalk-llama-cpp/CHANGELOG.md`
- Modify: `packages/smoltalk/README.md`
- Modify: `packages/smoltalk-llama-cpp/README.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–6.
- Produces: release-ready packages. **Publish order matters and is manual (owner runs it):** plugin `0.2.0` must be published before smoltalk `0.11.0` so the peer range is satisfiable at publish time.

- [ ] **Step 1: Bump versions**

In `packages/smoltalk/package.json`: `"version": "0.10.1"` → `"version": "0.11.0"`.
In `packages/smoltalk-llama-cpp/package.json`: `"version": "0.1.1"` → `"version": "0.2.0"`.

- [ ] **Step 2: Add changelog entries**

In `packages/smoltalk/CHANGELOG.md`, insert directly under the `# Changelog` heading (above the `0.10.1` entry), matching the existing entry format:

```markdown
## smoltalk 0.11.0 (2026-08-11)

### Added
- `provider: "llama-cpp"` now auto-loads the optional `smoltalk-llama-cpp` package on first use — install the plugin and local models work with no `registerProvider` wiring. `smoltalk-llama-cpp` is declared as an optional peer dependency (which is also what makes the import resolvable under pnpm's strict layout).
- `loadLlamaCpp({ entryPath? })` — explicit loader for hosts whose plugin install is not resolvable from smoltalk (e.g. globally-installed CLIs). Returns the plugin module (`LlamaCPP`, `resolveModel`); an existing `llama-cpp` registration is left untouched.
- `hasProvider(name)` — true when a custom provider is registered under `name`.
- `type LlamaCppModule` — structural type of the plugin's module.

### Changed
- `getClient` with unknown provider `"llama-cpp"` now explains auto-loading and points at `loadLlamaCpp()` instead of the generic registerProvider hint.
- Requires `smoltalk-llama-cpp` >=0.2.0 for the llama-cpp provider; a 0.1.x install is rejected at load time with an explicit upgrade message.
```

In `packages/smoltalk-llama-cpp/CHANGELOG.md`, read the file first and insert at the top following its existing format, with this content:

```markdown
## smoltalk-llama-cpp 0.2.0 (2026-08-11)

### Added
- `LlamaCPP` accepts a path-shaped `config.model` (e.g. `/models/llama-3.gguf`): the model directory is derived automatically, so `metadata.llamaCppModelDir` is only needed for bare filenames. URI-shaped models (`hf:…`, `https:…`) are rejected with an error pointing at `resolveModel()`.
- `resolveModel(uriOrPath, cacheDir)` — resolves/downloads a model reference to a local `.gguf` path via node-llama-cpp's `resolveModelFile` (CLI progress); existing file paths are returned unchanged.
```

- [ ] **Step 3: Add README sections**

In `packages/smoltalk/README.md`, read the file, find a sensible spot among the feature sections (e.g. near provider docs; end of file is acceptable), and add:

````markdown
## Local models (llama-cpp)

Install the optional plugin and name the provider — no wiring code:

```bash
npm i smoltalk-llama-cpp
```

```typescript
import { textSync, userMessage } from "smoltalk";

const result = await textSync({
  provider: "llama-cpp",
  model: "/path/to/llama-3.gguf",
  messages: [userMessage("Hello!")],
});
```

smoltalk lazily imports and registers the plugin on the first `llama-cpp`
call; if the package is missing you get an install hint instead of a
resolution stack trace. Hosts with unusual layouts (e.g. a globally-installed
CLI with the plugin installed globally beside it) can hand smoltalk the
plugin's entry path explicitly and skip Node resolution:

```typescript
import { loadLlamaCpp } from "smoltalk";

const { resolveModel } = await loadLlamaCpp({
  entryPath: "/path/to/smoltalk-llama-cpp/dist/index.js",
});
// resolveModel downloads hf: URIs (and returns local paths unchanged):
const modelPath = await resolveModel("hf:org/repo/model.gguf", "/models/cache");
```
````

In `packages/smoltalk-llama-cpp/README.md`, read the file and add near the top (after any intro/install section):

````markdown
## Zero-wiring use from smoltalk (>= 0.11.0)

Install this package next to smoltalk and call:

```typescript
import { textSync, userMessage } from "smoltalk";

await textSync({
  provider: "llama-cpp",
  model: "/path/to/model.gguf",
  messages: [userMessage("Hello!")],
});
```

smoltalk auto-loads and registers this provider on first use. Manual
`registerProvider` wiring is no longer needed (but still works and takes
precedence over the auto-loader).
````

- [ ] **Step 4: Full verification**

```bash
cd /Users/adityabhargava/smoltalk/packages/smoltalk && pnpm typecheck && pnpm build && pnpm exec vitest run --exclude '**/*.live.test.ts'
cd /Users/adityabhargava/smoltalk/packages/smoltalk-llama-cpp && pnpm typecheck && pnpm build && pnpm exec vitest run
cd /Users/adityabhargava/smoltalk/packages/readme-check && pnpm check
```

Expected: everything green, including `readme-check` (it validates README code blocks against the workspace builds — this is what catches a README snippet that doesn't match the real API). Paste the final test-summary lines into the commit/PR description.

- [ ] **Step 5: Commit and open the PR**

```bash
cd /Users/adityabhargava/smoltalk
git add packages/smoltalk/package.json packages/smoltalk/CHANGELOG.md packages/smoltalk/README.md \
        packages/smoltalk-llama-cpp/package.json packages/smoltalk-llama-cpp/CHANGELOG.md packages/smoltalk-llama-cpp/README.md
git commit -m "Release prep: smoltalk 0.11.0, smoltalk-llama-cpp 0.2.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin llama-cpp-optional-peer
gh pr create --title "llama-cpp as optional peer: smoltalk auto-loads the plugin" --body "$(cat <<'EOF'
Implements packages/smoltalk/2026-08-11-llama-cpp-optional-peer-spec.md:

- smoltalk declares smoltalk-llama-cpp as an **optional** peer dependency and lazily loads/registers it on the first \`provider: "llama-cpp"\` call — no registerProvider wiring for consumers.
- Distinct failures: missing package → install hint; 0.1.x plugin → upgrade hint; broken import chain → wrapped real error. Pre-existing \`llama-cpp\` registrations keep working unchanged (auto-load skips entirely).
- \`loadLlamaCpp({ entryPath })\` escape hatch for globally-installed hosts; \`hasProvider(name)\` registry introspection.
- Plugin: \`LlamaCPP\` accepts path-shaped models (URI-shaped rejected with a resolveModel pointer); new \`resolveModel(uriOrPath, cacheDir)\` export.
- Versions: smoltalk 0.11.0, smoltalk-llama-cpp 0.2.0. **Publish the plugin first** so the peer range is satisfiable.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge (owner-run, not part of this plan)

Publish order (spec "Release sequencing"): `smoltalk-llama-cpp` 0.2.0 first, then `smoltalk` 0.11.0 (`make publish` handles build + publish per package). The agency-lang cleanup PRs listed at the end of the spec come after the smoltalk release.
