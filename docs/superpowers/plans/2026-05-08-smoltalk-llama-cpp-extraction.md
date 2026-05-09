# Smoltalk: Extract `node-llama-cpp` to Separate Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert smoltalk to a pnpm workspace monorepo, extract llama-cpp into a new `smoltalk-llama-cpp` package, remove `node-llama-cpp` from smoltalk core's dependencies. Bump core to `0.2.0`, ship the new package at `0.1.0`.

**Architecture:** Six sequential tasks, each leaving the build green. Order: convert to monorepo first (atomic but large), then add the new package, then move llama-cpp code, then strip from core, then verify, then version/docs.

**Tech Stack:** TypeScript, pnpm workspaces, vitest.

**Spec:** `docs/superpowers/specs/2026-05-08-smoltalk-llama-cpp-extraction-design.md`.

**Working directory:** `/Users/adit/smoltalk` for all commands.

**Branch:** create a new branch `extract-llama-cpp` off `main` before starting.

---

## Task 1: Convert to pnpm workspace monorepo

**Goal:** Move existing code into `packages/smoltalk/`. Build/typecheck/test still green via root-level scripts that delegate to the workspace.

**Files to create:**
- `pnpm-workspace.yaml` (root)
- `package.json` (root, workspace + delegating scripts)

**Files to move (preserving git history with `git mv`):**
- `lib/` → `packages/smoltalk/lib/`
- `tests/` → `packages/smoltalk/tests/`
- `tsconfig.json` → `packages/smoltalk/tsconfig.json`
- `package.json` → `packages/smoltalk/package.json`

**Files that stay at root:** `README.md`, `CLAUDE.md`, `TODO.md`, `docs/`, `.gitignore`, `LICENSE` (if present).

- [ ] **Step 1.1: Create branch**

```bash
git checkout main
git pull
git checkout -b extract-llama-cpp
```

- [ ] **Step 1.2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 1.3: Move existing files into `packages/smoltalk/`**

```bash
mkdir -p packages/smoltalk
git mv lib packages/smoltalk/lib
git mv tests packages/smoltalk/tests
git mv tsconfig.json packages/smoltalk/tsconfig.json
git mv package.json packages/smoltalk/package.json
```

Note: existing relative imports (`from "./..."`, `from "../..."`) are unaffected by moving the whole tree together. The `tsconfig.json`'s `"include": ["lib/**/*.ts"]` is still valid because it's relative to the (now moved) tsconfig.

- [ ] **Step 1.4: Create root `package.json`**

Write `/Users/adit/smoltalk/package.json`:

```json
{
  "name": "smoltalk-monorepo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "doc": "pnpm -r doc"
  },
  "devDependencies": {
    "@types/node": "^25.0.3",
    "prettier": "^3.7.4",
    "typedoc": "^0.28.15",
    "typescript": "^5.9.3",
    "vitest": "^4.0.16"
  },
  "packageManager": "pnpm@10.0.0"
}
```

