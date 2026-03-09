import path from "path";

import { configDefaults, defineConfig } from "vitest/config";

const config = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["./lib/**/*.test.{js,ts,tsx}", "./tests/**/*.test.{js,ts,tsx}"],
    exclude: [...configDefaults.exclude, "./build/**/*", "./dist/**/*"],
    coverage: {
      exclude: ["index.ts"],
    },
  },
  resolve: {
    alias: [{ find: "@/lib", replacement: path.resolve(__dirname, "./lib") }],
  },
});

export default config;
