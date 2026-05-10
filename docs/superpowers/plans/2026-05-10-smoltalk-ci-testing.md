# Smoltalk CI Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `TestProvider`, unit tests for previously-untested files, a README code-block compile check, and a CI workflow that simulates `npm install` + esbuild bundling against the published artifacts on every PR.

**Architecture:** Six tasks. The first four are local code/tests (incremental, each leaves the build green). Task 5 adds the README compile script. Task 6 wires up GitHub Actions and is the only one that can't be fully verified locally.

**Tech Stack:** TypeScript, vitest, GitHub Actions, esbuild.

**Spec:** `docs/superpowers/specs/2026-05-10-smoltalk-ci-testing-design.md`.

**Working directory:** `/Users/adit/smoltalk`. Branch: create `ci-testing` off `main` before starting.

---

## Task 1: Add `TestProvider` at the `smoltalk/testing` subpath

**Files:**
- Create: `packages/smoltalk/lib/testing/index.ts`
- Modify: `packages/smoltalk/package.json` (add subpath export)

- [ ] **Step 1.1: Branch**

```bash
git checkout main && git pull
git checkout -b ci-testing
```

- [ ] **Step 1.2: Create `packages/smoltalk/lib/testing/index.ts`**

```ts
import { BaseClient } from "../clients/baseClient.js";
import { promptResult, success } from "../types.js";
import type {
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
} from "../types.js";

const DEFAULT_RESPONSE = "test response";

export class TestProvider extends BaseClient {
  private callIndex = 0;

  private nextResponse(config: SmolConfig): string {
    const responses = config.metadata?.testResponses as string[] | undefined;
    if (Array.isArray(responses) && responses.length > 0) {
      const response = responses[this.callIndex % responses.length];
      this.callIndex += 1;
      return response;
    }
    const single = config.metadata?.testResponse as string | undefined;
    return single ?? DEFAULT_RESPONSE;
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const output = this.nextResponse(config);
    return success(
      promptResult({
        output,
        toolCalls: [],
        model: config.model,
      }),
    );
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const output = this.nextResponse(config);
    yield { type: "text", text: output };
    yield {
      type: "done",
      result: promptResult({
        output,
        toolCalls: [],
        model: config.model,
      }),
    };
  }
}
```

- [ ] **Step 1.3: Update `packages/smoltalk/package.json`**

Add a new entry to the `exports` field (after the `"."` entry):

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "require": "./dist/index.js"
  },
  "./testing": {
    "types": "./dist/testing/index.d.ts",
    "import": "./dist/testing/index.js",
    "require": "./dist/testing/index.js"
  }
}
```

No `tsconfig.json` change needed — `lib/**/*.ts` already includes the new dir.

- [ ] **Step 1.4: Verify**

```bash
pnpm --filter smoltalk build
ls packages/smoltalk/dist/testing/index.{js,d.ts}
```

Expected: both files exist.

- [ ] **Step 1.5: Manual smoke (optional but recommended)**

```bash
mkdir -p /tmp/smoltalk-test-smoke && cd /tmp/smoltalk-test-smoke
cat > index.mjs <<'EOF'
import { registerProvider, text, userMessage } from "/Users/adit/smoltalk/packages/smoltalk/dist/index.js";
import { TestProvider } from "/Users/adit/smoltalk/packages/smoltalk/dist/testing/index.js";

registerProvider("test", TestProvider);
const r = await text({
  model: "any",
  provider: "test",
  metadata: { testResponse: "hi" },
  messages: [userMessage("x")],
});
console.log(r.success && r.value.output);
EOF
node index.mjs
```

Expected output: `hi`. Then `cd - && rm -rf /tmp/smoltalk-test-smoke`.

- [ ] **Step 1.6: Commit**

```bash
git add -A
git commit -m "add TestProvider at smoltalk/testing subpath"
```

---

## Task 2: Unit tests for `lib/functions.ts`

**Files:**
- Create: `packages/smoltalk/lib/functions.test.ts`

The new test file uses `TestProvider` for the provider stub. Each test calls `registerProvider("test", TestProvider)` (idempotent — re-registration replaces).

- [ ] **Step 2.1: Write the test file**

```ts
// packages/smoltalk/lib/functions.test.ts
import { describe, it, expect } from "vitest";
import { registerProvider } from "./client.js";
import { text, textSync, textStream } from "./functions.js";
import { TestProvider } from "./testing/index.js";
import { userMessage, BaseMessage } from "./classes/message/index.js";
import type { StreamChunk } from "./types.js";