(The `packageManager` field can be omitted if the existing repo doesn't pin pnpm. Skip it if unsure.)

- [ ] **Step 1.5: Trim `packages/smoltalk/package.json`**

Remove `devDependencies` (now lives at root). Keep everything else.

The file should retain: `name`, `version`, `description`, `homepage`, `scripts`, `files`, `exports`, `type`, `types`, `keywords`, `author`, `license`, `dependencies`.

- [ ] **Step 1.6: Install dependencies**

```bash
pnpm install
```

This creates the workspace lockfile at the root and symlinks `packages/smoltalk`.

- [ ] **Step 1.7: Verify**

```bash
pnpm typecheck
pnpm test
pnpm build
```

All three must pass. The 152 existing tests should pass unchanged.

- [ ] **Step 1.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
convert to pnpm workspace monorepo

Move smoltalk code into packages/smoltalk/. Root package.json defines
the workspace; per-package scripts run via 'pnpm -r'. No code changes,
only file moves and config additions.
EOF
)"
```

---

## Task 2: Create `smoltalk-llama-cpp` package skeleton

**Goal:** Create the new package directory with a working `package.json` and `tsconfig.json`. No implementation yet.

**Files to create:**
- `packages/smoltalk-llama-cpp/package.json`
- `packages/smoltalk-llama-cpp/tsconfig.json`
- `packages/smoltalk-llama-cpp/lib/.gitkeep` (to keep the empty dir tracked)

- [ ] **Step 2.1: Create directory and gitkeep**

```bash
mkdir -p packages/smoltalk-llama-cpp/lib
touch packages/smoltalk-llama-cpp/lib/.gitkeep
```

- [ ] **Step 2.2: Write `packages/smoltalk-llama-cpp/package.json`**

```json
{
  "name": "smoltalk-llama-cpp",
  "version": "0.1.0",
  "description": "node-llama-cpp provider for smoltalk",
  "type": "module",
  "scripts": {
    "build": "rm -rf dist && tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "files": ["./dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "keywords": ["smoltalk", "llm", "llama-cpp", "local"],
  "license": "ISC",
  "dependencies": {
    "node-llama-cpp": "^3.17.1"
  },
  "peerDependencies": {
    "smoltalk": "workspace:^"
  }
}
```

The `workspace:^` peer dep tells pnpm to use the local workspace package during development; npm publishes will rewrite this to a real version range.

- [ ] **Step 2.3: Write `packages/smoltalk-llama-cpp/tsconfig.json`**

```json
{
  "extends": "../smoltalk/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./lib"
  },
  "include": ["lib/**/*.ts"],
  "exclude": ["node_modules", "dist", "lib/**/*.test.ts"]
}
```

- [ ] **Step 2.4: Install**

```bash
pnpm install
```

Resolves the new package and links `smoltalk` as a peer.

- [ ] **Step 2.5: Verify**

```bash
pnpm -r typecheck
```

The new package has no source yet but its tsconfig should be valid (typecheck passes trivially because there are no `.ts` files matched).

- [ ] **Step 2.6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
add smoltalk-llama-cpp package skeleton

Empty package set up with peerDependency on smoltalk and dependency on
node-llama-cpp. Implementation in next commit.
EOF
)"
```

---

## Task 3: Move `llamaCpp.ts` to the new package

**Goal:** Physically move the implementation, adjust imports to use `smoltalk` as the dependency, switch from `config.llamaCppModelDir` to `config.metadata?.llamaCppModelDir`, and export `LlamaCPP`.

**Files:**
- Move: `packages/smoltalk/lib/clients/llamaCpp.ts` → `packages/smoltalk-llama-cpp/lib/llamaCpp.ts`
- Create: `packages/smoltalk-llama-cpp/lib/index.ts`

- [ ] **Step 3.1: Move the file**

```bash
git mv packages/smoltalk/lib/clients/llamaCpp.ts packages/smoltalk-llama-cpp/lib/llamaCpp.ts
```

- [ ] **Step 3.2: Adjust imports in `llamaCpp.ts`**

Open `packages/smoltalk-llama-cpp/lib/llamaCpp.ts`. Replace the relative imports with `smoltalk` imports.

The current imports look like:
```ts
import { BaseClient } from "./baseClient.js";
import { ToolCall } from "../classes/ToolCall.js";
import { getLogger } from "../util/logger.js";
import { Model } from "../model.js";
import { ModelName } from "../models.js";
import { sanitizeAttributes } from "../util/util.js";
import {
  CostEstimate,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  success,
  TokenUsage,
} from "../types.js";
import type { Message } from "../classes/message/index.js";
import type { AssistantMessage } from "../classes/message/AssistantMessage.js";
import type { ToolMessage } from "../classes/message/ToolMessage.js";
```

Replace with a single import block from `smoltalk`:

```ts
import {
  BaseClient,
  ToolCall,
  Model,
  ModelName,
  CostEstimate,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  success,
  TokenUsage,
  AssistantMessage,
  ToolMessage,
} from "smoltalk";
import type { Message } from "smoltalk";
```

