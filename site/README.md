# smoltalk models site

A static page listing every model in the smoltalk registry, with sortable
tables per model type. Deployed to Vercel.

```bash
pnpm --filter site dev        # http://localhost:5173
pnpm --filter site build      # static output in site/dist
pnpm --filter site test
```

## Where the data comes from

`src/types.ts` imports the catalog from `smoltalk/models` — a Node-free entry
point exposing the registry and its merge helpers without the provider SDKs or
the refresh fetcher. It bundles for the browser directly, so there is no
generated copy of the model data and nothing to keep in sync: add a model to
`lib/models.ts`, redeploy, and it appears.

`smoltalk/models` resolves to the package's `dist/`, so smoltalk has to be
built first. `pnpm --filter site dev` handles that itself via `predev`, and
`pnpm -r build` orders smoltalk ahead of the site because the site depends on
it. Deploys build it explicitly — see the build command in `vercel.json`.

There is deliberately no `prebuild` hook rebuilding smoltalk: under
`pnpm -r build` it would run `rm -rf dist && tsc` on the package while
smoltalk-llama-cpp is compiling against that same `dist`.

Building the site on its own from a clean checkout therefore needs smoltalk
built first:

```bash
pnpm --filter smoltalk build && pnpm --filter site build
```

The page footer's version and build date are injected by Vite's `define` from
`packages/smoltalk/package.json` at config time — see `vite.config.ts`.

## Deployment

`vercel.json` at the repo root sets the build command
(`pnpm --filter smoltalk build && pnpm --filter site build`), the install
command, and the static output directory (`site/dist`). No server functions.