registerProvider("test", TestProvider);

const baseConfig = {
  model: "any-model",
  provider: "test",
  metadata: { testResponse: "hello" },
  messages: [userMessage("hi")],
};

describe("text()", () => {
  it("returns a Promise when stream is omitted", async () => {
    const result = await text(baseConfig);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.output).toBe("hello");
  });

  it("returns a Promise when stream is false", async () => {
    const result = await text({ ...baseConfig, stream: false });
    expect(result.success).toBe(true);
  });

  it("returns an AsyncGenerator when stream is true", async () => {
    const gen = text({ ...baseConfig, stream: true });
    expect(typeof (gen as AsyncGenerator<StreamChunk>)[Symbol.asyncIterator]).toBe("function");
    const chunks: StreamChunk[] = [];
    for await (const c of gen as AsyncGenerator<StreamChunk>) chunks.push(c);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });
});

describe("textSync()", () => {
  it("converts plain JSON messages to BaseMessage instances", async () => {
    const plainJson: any = [{ role: "user", content: "hi" }];
    const result = await textSync({ ...baseConfig, messages: plainJson });
    expect(result.success).toBe(true);
    // After fixMessagesIfNecessary, the array should hold BaseMessage instances
    expect(plainJson[0] instanceof BaseMessage).toBe(true);
  });

  it("uses successive responses from testResponses array", async () => {
    const cfg = {
      model: "any",
      provider: "test",
      metadata: { testResponses: ["first", "second", "third"] },
      messages: [userMessage("x")],
    };
    // Each call gets a fresh TestProvider via getClient, so callIndex resets.
    // Verify a single TestProvider yields the first response.
    const r1 = await textSync(cfg);
    expect(r1.success && r1.value.output).toBe("first");
  });
});