For `getLogger` and `sanitizeAttributes` — verify these are exported from smoltalk's index. If not, the simplest path is to inline minimal replacements:
- `getLogger` is likely exported (it's used by clients). Search `packages/smoltalk/lib/index.ts` for it.
- `sanitizeAttributes` is in `lib/util/util.ts`. The barrel exports `./util/util.js`. Should be exported.

If either isn't exported, add an export at `packages/smoltalk/lib/index.ts` for them as part of this step.

Run `pnpm --filter smoltalk-llama-cpp typecheck` after this step to surface any unresolved imports — fix them by exporting from smoltalk's barrel, then re-run.

- [ ] **Step 3.3: Switch from `config.llamaCppModelDir` to metadata**

In `packages/smoltalk-llama-cpp/lib/llamaCpp.ts`, find the constructor:

```ts
constructor(config: SmolConfig) {
  super(config);
  if (!config.llamaCppModelDir) {
    throw new Error(
      "llamaCppModelDir is required in the config when using the LlamaCPP client.",
    );
  }
  this.model = new Model(config.model);
  this.modelDir = config.llamaCppModelDir;
  this.logger = getLogger();
}
```

Replace with:

```ts
constructor(config: SmolConfig) {
  super(config);
  const modelDir = config.metadata?.llamaCppModelDir as string | undefined;
  if (!modelDir) {
    throw new Error(
      "metadata.llamaCppModelDir is required when using the LlamaCPP client.",
    );
  }
  this.model = new Model(config.model);
  this.modelDir = modelDir;
  this.logger = getLogger();
}
```

- [ ] **Step 3.4: Create `packages/smoltalk-llama-cpp/lib/index.ts`**

```ts
export { LlamaCPP } from "./llamaCpp.js";
```

- [ ] **Step 3.5: Update `packages/smoltalk-llama-cpp/package.json` `exports`**

The `exports` field already points to `./dist/index.js`. No change needed if it's correct from Task 2.

- [ ] **Step 3.6: Verify the new package builds in isolation**

```bash
pnpm --filter smoltalk-llama-cpp typecheck
pnpm --filter smoltalk-llama-cpp build
```

Both must pass. If `typecheck` complains about unresolved imports from `smoltalk`, fix exports in `packages/smoltalk/lib/index.ts` and retry.

- [ ] **Step 3.7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
move LlamaCPP client to smoltalk-llama-cpp package

Adjust imports to use the smoltalk public API. Read llamaCppModelDir
from config.metadata instead of a top-level config field, since the
field is being removed from SmolConfig in the next commit.
EOF
)"
```

---

## Task 4: Strip llama-cpp from smoltalk core

**Goal:** Remove all references to llama-cpp from `packages/smoltalk/`. After this task, smoltalk core has no knowledge of llama-cpp and `node-llama-cpp` is no longer in its dependency tree.

**Files to modify:**
- `packages/smoltalk/lib/client.ts` — remove import, switch case, re-export
- `packages/smoltalk/lib/models.ts` — remove `"llama-cpp"` from providers array
- `packages/smoltalk/lib/types.ts` — remove `llamaCppModelDir` field
- `packages/smoltalk/package.json` — drop `node-llama-cpp` dep + `pull` script

- [ ] **Step 4.1: Update `packages/smoltalk/lib/client.ts`**

Remove these three lines:

```ts
export * from "./clients/llamaCpp.js";
```

```ts
import { LlamaCPP } from "./clients/llamaCpp.js";
```

And the switch case:

```ts
    case "llama-cpp":
      return new LlamaCPP(clientConfig);
```

After removal, the switch falls through to the `default:` branch for `provider === "llama-cpp"`, which checks `registeredProviders`. Users who register their LlamaCPP via the new package will hit this path.

- [ ] **Step 4.2: Update `packages/smoltalk/lib/models.ts`**

In the `providers` array (lines 2-11), remove `"llama-cpp"`:

```ts
export const providers = [
  "ollama",
  "openai",
  "openai-responses",
  "anthropic",
  "google",
  "replicate",
  "modal",
  "local",
] as const;
```

- [ ] **Step 4.3: Update `packages/smoltalk/lib/types.ts`**

Remove the `llamaCppModelDir` field from `SmolConfig`:

```ts
  /** Directory path for Llama.cpp models. Required when using the Llama.cpp client. */
  llamaCppModelDir?: string;
