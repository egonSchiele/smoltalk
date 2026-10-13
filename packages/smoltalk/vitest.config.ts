import path from "node:path";
import { defineConfig } from "vitest/config";

// The "#..." entries mirror the "imports" field of package.json, which
// point at dist/. The tests run from source, so each name is aliased to
// the file Node would pick. Keep this in step with package.json and
// lib/packageImports.d.ts.
export default defineConfig({
  resolve: {
    alias: {
      "#platform": path.resolve(import.meta.dirname, "lib/platform.node.ts"),
      "#ollama": "ollama",
    },
  },
});
