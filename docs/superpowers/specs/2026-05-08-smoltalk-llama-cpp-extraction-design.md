# Smoltalk: Extract `node-llama-cpp` to a Separate Package

**Date:** 2026-05-08
**Status:** Approved for implementation
**Target versions:** `smoltalk@0.2.0`, `smoltalk-llama-cpp@0.1.0`

## Context

`node-llama-cpp` is a native-binary dependency that bundlers (esbuild, webpack, Rollup) cannot include. Today smoltalk has it as a hard dependency, which forces every downstream consumer to mark it `external` in their bundler config or accept a broken build. This spec extracts llama-cpp into a separate package so smoltalk core has no native deps and consumers who don't use local models never see `node-llama-cpp` in their dependency tree.

The cleanup work in `0.1.0` was the prerequisite — `BaseClient`, `SmolConfig`, and the `registerProvider()` mechanism are now stable enough that an external client can plug in cleanly.

## Goal

Smoltalk core ships with no `node-llama-cpp` dependency. Local-model users install `smoltalk-llama-cpp` separately and register it at runtime.

## Scope

### Repository layout

Convert this repo to a pnpm workspace monorepo:

```
smoltalk/
├── package.json            # workspace root, dev deps, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json      # shared compiler options
├── packages/
│   ├── smoltalk/           # the existing core (lib/ moves here)
│   │   ├── lib/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── smoltalk-llama-cpp/
│       ├── lib/
│       │   └── llamaCpp.ts # moved from packages/smoltalk/lib/clients/
│       ├── package.json
│       └── tsconfig.json
└── docs/                   # stays at root (already does)
```

The `pnpm` package manager remains. Workspaces let `smoltalk-llama-cpp` import from `smoltalk` via a regular `peerDependency`, with the workspace symlink resolving locally during development.

### Core changes (`smoltalk@0.2.0`)

- Delete `lib/clients/llamaCpp.ts`
- Remove `case "llama-cpp"` from the switch in `lib/client.ts:91-92`
- Remove `export * from "./clients/llamaCpp.js"` from `lib/client.ts:7`
- Remove `"llama-cpp"` from the `providers` array in `lib/models.ts`
- Remove `llamaCppModelDir` field from `SmolConfig` in `lib/types.ts`
- Drop `node-llama-cpp` from `dependencies` in `packages/smoltalk/package.json`
- Drop the `pull` script (which calls `node-llama-cpp pull`)
- Bump version to `0.2.0`

### New package (`smoltalk-llama-cpp@0.1.0`)

- Move the existing `llamaCpp.ts` here as `lib/llamaCpp.ts`
- Adjust imports — the file currently imports from `../classes/...`, `../types.js`, `../model.js`, `./baseClient.js`. After move, these all become `from "smoltalk"` (the public barrel).
- The class reads `llamaCppModelDir` from `config.metadata?.llamaCppModelDir` instead of `config.llamaCppModelDir` (since the field no longer exists on `SmolConfig`)
- Export the class as a named export: `export { LlamaCPP }`
- `package.json`:
  - `dependencies`: `node-llama-cpp`
  - `peerDependencies`: `smoltalk` (matching range)
  - Same TypeScript / build setup as core

### User-facing API

Activation pattern (per the chosen spec): users pass the class explicitly to `registerProvider()`. No auto-registration, no helper function — most explicit, three lines:

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { LlamaCPP } from "smoltalk-llama-cpp";

registerProvider("llama-cpp", LlamaCPP);

const result = await text({
  model: "your-local-model",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models" },
  messages: [userMessage("Hello")],
});
```

### `llamaCppModelDir` migration

The plugin reads `config.metadata?.llamaCppModelDir` instead of the previously-typed `config.llamaCppModelDir`. This is a typed loss — `metadata` is `Record<string, any>` — but it keeps `SmolConfig` provider-agnostic. The plugin's README documents the metadata key. (A future iteration can use TypeScript module augmentation if we want stronger typing.)

### Versioning and migration

- Smoltalk `0.1.x` → `0.2.0`. Breaking change for current llama-cpp users.
- New package `smoltalk-llama-cpp@0.1.0`.
- A short `CHANGELOG.md` (or GitHub release notes) documents:
  - `node-llama-cpp` is no longer a smoltalk dependency
  - Users of local models: `pnpm add smoltalk-llama-cpp`, then `registerProvider("llama-cpp", LlamaCPP)` before first use
  - `llamaCppModelDir` moves from top-level config to `metadata.llamaCppModelDir`

### Out of scope

- A model-registration API for plugins (cost calculation will return `null` for llama-cpp models; acceptable since they don't have standard pricing)
- Auto-registration / side-effect imports
- Module augmentation for `llamaCppModelDir` typing
- Migrating the existing GitHub repo to a different hosting structure
- Publishing either package to npm (the user will run `pnpm publish` manually after merge)

## Open questions resolved during brainstorm

- **Package layout**: pnpm workspace monorepo
- **Activation**: explicit `registerProvider("llama-cpp", LlamaCPP)` call
- **`llamaCppModelDir`**: removed from `SmolConfig`; plugin reads `metadata`

## Verification

After implementation, end-to-end check:

1. `pnpm install` at the workspace root resolves all packages
2. `pnpm -r typecheck` passes for both packages
3. `pnpm -r test` runs the existing test suite (still in core); 152 tests pass
4. `pnpm -r build` compiles both packages cleanly
5. From a scratch directory: `import "smoltalk"` does NOT pull `node-llama-cpp` into the dependency graph
6. Manual smoke: a tiny script that calls `registerProvider` + `text({ provider: "llama-cpp", ... })` resolves to the LlamaCPP client (we can stub the actual model loading if needed)
