# smoltalk in the browser: implementation plan

**Why:** Agency programs can now run in a browser
(`agency-lang`, `docs/dev/runtime/host.md`, "The browser"), and every
model call in Agency goes through smoltalk. The browser bundle has to
stand smoltalk in with a stub today because three smoltalk files import
Node when they load, so a program in a browser cannot call a model. This
plan makes `smoltalk` bundle for the browser with `esbuild
--platform=browser`, with the Node-only parts behind a condition.

Read first, in the smoltalk repo: `lib/index.ts` (what the package
exports), `lib/util/blobRef.ts`, `lib/modelRefresh.ts`,
`lib/clients/llamaCppLoader.ts`, `lib/util/provider.ts`. In the
agency-lang repo: `docs/dev/runtime/running-without-node.md` for the rule
about branching between platforms (one file per platform behind a
package-level condition, never `if (isNode)` in shared code) and for the
`#sha256`/`#path` setup this plan copies, and
`docs/superpowers/plans/2026-10-05-host-and-platforms.md`, PR 15, Task
34, for the smoltalk stand-in Agency's browser smoke test would otherwise
need.

**Branch:** one PR in the smoltalk repo, based on `main`, with the
`Buffer` change (Task 4) in it as its own commit rather than its own PR,
at the owner's request. One commit per task. Paths are relative to `packages/smoltalk`. The version bump at the
end is a minor one; nothing changes for a Node caller.

## What stands in the way today

Found by bundling `lib/index.ts` with esbuild for the browser, and by
grep, on smoltalk 0.16.0 (re-checked 2026-10-13):

| Where | What | Count |
| --- | --- | --- |
| `lib/util/blobRef.ts` | `node:fs/promises` (`readFile`, `stat`), `node:path` (`extname`): a `BlobRef` can be a file path | static import |
| `lib/modelRefresh.ts` | `node:fs/promises` (`readFile`), `node:url` (`fileURLToPath`): the model data URL may be a `file:` URL; re-exported by `lib/index.ts` | static import |
| `lib/clients/llamaCppLoader.ts` | `url` (`pathToFileURL`) for the `entryPath` option, and a dynamic `import()` of a bare specifier | static import |
| `lib/clients/ollama.ts` | `ollama`, whose Node build imports `node:fs` and `node:path`; the package ships `ollama/browser` with the same API | dependency |
| `@anthropic-ai/sdk` 0.109 | Five files in its credential chain (`core/credentials.mjs`, `lib/credentials/*.mjs`) do `await import("node:fs")` and `node:path` at call time, on the path taken when no API key is passed. esbuild refuses them under `--platform=browser` unless Node builtins are marked external; then they stay as runtime imports that never run when a key is passed. Needs `dangerouslyAllowBrowser: true` to construct in a browser | dependency |
| `openai`, `@google/genai` | bundle; `openai` needs `dangerouslyAllowBrowser: true` | dependency |
| `process.env` | 23 reads across 8 files, 14 of them in `lib/util/provider.ts` (API keys) | global |
| `Buffer` | 13 uses in 10 files: base64 to and from bytes in attachments, images, speech, transcription, embeddings | global |

With the four SDKs external, the bundle fails on exactly the five imports
in the first three rows and nothing else. With `--alias:ollama=ollama/browser`
and `--external:node:*`, it fails on nothing.

## The design

- **One package, one entry.** `lib/index.ts` stays the only entry point
  and bundles for the browser as it is. No `index.browser.ts`, no
  stand-ins, no `browser` condition on `exports`. This is the smallest
  branch Agency's rule allows: every Node read sits behind one `imports`
  entry, and the entry file is shared. The llama.cpp loader stays in the
  bundle; in a browser `loadLlamaCpp()` fails at runtime when the browser
  cannot resolve the bare `smoltalk-llama-cpp` specifier, wrapped in the
  loader's existing "Failed to load smoltalk-llama-cpp" error. Agency
  never reaches it there: its only caller is `lib/runtime/localProvider.ts`,
  which is on Agency's `NODE_ONLY` list, and Agency's platform check
  keeps local-model modules out of a browser program.