describe("textStream()", () => {
  it("yields text chunks then a done chunk", async () => {
    const chunks: StreamChunk[] = [];
    for await (const c of textStream(baseConfig)) chunks.push(c);
    expect(chunks.find((c) => c.type === "text")).toBeDefined();
    expect(chunks.find((c) => c.type === "done")).toBeDefined();
  });

  it("passes abortSignal through (best-effort: no error thrown)", async () => {
    const controller = new AbortController();
    const chunks: StreamChunk[] = [];
    for await (const c of textStream({ ...baseConfig, abortSignal: controller.signal })) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2.2: Run**

```bash
pnpm --filter smoltalk test 2>&1 | tail -10
```

Expected: all new tests pass; total count goes up by ~7.

- [ ] **Step 2.3: Commit**

```bash
git add -A
git commit -m "add unit tests for lib/functions.ts"
```

---

## Task 3: Unit tests for `smoltalk-llama-cpp`

**Files:**
- Create: `packages/smoltalk-llama-cpp/lib/llamaCpp.test.ts`
- Modify: `packages/smoltalk-llama-cpp/package.json` (change `test` script from `vitest run --passWithNoTests` to `vitest run`)

- [ ] **Step 3.1: Write the test file**

```ts
// packages/smoltalk-llama-cpp/lib/llamaCpp.test.ts
import { describe, it, expect } from "vitest";
import { LlamaCPP } from "./llamaCpp.js";

describe("LlamaCPP constructor", () => {
  it("throws when metadata is missing", () => {
    expect(
      () =>
        new LlamaCPP({
          model: "any-model",
          messages: [],
        }),
    ).toThrow(/metadata\.llamaCppModelDir is required/);
  });

  it("throws when metadata.llamaCppModelDir is missing", () => {
    expect(
      () =>
        new LlamaCPP({
          model: "any-model",
          messages: [],
          metadata: {},
        }),
    ).toThrow(/metadata\.llamaCppModelDir is required/);
  });

  it("constructs successfully when metadata.llamaCppModelDir is provided", () => {
    const client = new LlamaCPP({
      model: "any-model",
      messages: [],
      metadata: { llamaCppModelDir: "./does-not-need-to-exist" },
    });
    expect(client).toBeInstanceOf(LlamaCPP);
  });

  it("getModel() returns the configured model name", () => {
    const client = new LlamaCPP({
      model: "test-model.gguf",
      messages: [],
      metadata: { llamaCppModelDir: "./models" },
    });
    expect(client.getModel()).toBe("test-model.gguf");
  });
});
```

(Note: this test file is in the plugin package, so `BaseClient`'s constructor is reached via the workspace-symlinked smoltalk. Since `setup()` isn't called, `node-llama-cpp` itself never loads.)

- [ ] **Step 3.2: Update `packages/smoltalk-llama-cpp/package.json` test script**

Change:
```json
"test": "vitest run --passWithNoTests"
```
to:
```json
"test": "vitest run"
```

- [ ] **Step 3.3: Run**

```bash
pnpm --filter smoltalk-llama-cpp test 2>&1 | tail -10
```

Expected: 4 tests pass.

- [ ] **Step 3.4: Commit**

```bash
git add -A
git commit -m "add constructor unit tests for smoltalk-llama-cpp"
```

---

## Task 4: Strengthen `registerProvider` tests

**Files:**
- Modify: `packages/smoltalk/lib/client.test.ts`

- [ ] **Step 4.1: Add tests at the bottom of the existing `describe("registerProvider", ...)` block**

```ts
  it("re-registering the same name replaces the previous class", () => {
    class FirstClient extends BaseClient {
      async _textSync(): Promise<Result<PromptResult>> {
        return success(promptResult({ output: "first" }));
      }
    }
    class SecondClient extends BaseClient {
      async _textSync(): Promise<Result<PromptResult>> {
        return success(promptResult({ output: "second" }));
      }
    }
    registerProvider("replace-test", FirstClient);
    registerProvider("replace-test", SecondClient);
    const client = getClient({
      model: "any-model",
      provider: "replace-test" as any,
    });
    expect(client).toBeInstanceOf(SecondClient);
    expect(client).not.toBeInstanceOf(FirstClient);
  });

  it("constructs the registered class with the smolConfig", async () => {
    class CapturingClient extends BaseClient {
      static lastConfig: any;
      constructor(config: any) {
        super(config);
        CapturingClient.lastConfig = config;
      }
      async _textSync(): Promise<Result<PromptResult>> {
        return success(promptResult({ output: "x" }));
      }
    }
    registerProvider("capturing", CapturingClient);
    getClient({
      model: "any-model",
      provider: "capturing" as any,
      openAiApiKey: "captured-key",
    });
    expect(CapturingClient.lastConfig?.model).toBe("any-model");
    expect(CapturingClient.lastConfig?.openAiApiKey).toBe("captured-key");
  });
```

- [ ] **Step 4.2: Run**

```bash
pnpm --filter smoltalk test 2>&1 | tail -10
```

- [ ] **Step 4.3: Commit**

```bash
git add -A
git commit -m "strengthen registerProvider tests"
```

---

## Task 5: README code-block compile check

**Files:**
- Create: `packages/readme-check/package.json`
- Create: `packages/readme-check/tsconfig.json`
- Create: `packages/readme-check/check.ts`
- Create: `packages/readme-check/.gitignore` (ignore the `tmp/` dir the script writes)

A new workspace package whose only job is to extract TS code blocks from the READMEs and typecheck them against a real installation of smoltalk + smoltalk-llama-cpp via workspace links.

- [ ] **Step 5.1: Create `packages/readme-check/package.json`**

```json
{
  "name": "readme-check",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "node check.mjs"
  },
  "dependencies": {
    "smoltalk": "workspace:*",
    "smoltalk-llama-cpp": "workspace:*",
    "zod": "^4.3.6"
  }
}
```

(Plain `.mjs` so it runs on both Node 20 and 22 without `--experimental-strip-types`.)

- [ ] **Step 5.2: Create `packages/readme-check/tsconfig.json`**

```json
{
  "extends": "../smoltalk/tsconfig.json",
  "compilerOptions": {
    "outDir": "./tmp-out",
    "rootDir": "./tmp",
    "noEmit": true
  },
  "include": ["tmp/**/*.ts"],
  "exclude": ["node_modules", "tmp-out"]
}
```

- [ ] **Step 5.3: Create `packages/readme-check/.gitignore`**

```
tmp/
tmp-out/
```

- [ ] **Step 5.4: Create `packages/readme-check/check.mjs`**

```js
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const READMES = [
  "../../README.md",
  "../smoltalk/README.md",
  "../smoltalk-llama-cpp/README.md",
];

const SKIP_MARKER = "// example: skip-typecheck";
const BLOCK_RE = /```(?:ts|typescript)\n([\s\S]*?)```/g;

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = path.join(here, "tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let blockIndex = 0;
const sources = [];

for (const readmePath of READMES) {
  const fullPath = path.resolve(here, readmePath);
  const content = readFileSync(fullPath, "utf8");
  let m;
  let i = 0;
  while ((m = BLOCK_RE.exec(content))) {
    const block = m[1];
    if (block.includes(SKIP_MARKER)) {
      i += 1;
      continue;
    }
    const fname = `block-${blockIndex}.ts`;
    writeFileSync(path.join(tmp, fname), block);
    sources.push({ file: readmePath, index: i, path: fname });
    blockIndex += 1;
    i += 1;
  }
}

if (sources.length === 0) {
  console.log("No TS code blocks found in READMEs.");
  process.exit(0);
}

console.log(`Typechecking ${sources.length} TS code block(s) from READMEs...`);

try {
  execSync("pnpm exec tsc --noEmit", { cwd: here, stdio: "inherit" });
  console.log("All README code blocks typecheck.");
} catch (err) {
  console.error("\nFailed README blocks (file:index):");
  for (const s of sources) console.error(`  ${s.file}#${s.index} -> ${s.path}`);
  process.exit(1);
}
```

- [ ] **Step 5.5: Install (re-link workspace)**

```bash
pnpm install
```

- [ ] **Step 5.6: Run the check**

```bash
pnpm --filter readme-check check
```

Expected outcome: it'll list any blocks that fail. Likely failures (we'll fix them):
- README blocks that reference `messages` defined in a previous block — the check treats each block in isolation
- Examples that use top-level `await` — needs `module: nodenext` and `target: esnext` (which the smoltalk tsconfig has, so should work)
- Examples missing imports

Fix each by either adding the missing import inside the block, marking it `// example: skip-typecheck`, or restructuring. For self-contained examples this should be quick.

- [ ] **Step 5.7: Iterate until clean**

Expected: zero failures. If the script reports failures, edit the offending README sections.

- [ ] **Step 5.8: Commit**

```bash
git add -A
git commit -m "add readme code-block compile check"
```

---

## Task 6: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/ci-fixture/index.ts`
- Create: `scripts/ci-fixture/package.json` (or use a bare TS file fixture)

- [ ] **Step 6.1: Create `scripts/ci-fixture/index.ts`**

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { TestProvider } from "smoltalk/testing";

registerProvider("test", TestProvider);

const result = await text({
  model: "any-model",
  provider: "test",
  metadata: { testResponse: "ci-fixture-ok" },
  messages: [userMessage("hi")],
});

if (!result.success) {
  console.error("call failed:", result.error);
  process.exit(1);
}
if (result.value.output !== "ci-fixture-ok") {
  console.error("unexpected output:", result.value.output);
  process.exit(1);
}
console.log("OK:", result.value.output);
```

- [ ] **Step 6.2: Create `scripts/ci-fixture/package.json`**

A standalone (not a workspace member — that's important; CI installs it from tarballs):

```json
{
  "name": "ci-fixture",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {}
}
```

CI fills in the dependencies dynamically by `npm install <tarball>`.

- [ ] **Step 6.3: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: test (node ${{ matrix.node }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r test
      - run: pnpm -r build
      - run: pnpm --filter readme-check check

  install-simulation:
    name: install simulation (npm)
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - name: pack tarballs
        run: |
          cd packages/smoltalk && pnpm pack --pack-destination /tmp
          cd ../smoltalk-llama-cpp && pnpm pack --pack-destination /tmp
      - name: install via npm in fresh consumer
        run: |
          mkdir -p /tmp/consumer
          cp scripts/ci-fixture/* /tmp/consumer/
          cd /tmp/consumer
          npm init -y >/dev/null
          npm install /tmp/smoltalk-*.tgz /tmp/smoltalk-llama-cpp-*.tgz
          npm install --save-dev typescript@5
      - name: compile fixture
        working-directory: /tmp/consumer
        run: npx tsc --target esnext --module nodenext --moduleResolution nodenext index.ts
      - name: run fixture
        working-directory: /tmp/consumer
        run: node index.js

  bundler-smoke:
    name: esbuild bundler smoke
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: cd packages/smoltalk && pnpm pack --pack-destination /tmp
      - run: cd packages/smoltalk-llama-cpp && pnpm pack --pack-destination /tmp
      - name: bundle the smoltalk-only fixture
        run: |
          mkdir -p /tmp/bundle
          cp scripts/ci-fixture/index.ts /tmp/bundle/
          cd /tmp/bundle
          npm init -y >/dev/null
          npm install /tmp/smoltalk-*.tgz
          npm install --save-dev esbuild typescript@5
          npx esbuild --bundle --platform=node --target=node20 --outfile=bundle.js index.ts
      - name: assert bundle contains no node-llama-cpp
        run: |
          if grep -q "node-llama-cpp" /tmp/bundle/bundle.js; then
            echo "bundle contains node-llama-cpp reference"
            exit 1
          fi
      - name: run bundle
        run: node /tmp/bundle/bundle.js
```

Note: the bundler smoke fixture has to be the smoltalk-only fixture. The original `scripts/ci-fixture/index.ts` imports `smoltalk-llama-cpp` too, which would fail the bundler test. Solution: either (a) the fixture only imports smoltalk + the test provider (no plugin), and a separate fixture is used by the install simulation when including the plugin; or (b) one fixture without the plugin, and the install simulation just imports it (still validates that both packages install cleanly). Use approach (b) — keep the fixture minimal.

Update `scripts/ci-fixture/index.ts` to NOT import `smoltalk-llama-cpp`:

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { TestProvider } from "smoltalk/testing";

registerProvider("test", TestProvider);

const result = await text({
  model: "any-model",
  provider: "test",
  metadata: { testResponse: "ci-fixture-ok" },
  messages: [userMessage("hi")],
});

if (!result.success) { console.error("call failed:", result.error); process.exit(1); }
if (result.value.output !== "ci-fixture-ok") { console.error("unexpected:", result.value.output); process.exit(1); }
console.log("OK:", result.value.output);
```

For the install simulation, *also* install the plugin tarball (verifies the plugin's package.json/exports are valid) but don't reference it from the fixture.

- [ ] **Step 6.4: Commit**

```bash
git add -A
git commit -m "add CI workflow with install simulation and bundler smoke"
```

- [ ] **Step 6.5: Push and observe**

```bash
git push -u origin ci-testing
gh pr create --title "..." --body "..."
```

Watch the PR on GitHub. Iterate on any CI failures.

- [ ] **Step 6.6: Verify negative cases (optional but recommended)**

To prove the CI catches what it should:
- Temporarily add `import "node-llama-cpp"` to `packages/smoltalk/lib/index.ts` and push — the bundler-smoke job should fail with the grep check
- Temporarily change the test provider response to a wrong value — the install-simulation should fail with the assertion error
- Revert both before merging

---

## Done

After Task 6, every PR runs:
- Unit tests on Node 20 + 22
- README code blocks compile
- A fresh `npm install` of the published tarballs into a clean project, and runs the fixture
- An esbuild bundle of a smoltalk-only consumer, asserts no `node-llama-cpp` makes it in, and runs the resulting bundle

Future work (out of scope here, tracked in spec): the optional cross-provider integration smoke (#10) is deferred until you decide on API-key management in CI.
