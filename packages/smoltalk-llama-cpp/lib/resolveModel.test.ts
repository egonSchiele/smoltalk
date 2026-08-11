import { describe, it, expect } from "vitest";
import { mkdtemp, realpath, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveModel } from "./resolveModel.js";

// realpath: on macOS tmpdir() is a symlink (/var → /private/var), and cwd is
// always the real path, so resolve-from-cwd assertions need the real dir.
async function makeModelDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "smoltalk-llama-"));
  return realpath(dir);
}

describe("resolveModel", () => {
  it("returns an existing absolute .gguf path unchanged without touching the resolver", async () => {
    const dir = await makeModelDir();
    const filePath = path.join(dir, "model.gguf");
    // Garbage bytes: if the resolver were consulted it would choke; returning
    // the path unchanged proves the early-exit worked.
    await writeFile(filePath, "not a real gguf");

    await expect(resolveModel(filePath, dir)).resolves.toBe(filePath);
  });

  it("absolutizes an existing bare relative filename so LlamaCPP can consume it", async () => {
    const dir = await makeModelDir();
    const filePath = path.join(dir, "model.gguf");
    await writeFile(filePath, "not a real gguf");

    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      await expect(resolveModel("model.gguf", dir)).resolves.toBe(filePath);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