- **Node reads move behind a condition.** A `#platform` entry in
  `imports` (`lib/platform.node.ts`, `lib/platform.browser.ts`) carries
  five functions: `readFileBytes(path, maxBytes)`, `fileExtension(path)`,
  `readTextFromFileUrl(url)`, `pathToFileUrl(path)`, and `env(name)`. The
  Node file implements them with `node:fs`, `node:path`, `node:url`, and
  `process.env`; the browser file throws for the four file functions,
  naming the function, and returns `undefined` for `env`. Shared code
  imports `#platform` and never `node:*`. This keeps `blobRef.ts`,
  `modelRefresh.ts`, and `llamaCppLoader.ts` as one file each.
  `refreshModels` needs no special treatment: its `https:` path works in
  a browser, and only the `file:` branch throws.
- **`Buffer` becomes `Uint8Array`** with two small helpers,
  `bytesToBase64` and `base64ToBytes`, in `lib/util/base64.ts`. Prefer
  `Uint8Array.fromBase64`/`toBase64` where the runtime has them, with a
  `btoa`/`atob` loop as the fallback. `Buffer.byteLength(text)` becomes
  `TextEncoder`.
- **API keys from an option, with `env` as the fallback.** `provider.ts`
  already prefers a key passed in (`k?.openAi`) and falls back to
  `process.env`; the fallback goes through `#platform`'s `env`, so in a
  browser it is simply absent and the caller passes keys. Agency already
  passes every key explicitly through `SmolConfig.apiKey`.
- **Browser SDK flags, unconditional.** The `openai` and
  `@anthropic-ai/sdk` constructors get `dangerouslyAllowBrowser: true`
  always. The flag is a no-op in Node, so a Node caller sees no change,
  and there is no `allowBrowser` option to thread through. Agency's
  `SmoltalkClient` is shared code and could not set a per-platform
  option without a branch Agency's rule forbids. The README says what
  the flag means: a key passed to smoltalk in a browser is visible to
  anyone who can open the page, and a production browser app should
  point `baseUrl` at a proxy that holds the key. Task 5 checks whether
  `@google/genai` has an equivalent flag; as far as is known it has none.
- **ollama:** a `#ollama` import entry mapping to `ollama` by default and
  `ollama/browser` for the browser. `lib/clients/ollama.ts` imports from
  it. Verified: the alias alone clears every `ollama` error from the
  bundle.
- **A CI check** bundles `lib/index.ts` with esbuild for the browser,
  with Node builtins external, and fails when any file under smoltalk's
  own `lib/` imports a `node:` module or a Node builtin, read from the
  metafile. It does not fail on the Anthropic SDK's lazy imports, which
  smoltalk cannot change. Agency's own bundle check (its PR 15, Task 34)
  needs the same `--external:node:*` and the same scoping.

Set aside, on purpose:

- No `fetch` wrapper. smoltalk calls the global `fetch`, and so do the
  SDKs; Agency's host does not route the model client's requests through
  `host.network` (the host spec says so). A caller that needs to
  intercept requests passes a `fetch` to the SDKs, which they all accept.
- No change to the statelog client. `lib/statelogClient.ts` reads
  `process.env` for its endpoint; it goes through `#platform`'s `env` and
  is otherwise fine.
- The llama.cpp client stays Node-only. It loads a native module, which
  no browser can. Local inference in a browser is `smoltalk-webllm`, a
  separate plugin that registers itself at runtime and needs nothing
  from this plan.
- No `smoltalk/browser` subpath. Agency's runtime imports plain
  `smoltalk` from about 48 shared files, so only a condition can redirect
  them, and with one entry there is nothing for a subpath to point at.

## Tasks

### Task 1: the bundle check, failing

