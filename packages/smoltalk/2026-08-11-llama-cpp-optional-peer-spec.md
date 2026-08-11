# Spec: smoltalk loads the llama-cpp provider itself (optional peer dependency)

**Repos touched:** smoltalk only (both `packages/smoltalk` and `packages/smoltalk-llama-cpp`).
**Follow-up work in agency-lang is described at the end but is out of scope here.**

## Background

smoltalk is a common interface over LLM provider APIs. A "provider" is a client
class extending `BaseClient` that knows how to talk to one backend (Anthropic,
OpenAI, Google, ollama, …). `getClient(config)` in
`packages/smoltalk/lib/client.ts` picks the class: built-in providers are a
`switch`, and anything else is looked up in `registeredProviders`, a registry
that callers fill via `registerProvider(name, ClientClass)`. The main entry
points `text()` / `textSync()` / `textStream()` in
`packages/smoltalk/lib/functions.ts` are async and call the synchronous
`getClient` internally.

smoltalk-llama-cpp is the local-inference provider. It exports `LlamaCPP`, a
`BaseClient` subclass that runs models through node-llama-cpp (llama.cpp
bindings). It is deliberately a separate package because node-llama-cpp is
heavy in a way the hosted SDKs are not: ~37 MB unpacked for the JS package
alone, plus platform-specific prebuilt binary packages, plus install scripts
with a compile-from-source fallback. Nobody should pay that install cost
unless they want local models. smoltalk-llama-cpp declares
`peerDependencies: { "smoltalk": ">=0.5.1 <1.0.0" }` — meaning "my host
supplies smoltalk; I use the host's copy."

Today, *consumers* of smoltalk own the job of connecting the two packages.
agency-lang (the main consumer) carries real machinery for it:

- A bundled wrapper module (`lib/stdlib/providers/llama-cpp.mjs` in
  agency-lang) that dynamically imports smoltalk-llama-cpp and registers it.
- An env var relay (`AGENCY_SMOLTALK_LLAMA_CPP_PATH`) carrying the package's
  resolved entry path into child processes, because a globally-installed
  package is not resolvable from the wrapper's location.
- An injected-`registerProvider` convention: agency passes *its* smoltalk's
  `registerProvider` into the wrapper, because a globally-installed
  smoltalk-llama-cpp may carry a second smoltalk copy whose registry agency's
  runtime never reads. Registering into the wrong copy's registry fails
  silently.
- A wrapper subclass that splits a `.gguf` file path into the
  `{ model, metadata.llamaCppModelDir }` shape `LlamaCPP` requires.

Every one of these exists because smoltalk does not know smoltalk-llama-cpp
exists. This spec moves that knowledge into smoltalk: smoltalk declares the
package as an **optional peer dependency** and **lazily loads it** the first
time a call names the `llama-cpp` provider. Consumers then get local models by
installing one package, with no wiring code.

One non-obvious payoff: under pnpm's strict `node_modules` layout, a package
can only resolve packages it *declares*. Without the peer declaration,
`import("smoltalk-llama-cpp")` from inside smoltalk fails in a pnpm project
even when the user installed the plugin right next to it. Declaring the
optional peer is what makes the import resolvable at all there — it is
load-bearing, not documentation.

## Goals

1. `text()` with `provider: "llama-cpp"` works out of the box when
   smoltalk-llama-cpp is installed anywhere Node can resolve it from smoltalk —
   no `registerProvider` calls, no wrapper modules.
2. When the package is missing, the failure is immediate and instructive
   ("install smoltalk-llama-cpp"), not a resolution stack trace.
3. Hosts with unusual layouts (a CLI installed globally, with the plugin
   installed globally beside it) can hand smoltalk the package's entry path
   explicitly and skip Node resolution.
4. The registry-copy hazard class (registering into the wrong smoltalk's
   registry) becomes structurally impossible for this provider: the smoltalk
   instance that executes the call is the instance that loads and registers
   the plugin.
5. `LlamaCPP` accepts a plain `.gguf` file path as the model, so consumers
   don't need a path-splitting adapter.

## Non-goals