```

- [ ] **Step 4.4: Update `packages/smoltalk/package.json`**

In `dependencies`, remove the `node-llama-cpp` entry.

In `scripts`, remove the `"pull"` line:

```json
"pull": "node-llama-cpp pull --dir ./models"
```

- [ ] **Step 4.5: Reinstall**

```bash
pnpm install
```

This rewrites the lockfile without `node-llama-cpp` under `packages/smoltalk`. The new package keeps its own `node-llama-cpp` dependency.

- [ ] **Step 4.6: Verify**

```bash
pnpm typecheck
pnpm test
pnpm build
```

All must pass. The existing 152 tests should still pass — none of them exercise llama-cpp.

Verify the dependency tree:

```bash
pnpm --filter smoltalk why node-llama-cpp 2>&1 | head -5
```

Expected: no entries (smoltalk no longer depends on it).

```bash
pnpm --filter smoltalk-llama-cpp why node-llama-cpp 2>&1 | head -5
```

Expected: shows the direct dependency.

- [ ] **Step 4.7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
remove llama-cpp from smoltalk core

Drop the llama-cpp switch case, provider entry, llamaCppModelDir field,
and node-llama-cpp dependency. Local-model users now install
smoltalk-llama-cpp separately and register the provider via
registerProvider("llama-cpp", LlamaCPP).
EOF
)"
```

---

## Task 5: End-to-end verification

**Goal:** Confirm the new package compiles against the now-stripped smoltalk core, and that `registerProvider` correctly routes a `provider: "llama-cpp"` config to the moved class.

- [ ] **Step 5.1: Full workspace verification**

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

All packages green.

- [ ] **Step 5.2: Smoke test — registration flow**

Create a temporary file `/tmp/smoltalk-llama-smoke.ts` (do not commit):

```ts
import { registerProvider, getClient } from "smoltalk";
import { LlamaCPP } from "smoltalk-llama-cpp";

registerProvider("llama-cpp", LlamaCPP);

const client = getClient({
  model: "test-model",
  provider: "llama-cpp" as any,
  metadata: { llamaCppModelDir: "/tmp/nonexistent" },
});

console.log("client class:", client.constructor.name);
```

Run it from the repo root with the workspace symlinks active:

```bash
pnpm --filter smoltalk-llama-cpp exec node --experimental-strip-types /tmp/smoltalk-llama-smoke.ts 2>&1 | head -10
```

Expected: prints `client class: LlamaCPP`. (The class is constructed but `setup()` is never called, so no native llama-cpp loading happens — this is just a routing check.)

If the script fails: check that `LlamaCPP` is exported from `smoltalk-llama-cpp`'s `index.ts` and that the new package builds cleanly.

Clean up: `rm /tmp/smoltalk-llama-smoke.ts`.

- [ ] **Step 5.3: Confirm smoltalk has no native deps in its tree**

```bash
pnpm --filter smoltalk list --depth=1 2>&1 | grep -i llama
```

Expected: no output (no llama references).

- [ ] **Step 5.4: No commit needed for this task** — just verification.

---

## Task 6: Versions, READMEs, and changelog

**Goal:** Mark the version bumps, document the migration, and update root-level docs.

**Files to modify/create:**
- `packages/smoltalk/package.json` — version `0.1.0` → `0.2.0` (already verified at start of this task)
- `packages/smoltalk-llama-cpp/package.json` — already at `0.1.0` from Task 2
- `packages/smoltalk-llama-cpp/README.md` — new
- `README.md` (root) — brief overview pointing to packages
- `packages/smoltalk/README.md` — new (move existing root README content here)
- `CHANGELOG.md` (root) — new, brief migration notes

- [ ] **Step 6.1: Bump smoltalk version**

