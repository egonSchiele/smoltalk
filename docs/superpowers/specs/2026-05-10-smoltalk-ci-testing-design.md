# Smoltalk CI Testing — Design Spec

**Date:** 2026-05-10
**Status:** Approved for implementation

## Goal

Make it hard for a published version of smoltalk to be broken on install. The bar: `npm install smoltalk` followed by minimal usage with a test provider should succeed in CI on every PR. Several layers of defense — packaging, bundler compatibility, and behavior — caught before merge rather than by the first user.

## Scope

Eight pieces, grouped:

### A. Test provider (new component)

A built-in fake provider that returns canned responses without making network calls. Lives at the `smoltalk/testing` subpath import.

**Public API:**

```ts
import { registerProvider } from "smoltalk";
import { TestProvider } from "smoltalk/testing";

registerProvider("test", TestProvider);

const result = await text({
  model: "any-string",
  provider: "test",
  metadata: { testResponse: "hello world" },
  messages: [userMessage("hi")],
});
// result.value.output === "hello world"
```

**Behavior:**
- Reads `config.metadata.testResponse: string` for a single canned reply
- Reads `config.metadata.testResponses: string[]` to cycle through replies on successive calls (each `TestProvider` instance keeps a per-call index)
- If neither is set, returns a default `"test response"`
- Implements both `_textSync` (returns the next response wrapped in `Result.success`) and `_textStream` (yields one `text` chunk then a `done` chunk)
- No real network, no model registry lookup, no cost calculation (returns no usage / cost)

**Subpath export config:**
- `packages/smoltalk/package.json` adds `"./testing"` to `exports`, pointing to `./dist/testing/index.js` and `./dist/testing/index.d.ts`
- New file `packages/smoltalk/lib/testing/index.ts` exports `TestProvider` (and any future testing helpers)
- `tsconfig.json`'s `include` already covers `lib/**/*.ts` so it's picked up automatically

### B. Unit tests for `lib/functions.ts`

`packages/smoltalk/lib/functions.test.ts`. Vitest. Mock `getClient` (or use the new `TestProvider`). Coverage:

- `text({ stream: true })` returns an `AsyncGenerator`
- `text({ stream: false })` and `text({})` return a `Promise`
- `textSync` calls `fixMessagesIfNecessary`: passing plain JSON message objects produces `BaseMessage` instances at the call site
- `textStream` yields all chunks from the underlying client
- `abortSignal` is passed through to the client

Use `TestProvider` for the provider stub; cleaner than mocking.

### C. Unit tests for `smoltalk-llama-cpp`

`packages/smoltalk-llama-cpp/lib/llamaCpp.test.ts`. Vitest. Coverage:

- Constructor throws when `metadata.llamaCppModelDir` is missing (with the new actionable error message)
- Constructor throws when `metadata` itself is undefined
- Constructor succeeds when `metadata.llamaCppModelDir` is a string (does NOT call `setup()` — that would load a real model)
- `getModel()` returns the configured model name

Don't exercise `setup()`, `_textSync()`, or `_textStream()` — they require a real `.gguf` file.

### D. `registerProvider` behavior tests

Extend `packages/smoltalk/lib/client.test.ts`. Coverage to add:

- Re-registering the same provider name replaces the previous class
- `getClient()` constructs the registered class with the right config
- After registration, `text({ provider: "myname", ... })` routes through the registered class (use `TestProvider` as the registered class)

### E. README code blocks compile check

A small script that extracts ` ```ts ` blocks from `README.md`, `packages/smoltalk/README.md`, and `packages/smoltalk-llama-cpp/README.md`, writes each to a temp `.ts` file, and runs `tsc --noEmit` against the workspace. Failures get reported with the source README and block index.

Implementation: a Node script at `scripts/check-readme-typescript.ts` (workspace root) using a regex extractor. Fails CI if any block has a type error. Skip blocks marked with a comment like `// example: skip-typecheck` (escape hatch for intentional pseudo-code).

### F. CI workflow

Single workflow `.github/workflows/ci.yml`:

```yaml
on: [push, pull_request]

jobs:
  test:
    strategy:
      matrix:
        node: [20, 22]
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup pnpm
      - setup node ${{ matrix.node }}
      - pnpm install --frozen-lockfile
      - pnpm -r typecheck
      - pnpm -r test
      - pnpm -r build
      - node scripts/check-readme-typescript.ts

  install-simulation:
    needs: test
    runs-on: ubuntu-latest
    # Single Node version is fine — packaging is platform-independent
    steps:
      - checkout
      - setup pnpm + node 22
      - pnpm install --frozen-lockfile
      - pnpm -r build
      - cd packages/smoltalk && pnpm pack
      - cd packages/smoltalk-llama-cpp && pnpm pack
      - mkdir -p /tmp/consumer && cd /tmp/consumer
      - npm init -y
      - npm install <smoltalk tarball> <smoltalk-llama-cpp tarball>
      - copy a fixture script that uses smoltalk + TestProvider
      - npx tsc --target esnext --module nodenext --moduleResolution nodenext fixture.ts
      - node fixture.js  # asserts output matches expected

  bundler-smoke:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - same setup as install-simulation
      - install esbuild
      - run esbuild --bundle --platform=node fixture.ts --outfile=bundle.js
      - run node bundle.js  # confirms the bundle is functional
      - grep -L "node-llama-cpp" bundle.js  # asserts no llama-cpp in the bundle
```

The fixture script is a small TS file at `scripts/ci-fixture/index.ts` that imports `text` and `TestProvider`, registers it, calls `text()`, and asserts on the result.

### G. Frozen lockfile

`pnpm install --frozen-lockfile` is the install command in the workflow above. Drift between `pnpm-lock.yaml` and `package.json` fails CI immediately.

### H. Node version matrix

20 LTS and 22 LTS, configured in the matrix above. 18 is end-of-life and isn't tested.

## Out of scope (for this spec)

- Type-level public API surface snapshot test (#5) — README compile check covers the most common case
- Dep-tree regression check via `pnpm why` (#6) — implicitly covered by bundler smoke

## Follow-ups landed separately

- **Real provider integration (#10 from the brainstorm)** — landed in a separate PR as `.github/workflows/provider-smoke.yml` + `lib/clients/*.live.test.ts`. Triggered only on push:main; secrets gated; preflight checks fail loudly if any required secret is missing. See `docs/superpowers/specs/2026-05-10-smoltalk-ci-testing-design.md` (this file) for the original brainstorm context.

## Verification

After implementation:

1. Open a PR. CI runs on push:
   - `test` matrix passes for Node 20 + 22
   - `install-simulation` builds tarballs, installs into a fresh project, runs the fixture, exits 0
   - `bundler-smoke` produces a bundle that runs and contains no `node-llama-cpp` references
2. Make a deliberately-broken change (e.g. add a wrong export) — confirm the relevant CI job fails
3. Local: `pnpm test` passes the new unit tests for functions.ts and llamaCpp.ts
4. Local: `pnpm tsx scripts/check-readme-typescript.ts` passes against current READMEs