- Lazy-loading the hosted SDKs (`openai`, `@anthropic-ai/sdk`,
  `@google/genai`, `ollama`). Different motivation (startup latency, ~100ms),
  different decision, explicitly out of scope.
- Making the hosted SDKs optional peers. They are pure-JS, script-free, and
  are what makes smoltalk work out of the box.
- Moving model downloading, cataloging, or hash verification into smoltalk.
  Those stay in the consumer (agency's curated catalog, SHA-256 pins, cache
  dir conventions). smoltalk-llama-cpp gains a thin `resolveModel` helper
  (below) but owns no policy.
- Merging smoltalk-llama-cpp's code into smoltalk. The package boundary is the
  mechanism that keeps native binaries out of default installs.
- Changing `getClient`'s synchronous signature.

## The circular peer dependency, examined

After this change the two packages reference each other:

- smoltalk-llama-cpp: `peerDependencies: { "smoltalk": ">=0.5.1 <1.0.0" }` (already exists)
- smoltalk: `peerDependencies: { "smoltalk-llama-cpp": ">=0.2.0 <1.0.0" }` marked **optional**

This cycle is safe, for reasons worth spelling out:

**Peer dependencies are constraints, not install edges.** A peer declaration
says "if X is present in the consumer's environment, I'm compatible with these
versions of it" — it does not, by itself, pull X in. So there is no recursive
installation to worry about. The one exception is npm 7+, which auto-installs
*missing non-optional* peers; that is exactly why smoltalk's side of the cycle
MUST carry `peerDependenciesMeta: { "smoltalk-llama-cpp": { "optional": true } }`.
The optional flag is what prevents every `npm i smoltalk` from dragging in
node-llama-cpp. The plugin's non-optional peer on smoltalk is fine: anyone
installing the plugin wants smoltalk anyway, and auto-installing it stops
there because the reverse edge is optional.

**Package managers tolerate dependency cycles generally** — even regular
`dependencies` may be circular in npm/pnpm/yarn. A peer cycle where one edge
is optional is a mild case.

**The runtime import cycle is benign because one direction is deferred.**
smoltalk-llama-cpp statically imports values from smoltalk (`BaseClient`,
`getLogger`, `success`, …). smoltalk imports the plugin only via a dynamic
`import()` at first use — by which point smoltalk's own module graph is fully
evaluated, so the plugin's back-import is served whole from the module cache.
No partially-initialized-module (TDZ) hazard exists on this path. A *static*
import of the plugin from smoltalk would be a different story; nothing in this
design adds one.

