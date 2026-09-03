# smoltalk models site

A static page listing every model in the smoltalk registry, with sortable
tables per model type. Deployed to Vercel.

```bash
pnpm --filter site dev        # http://localhost:5173
pnpm --filter site build      # static output in site/dist
pnpm --filter site test
```

## Where the data comes from

`scripts/generate-model-data.ts` imports the model arrays from
`packages/smoltalk/lib/models.ts` and writes `src/data/models.json`. It runs
automatically as `predev` and `prebuild`, so the page is never staler than the
last build, and there is no second copy of the model data to maintain — add a
model to the registry, redeploy, and it appears here.

`src/data/models.json` is generated and gitignored.

The site imports model *types* from the package with a type-only import, which
is erased at compile time. That keeps the types exactly as accurate as the
registry's while keeping smoltalk itself out of the browser bundle — it reaches
for `node:fs`, so importing it at runtime would not build.

## Deployment

`vercel.json` at the repo root sets the build command
(`pnpm --filter site build`) and output directory (`site/dist`). Static output;
no server functions.
