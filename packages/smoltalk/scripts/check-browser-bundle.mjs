// Checks that smoltalk bundles for the browser.
//
// It bundles lib/index.ts with esbuild under --platform=browser, with every
// Node builtin marked external so the bundle completes and the metafile
// records who imported what. Then it fails when a file under smoltalk's own
// lib/ imports a Node builtin ("node:fs", "fs", "url", ...). Imports inside
// node_modules are not checked: @anthropic-ai/sdk does `await
// import("node:fs")` in its credential chain, on the path taken when no API
// key is passed, and smoltalk cannot change that. A browser bundle of
// smoltalk therefore needs `--external:node:*` (Vite does this on its own).
//
// `node scripts/check-browser-bundle.mjs` from packages/smoltalk. Part of
// `pnpm check:browser` and of CI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Packages left out of the bundle. Empty: every dependency is bundled. */
const EXTERNAL_PACKAGES = [];

const builtins = new Set(builtinModules.filter((name) => !name.startsWith("_")));

function isNodeBuiltin(specifier) {
  return specifier.startsWith("node:") || builtins.has(specifier);
}

function bundleMetafile() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "smoltalk-browser-bundle-"));
  const metafile = path.join(scratch, "meta.json");
  try {
    execFileSync(
      path.join(packageRoot, "node_modules/.bin/esbuild"),
      [
        "lib/index.ts",
        "--bundle",
        "--platform=browser",
        "--format=esm",
        // The "#..." names point at dist/; the check runs from source.
        "--alias:#platform=./lib/platform.browser.ts",
        "--alias:#ollama=ollama/browser",
        "--external:node:*",
        ...[...builtins].map((name) => `--external:${name}`),
        ...EXTERNAL_PACKAGES.map((name) => `--external:${name}`),
        `--metafile=${metafile}`,
        `--outfile=${path.join(scratch, "bundle.js")}`,
        "--log-level=warning",
      ],
      { cwd: packageRoot, stdio: ["ignore", "ignore", "inherit"] },
    );
    return JSON.parse(readFileSync(metafile, "utf8"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const meta = bundleMetafile();
const problems = [];
for (const [file, input] of Object.entries(meta.inputs)) {
  if (!file.startsWith("lib/")) {
    continue;
  }
  for (const entry of input.imports) {
    if (isNodeBuiltin(entry.path)) {
      problems.push(`${file} imports ${entry.path}. Reach the platform through #platform instead.`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const own = Object.keys(meta.inputs).filter((file) => file.startsWith("lib/")).length;
console.log(`check-browser-bundle: ${own} smoltalk files bundle for the browser with no Node import.`);