**The workspace must not mirror the cycle in devDependencies.** The tempting
move — smoltalk dev-depending on smoltalk-llama-cpp for an integration test —
would create a real build-order cycle inside the pnpm workspace (the plugin
needs smoltalk's types to compile, and vice versa). Instead: smoltalk's unit
tests stub the dynamic import, smoltalk defines a small *structural* type for
the plugin's module shape rather than importing its types, and the integration
test lives in the plugin's package, which already dev-depends on smoltalk
(`workspace:*`). No new workspace edge is added in either direction.

**Version choreography is the one ongoing cost.** Both ranges must stay
mutually satisfiable as either package releases. Today that's easy: the
plugin's range on smoltalk is wide (`>=0.5.1 <1.0.0`), and smoltalk's new
range on the plugin should be similarly wide (`>=0.2.0 <1.0.0`). The
coordination moment to remember is smoltalk 1.0: the plugin's upper bound
excludes it, so both packages need a coordinated release then.

**What the cycle does *not* fix on its own:** duplicate smoltalk copies. If
the plugin is resolved from a location whose own `node_modules` contains a
second smoltalk, the plugin's `BaseClient` is a different class object than
the host's. This design mostly dissolves the problem — in pnpm, peer
resolution links the plugin against the consumer's smoltalk instance; in npm's
flat layout both resolve to the same hoisted copy; and the registry is always
the right one because smoltalk itself does the registering. The residual case
(explicit `entryPath` pointing into a foreign tree with its own smoltalk copy)
still works in practice because `getClient` duck-types the registered class
(`new ClientClass(config)` — no `instanceof` check), but cross-copy class
identity is not guaranteed by this spec and hosts using `entryPath` should
prefer entries whose smoltalk resolves to the host's copy.

## Design

### 1. package.json (packages/smoltalk)

```json
"peerDependencies": {
  "smoltalk-llama-cpp": ">=0.2.0 <1.0.0"
},
"peerDependenciesMeta": {
  "smoltalk-llama-cpp": { "optional": true }
}
```

No change to `dependencies`. No change to the plugin's existing peer block.

### 2. The loader (packages/smoltalk/lib/clients/llamaCppLoader.ts)

A new module owning exactly one concept: getting the optional plugin loaded
and registered, once per process.

```ts
/** Minimal structural view of smoltalk-llama-cpp's module. Declared here
 *  (not imported from the plugin) so smoltalk compiles without the plugin
 *  installed and the workspace gains no build-order cycle. */
export type LlamaCppModule = {
  LlamaCPP: typeof BaseClient;
  resolveModel: (uriOrPath: string, cacheDir: string) => Promise<string>;
};

export function loadLlamaCpp(
  options?: { entryPath?: string },
): Promise<LlamaCppModule>;
```

Behavior:

- **Import source.** With `entryPath`, import `pathToFileURL(entryPath).href`;
  otherwise import the bare specifier `"smoltalk-llama-cpp"`. `entryPath` is
  the escape hatch for hosts whose plugin install is not resolvable from
  smoltalk's location (globally-installed CLIs). Hosts own discovering that
  path; smoltalk never probes global npm roots and reads no env vars for this.
- **Validation.** The imported module must export a `LlamaCPP` function and a
  `resolveModel` function. The two failures mean different things and get
  different errors:
  - No `LlamaCPP` export → this is not the plugin at all: a clear "not a
    smoltalk-llama-cpp module" error naming what was imported (the bare
    specifier or the `entryPath`).
  - `LlamaCPP` present but no `resolveModel` → this *is* the plugin, just an
    old one (0.1.x predates `resolveModel`): `Your installed
    smoltalk-llama-cpp is too old for this version of smoltalk. Upgrade it
    (npm i smoltalk-llama-cpp@latest; >=0.2.0 required).` This case is
    ordinary, not hypothetical — a peer range is a warning, not an
    enforcement, so upgrading smoltalk never force-upgrades the plugin and
    real machines will hold the new-smoltalk + 0.1.x combination.
- **Registration.** On successful load, register under the fixed name
  `"llama-cpp"` via the existing `registerProvider` — *unless that name is
  already registered*, in which case the existing registration is left
  untouched. The module is still imported, validated, and **returned** either
  way: an existing registration wins the registry, never the return value, so
  a direct caller always gets the module's exports (`resolveModel`) no matter
  who registered the provider class. Registration is re-ensured from the
  cached module on *every* call, not only inside the first load: a consumer
  can `unregisterProvider("llama-cpp")` after a successful load, and the next
  load call must register again (without re-importing) or the provider stays
  missing for the life of the process. Rollout safety for consumers that
  register their own `llama-cpp` provider lives in the auto-load guard (§3),
  which never invokes the loader when the name is already registered.
- **Idempotency + concurrency.** One cached promise per process; concurrent
  first calls share it. A *failed* load clears the cache so the caller can
  retry after fixing the environment (e.g. after installing the package). A
  second call with a different `entryPath` after a successful load returns the
  already-loaded module (first load wins); this is documented on the function.
- **Errors.** If the import fails because the `smoltalk-llama-cpp` specifier
  itself is unresolvable (`ERR_MODULE_NOT_FOUND` naming that specifier), throw
  a `SmolError`: `The llama-cpp provider needs the optional smoltalk-llama-cpp
  package. Install it (npm i smoltalk-llama-cpp) and try again.` Any other
  failure (the package is present but its own import chain broke, e.g. a
  node-llama-cpp binary problem) is rethrown wrapped with context — the
  install hint would be actively misleading there.

Registry introspection needs one small addition to `client.ts`:

```ts
export function hasProvider(providerName: string): boolean;
```

(true for names in `registeredProviders`; the built-in switch cases are not
its concern — the loader and the auto-load guard only ask about the custom
registry).

### 3. Auto-load on first use (packages/smoltalk/lib/functions.ts)

