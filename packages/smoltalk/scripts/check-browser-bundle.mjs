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
// The metafile shows imports, not globals, so the script also greps lib/
// (test files and platform.node.ts aside) for `Buffer` and `process.env`,
// which bundle fine and fail only when the line runs.
//
// When dist/ exists, it bundles dist/index.js a second time with no aliases,
// so the "#..." entries in package.json are resolved the way a consumer's
// bundler resolves them, and checks that the browser files were chosen.
//
// `node scripts/check-browser-bundle.mjs` from packages/smoltalk. Part of
// `pnpm check:browser` and of CI, which builds first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

function bundleMetafile(entry, aliases) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "smoltalk-browser-bundle-"));
  const metafile = path.join(scratch, "meta.json");
  try {
    execFileSync(
      path.join(packageRoot, "node_modules/.bin/esbuild"),
      [
        entry,
        "--bundle",
        "--platform=browser",
        "--format=esm",
        ...aliases,
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

/** Every lib/*.ts the rule applies to: not a test, not the Node platform file. */
function sourceFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
        found.push(path.relative(packageRoot, full));
      }
    }
  };
  walk(path.join(packageRoot, "lib"));
  return found.filter((file) => file !== "lib/platform.node.ts").sort();
}

const problems = [];

// 1. Source bundle: no Node import in smoltalk's own files. The "#..." names
//    point at dist/, so they are aliased to the browser files here.
const source = bundleMetafile("lib/index.ts", [
  "--alias:#platform=./lib/platform.browser.ts",
  "--alias:#ollama=ollama/browser",
]);
for (const [file, input] of Object.entries(source.inputs)) {
  if (!file.startsWith("lib/")) {
    continue;
  }
  for (const entry of input.imports) {
    if (isNodeBuiltin(entry.path)) {
      problems.push(`${file} imports ${entry.path}. Reach the platform through #platform instead.`);
    }
  }
}

// 2. Node globals, which the metafile cannot show. Comment lines are skipped.
for (const file of sourceFiles()) {
  const text = readFileSync(path.join(packageRoot, file), "utf8");
  for (const [pattern, fix] of [
    [/\bBuffer\b/, "use lib/util/base64.ts"],
    [/process\.env\b/, "use env() from #platform"],
  ]) {
    const line = text
      .split("\n")
      .findIndex((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && pattern.test(l));
    if (line !== -1) {
      problems.push(`${file}:${line + 1} uses ${pattern.source.replace(/\\b/g, "")}; ${fix}.`);
    }
  }
}

// 3. The built package, resolved through package.json like a consumer's
//    bundler would: the browser files must be the ones chosen.
let built = "not built, skipped";
if (existsSync(path.join(packageRoot, "dist/index.js"))) {
  const dist = bundleMetafile("dist/index.js", []);
  const inputs = Object.keys(dist.inputs);
  const expect = (test, message) => {
    if (!test) {
      problems.push(`dist bundle: ${message}`);
    }
  };
  expect(inputs.includes("dist/platform.browser.js"), "#platform did not resolve to dist/platform.browser.js");
  expect(!inputs.includes("dist/platform.node.js"), "dist/platform.node.js is in the browser bundle");
  expect(inputs.some((f) => /ollama\/dist\/browser\./.test(f)), "#ollama did not resolve to ollama/browser");
  // An import of "ollama" by name, instead of "#ollama", pulls in the Node
  // build beside the browser one. Its node:fs import sits in node_modules,
  // where the import check above does not look, so check for the file.
  expect(!inputs.some((f) => /ollama\/dist\/index\./.test(f)), "ollama's Node build is in the browser bundle: import it from #ollama");
  for (const [file, input] of Object.entries(dist.inputs)) {
    if (!file.startsWith("dist/")) {
      continue;
    }
    for (const entry of input.imports) {
      if (isNodeBuiltin(entry.path)) {
        problems.push(`dist bundle: ${file} imports ${entry.path}.`);
      }
    }
  }
  built = "the built package picks the browser files through package.json";
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const own = Object.keys(source.inputs).filter((file) => file.startsWith("lib/")).length;
console.log(
  `check-browser-bundle: ${own} smoltalk files bundle for the browser with no Node import or global; ${built}.`,
);