1. Add `scripts/check-browser-bundle.mjs`: esbuild `lib/index.ts` with
   `--platform=browser --bundle --format=esm --outfile=/dev/null
   --metafile`, `--external:node:*`, and external for `@anthropic-ai/sdk`,
   `openai`, `@google/genai`, `ollama` (Task 7 brings `ollama` back in;
   Task 8 brings the other three back in). Read the metafile and fail on
   any input under `lib/` whose imports include a `node:` specifier or a
   bare Node builtin (`fs`, `path`, `url`, `os`, `crypto`, and the rest
   of `node:module`'s `builtinModules`). Imports from inside
   `node_modules` are not checked.
2. Run it and keep its output in the PR description. It should name the
   three files. Add it to `package.json` scripts as `check:browser` and to
   CI, allowed to fail until Task 8.

### Task 2: `#platform`

1. `package.json` `imports`: `"#platform": { "browser":
   "./dist/platform.browser.js", "default": "./dist/platform.node.js" }`.
   Copy Agency's setup for `#sha256`: an ambient `declare module
   "#platform"` in `lib/packageImports.d.ts` that imports its types by a
   path TypeScript resolves (a relative path in an ambient module
   declaration makes the type `any`; see agency-lang's
   `lib/utils/packageImports.d.ts`), and nothing in `paths` in
   `tsconfig.json`.
2. `lib/platform.ts` holds the shared types; `platform.node.ts` and
   `platform.browser.ts` implement `readFileBytes`, `fileExtension`,
   `readTextFromFileUrl`, `pathToFileUrl`, `env`.
3. Vitest resolves `#platform` to the Node file. Try `resolve.conditions`
   or Vite's native `imports` support first; fall back to `resolve.alias`
   in `vitest.config.ts` as Agency does.

### Task 3: `blobRef.ts`, `modelRefresh.ts`, and `llamaCppLoader.ts`

1. `blobRef.ts`: `readFile`/`stat` become `readFileBytes`; `extname`
   becomes `fileExtension`. A path ref in a browser throws the platform
   file's error, which names the function. Keep the size gate before the
   read: `readFileBytes` takes `maxBytes` and refuses before reading,
   which is better on both platforms.
2. `modelRefresh.ts`: the `file:` branch calls `readTextFromFileUrl`.
3. `llamaCppLoader.ts`: `pathToFileURL` becomes `pathToFileUrl` from
   `#platform`. The dynamic `import(specifier)` stays; esbuild keeps a
   non-literal dynamic import as a runtime import and does not fail on
   it.
4. Tests: the existing ones pass unchanged on Node; add one per function
   with the browser platform file imported directly, asserting the error.

### Task 4: `Buffer` to `Uint8Array`

1. `lib/util/base64.ts` with `bytesToBase64` and `base64ToBytes`, and a
   test against known pairs and a round trip of 1 MB of random bytes.
2. Replace the 13 uses. Where a public type says `Buffer` (check
   `NormalizedBlob.data` and the attachment types), change it to
   `Uint8Array`; `Buffer` is a `Uint8Array`, so a Node caller passing one
   still type-checks, and a caller reading `.data` as a `Buffer` is the
   one visible change. Agency reads none of these as a `Buffer` (checked
   2026-10-13; its own encoders dropped `Buffer` in its PR D). Note it in
   the changelog.

### Task 5: keys and `process.env`

1. Every `process.env.X` read goes through `env("X")` from `#platform`.
   `provider.ts` keeps its order: the option first, then `env`.
2. The `openai` and `@anthropic-ai/sdk` constructors pass
   `dangerouslyAllowBrowser: true` unconditionally. Check whether
   `@google/genai` 2.10 has an equivalent and pass it if so. A test
   constructs each client in Node and checks the constructor option it
   passed. Add the README note on keys in a browser and the proxy
   pattern.

### Task 6: (removed)

There is no browser entry. Renumbering is not worth the churn in the
agency-lang references.

### Task 7: ollama

1. `imports["#ollama"]`: `ollama/browser` under `browser`, `ollama` by
   default, with its ambient declaration and Vitest resolution as in
   Task 2. `lib/clients/ollama.ts` imports from `#ollama`. Remove
   `ollama` from the bundle check's externals.

### Task 8: the check passes, and Agency uses it

1. Remove `@anthropic-ai/sdk`, `openai`, and `@google/genai` from the
   bundle check's externals (keep `--external:node:*`). `check:browser`
   passes; make it required in CI.
2. Bump the minor version and write the changelog entry: smoltalk
   bundles for the browser, `dangerouslyAllowBrowser` always on,
   `Uint8Array` in place of `Buffer`, which calls throw in a browser
   (path refs, `file:` model data, `loadLlamaCpp`).
3. In agency-lang, after the release: bump `smoltalk`, and in its PR 15
   Task 34 bundle script use `--external:node:*` instead of the
   `--alias` stand-in for smoltalk. Extend the browser smoke program
   with an `llm()` call against a fetch mock through `browserHost`'s
   `fetch` option, so the smoke test proves a model call leaves the page.
   That is the first time an Agency program in a browser can talk to a
   model, and it is the point of this plan.

Review focus: the `#platform` surface (five functions, nothing more), the
`Buffer` type change in public types, and the bundle check's scoping to
smoltalk's own files.
