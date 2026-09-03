/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The page footer reports which smoltalk the catalog came from. Read at config
// time (Node) and injected as a constant, so nothing at runtime needs to reach
// for a package.json.
const smoltalkPackage = JSON.parse(
  readFileSync(
    new URL("../packages/smoltalk/package.json", import.meta.url),
    "utf8",
  ),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __SMOLTALK_VERSION__: JSON.stringify(smoltalkPackage.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
