import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveModel } from "./resolveModel.js";

describe("resolveModel", () => {
  it("returns an existing .gguf path unchanged without touching the resolver", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "smoltalk-llama-"));
    const filePath = path.join(dir, "model.gguf");
    // Garbage bytes: if the resolver were consulted it would choke; returning
    // the path unchanged proves the early-exit worked.
    await writeFile(filePath, "not a real gguf");

    await expect(resolveModel(filePath, dir)).resolves.toBe(filePath);
  });
});