`textSync` and `textStream` gain one guard before their `getClient` call:

```ts
if (config.provider === "llama-cpp" && !hasProvider("llama-cpp")) {
  await loadLlamaCpp();
}
```

Both functions are already async, so awaiting there changes no public API
shape. The trigger is the *explicit* provider name only: llama-cpp models are
arbitrary `.gguf` paths that can never be inferred from the model registry, so
`config.provider === "llama-cpp"` is the complete condition. Other custom
providers are untouched (their `registerProvider` contract is unchanged), and
the embedding/image/transcription/speech paths are untouched (llama-cpp
serves text only).

The `hasProvider` check is what makes rollout safe: a consumer that already
registers its own `llama-cpp` provider (agency's current wrapper does) keeps
working unchanged — the loader is never invoked underneath it and no import
is attempted.

One shape note: `textStream` is an async generator, so the guard runs on the
first `next()` call, not when the generator is created. A missing package
therefore surfaces as the install-hint `SmolError` thrown from the stream's
first iteration (not as an `error` chunk) — the same place `getClient`'s
provider errors already surface on this path.

`getClient` itself stays synchronous. Its unknown-provider error gets one
addition: when the unknown provider is exactly `"llama-cpp"`, the message says
the provider loads automatically via `text()` and points at
`loadLlamaCpp()` for direct `getClient` users, instead of the generic
"register it first via registerProvider" text.

### 4. Plugin ergonomics (packages/smoltalk-llama-cpp)

Two additive changes, so consumers need no adapter code:

**`LlamaCPP` accepts a `.gguf` path as the model.** Today the constructor
requires `config.metadata.llamaCppModelDir` plus a bare-filename
`config.model`, and agency carries a subclass whose only job is splitting a
path into that shape. Move the split into the constructor. When no
`llamaCppModelDir` was given, classify `config.model`:

- **URI-shaped** — matches a scheme prefix, `/^[a-zA-Z][a-zA-Z0-9+.-]+:/`
  (two-plus characters before the colon, so Windows drive-letter paths like
  `C:\models\x.gguf` are *not* URIs): reject with an instructive error, never
  split. `LlamaCPP` only ever consumes local files — downloading is
  `resolveModel`'s job — but node-llama-cpp model URIs
  (`hf:org/repo/file.gguf`) are a likely wrong input here: node-llama-cpp's
  docs use them everywhere and `resolveModel` accepts them, and naively
  splitting one on `/` produces a mangled local path that fails far away as
  an opaque file-not-found. The error says what to do instead:
  `llama-cpp needs a local .gguf path. To download or resolve "<model>",
  call resolveModel() first and pass its result as the model.`
- **Path-shaped** — contains a path separator (`/` or `\`): derive
  `llamaCppModelDir = dirname(model)` and `model = basename(model)`.
- **Bare filename** — neither of the above: unchanged behavior (explicit
  `metadata.llamaCppModelDir` required, same error as today when missing).

The existing explicit-metadata form keeps working unchanged; explicit
metadata wins — when `llamaCppModelDir` is present, `config.model` is used
as-is and no classification happens at all.

**Export `resolveModel(uriOrPath, cacheDir)`.** A thin wrapper over
node-llama-cpp's `resolveModelFile` (with `{ directory: cacheDir, cli: true }`
for download progress), returning an existing `.gguf` path absolutized (so the
result is always directly consumable as `config.model`). The
plugin imports node-llama-cpp statically already, so this is a few lines. It
gives hosts a supported way to download/locate model files through the same
package that will run them — replacing agency's wrapper, which today re-derives
node-llama-cpp's location with `createRequire` gymnastics.

These changes ship as smoltalk-llama-cpp **0.2.0** (new exports, no breaking
changes; existing 0.1.x consumers are unaffected).

### 5. Public API summary

New exports from `smoltalk`:
- `loadLlamaCpp(options?: { entryPath?: string }): Promise<LlamaCppModule>`
- `hasProvider(name: string): boolean`
- `type LlamaCppModule`

New exports from `smoltalk-llama-cpp`:
- `resolveModel(uriOrPath: string, cacheDir: string): Promise<string>`

Changed behavior:
- `text()`/`textSync()`/`textStream()` with `provider: "llama-cpp"` auto-load
  the plugin (skipped when the name is already registered).
- `LlamaCPP` accepts a path-shaped `config.model`, and rejects URI-shaped
  models (`hf:`, `https:`, …) with an error pointing at `resolveModel`.
- `getClient`'s unknown-provider error is specialized for `"llama-cpp"`.

Everything else is untouched.

## Testing

**smoltalk unit tests** (new `llamaCppLoader.test.ts`, plus a `functions`
case), with the dynamic import stubbed (`vi.mock` of the specifier, or an
injectable import function on the loader — pick whichever matches existing
smoltalk test conventions):

- First `text()` call with `provider: "llama-cpp"` triggers exactly one load;
  concurrent calls share the in-flight promise.
- A pre-existing `registerProvider("llama-cpp", …)` registration suppresses
  the auto-load path entirely (no import attempted from `text()`); a *direct*
  `loadLlamaCpp()` call still imports and returns the module but leaves the
  existing registration untouched.
- Missing-package failure produces the install-hint `SmolError`; a
  present-but-broken package produces the wrapped real error, not the hint.
- A failed load is retryable (cache cleared); a successful load is cached
  (second call performs no import).
- Successful load → `unregisterProvider("llama-cpp")` → another load call (or
  auto-loading `text()` call) re-registers from the cached module without a
  second import.
- A module without a `LlamaCPP` export is rejected with the
  not-a-smoltalk-llama-cpp-module error; a module with `LlamaCPP` but no
  `resolveModel` (a 0.1.x install) is rejected with the upgrade-hint error —
  the two are distinguished.
- `hasProvider` reflects register/unregister.
- `getClient({ provider: "llama-cpp" })` without a prior load throws the
  specialized message.

**Plugin tests** (in packages/smoltalk-llama-cpp, which already dev-depends on
smoltalk):

- Constructor derivation: path-shaped model → split into dir + basename;
  explicit `llamaCppModelDir` still wins; bare filename + metadata unchanged;
  URI-shaped model (`hf:org/repo/file.gguf`) → the instructive
  call-resolveModel-first error, not a split; Windows drive-letter path
  (`C:\models\x.gguf`) is classified as a path, not a URI.
- `resolveModel` returns an existing `.gguf` path (absolutized) without
  touching the resolver.
- Registration integration: `loadLlamaCpp({ entryPath: <own entry> })`
  registers a working class under `"llama-cpp"` (no model inference — the
  existing heavyweight tests keep covering that).

## Release sequencing

1. smoltalk-llama-cpp 0.2.0 (constructor derivation + `resolveModel`).
2. smoltalk 0.11.0 (peer declaration + loader + auto-load), peering on
   `>=0.2.0 <1.0.0`.

The order matters only for the peer range being satisfiable at publish time.
A machine that nonetheless ends up with new smoltalk beside plugin 0.1.x
(peer ranges warn, they don't enforce) is rejected at load time by the
validation step with the explicit upgrade message — not served degraded, and
not given the misleading not-a-smoltalk-llama-cpp-module error.

## Follow-up in agency-lang (out of scope, the payoff)

Recorded so the cleanup doesn't get lost; each is a separate agency PR after
the smoltalk release:

- Replace the bundled `lib/stdlib/providers/llama-cpp.mjs` wrapper, the
  `AGENCY_SMOLTALK_LLAMA_CPP_PATH` env relay, and the injected
  `registerProvider` path for llama-cpp with a single
  `loadLlamaCpp({ entryPath })` call, where `entryPath` comes from agency's
  existing global-roots probe (`resolveSmoltalkLlamaCppEntry`). Downloading
  goes through the module returned by the loader (`resolveModel`), deleting
  `loadNodeLlamaCpp` and `splitModelPath`.
- `agency run --local <name>`: with the seam in smoltalk, this reduces to
  resolve/download via the catalog, then set
  `client.defaultProvider = "llama-cpp"` and `client.defaultModel = <path>`
  through the ordinary config path.
- Agency keeps unchanged: the curated catalog, aliases, SHA-256 pinning and
  verification, the models cache dir, and all `agency local` commands.