In `packages/smoltalk/package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 6.2: Move root `README.md` content into `packages/smoltalk/README.md`**

```bash
git mv README.md packages/smoltalk/README.md
```

- [ ] **Step 6.3: Write a brief root `README.md`**

```markdown
# Smoltalk monorepo

This repo hosts:

- **[`smoltalk`](./packages/smoltalk/)** — the core unified-API LLM client (cloud providers: OpenAI, Anthropic, Google, Ollama).
- **[`smoltalk-llama-cpp`](./packages/smoltalk-llama-cpp/)** — `node-llama-cpp` provider plugin for running models locally.

See each package's README for usage.
```

- [ ] **Step 6.4: Write `packages/smoltalk-llama-cpp/README.md`**

```markdown
# smoltalk-llama-cpp

`node-llama-cpp` provider plugin for [smoltalk](https://github.com/egonSchiele/smoltalk).

## Install

```bash
pnpm add smoltalk smoltalk-llama-cpp
```

## Usage

Register the provider before your first call, then use `smoltalk` normally:

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { LlamaCPP } from "smoltalk-llama-cpp";

registerProvider("llama-cpp", LlamaCPP);

const result = await text({
  model: "your-local-model.gguf",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models" },
  messages: [userMessage("Hello")],
});
```

`metadata.llamaCppModelDir` points to a directory containing your `.gguf` model files.
```

- [ ] **Step 6.5: Write a root `CHANGELOG.md`**

```markdown
# Changelog

## smoltalk 0.2.0 (2026-05-08)

**Breaking:** `node-llama-cpp` is no longer a dependency of `smoltalk`. Local-model users must install [`smoltalk-llama-cpp`](./packages/smoltalk-llama-cpp/) and register it manually.

### Migration

Before:
```ts
import { text } from "smoltalk";

await text({
  model: "model.gguf",
  provider: "llama-cpp",
  llamaCppModelDir: "./models",
  messages: [...],
});
```

After:
```ts
import { registerProvider, text } from "smoltalk";
import { LlamaCPP } from "smoltalk-llama-cpp";

registerProvider("llama-cpp", LlamaCPP);

await text({
  model: "model.gguf",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models" },
  messages: [...],
});
```

Changes:
- `llamaCppModelDir` moves from a top-level field on the config to `metadata.llamaCppModelDir`
- `LlamaCPP` is no longer exported from `smoltalk`; import it from `smoltalk-llama-cpp` instead
- The `pnpm pull` script (which used `node-llama-cpp pull`) is gone — install `smoltalk-llama-cpp` if you need it

## smoltalk-llama-cpp 0.1.0 (2026-05-08)

Initial release. Extracted from `smoltalk` core.
```

- [ ] **Step 6.6: Update `CLAUDE.md`** — add a note about the monorepo structure

In the "Project Structure" section, replace the single tree with a two-package note:

```markdown
## Project Structure

This repo is a pnpm workspace monorepo:

- `packages/smoltalk/` — core library (cloud providers)
- `packages/smoltalk-llama-cpp/` — local-model plugin

The structure inside `packages/smoltalk/lib/` is unchanged from before the split.
```

(Keep the rest of CLAUDE.md as-is.)

- [ ] **Step 6.7: Final verification**

```bash
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 6.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
versions, READMEs, and CHANGELOG for 0.2.0 / 0.1.0

Bump smoltalk to 0.2.0 (breaking: llama-cpp extracted). Add CHANGELOG
with migration notes. Split README into a brief root and per-package
content. Add smoltalk-llama-cpp README.
EOF
)"
```

---

## Done

After Task 6, the workspace contains:
- `smoltalk@0.2.0` — no `node-llama-cpp` in its dependency tree
- `smoltalk-llama-cpp@0.1.0` — peer-depends on smoltalk, depends on `node-llama-cpp`

All 152 existing tests still pass. Bundlers (esbuild/webpack/Rollup) consuming `smoltalk` no longer need to mark `node-llama-cpp` external.

The user is responsible for the actual `pnpm publish` step from each package directory after merging this branch.
