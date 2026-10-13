// Types for the "#..." names in the "imports" field of package.json.
//
// Node and esbuild resolve those names through package.json, to a file per
// platform under dist/. TypeScript cannot, on a fresh checkout, because
// dist/ does not exist yet, so the names are declared here and TypeScript
// falls back to these declarations when resolution fails. Keep this file,
// the "imports" field, and vitest.config.ts in step.

declare module "#platform" {
  import type { Platform } from "./platform.js";
  export const readFileBytes: Platform["readFileBytes"];
  export const readTextFromFileUrl: Platform["readTextFromFileUrl"];
  export const pathToFileUrl: Platform["pathToFileUrl"];
  export const env: Platform["env"];
}

declare module "#ollama" {
  export * from "ollama";
}
