import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _setImportForTests, loadLlamaCpp } from "./llamaCppLoader.js";
import {
  getClient,
  hasProvider,
  registerProvider,
  unregisterProvider,
} from "../client.js";
import { TestProvider } from "../testing/index.js";

const fakeResolveModel = async (uriOrPath: string, _cacheDir: string) =>
  uriOrPath;

function fakeModule(): Record<string, unknown> {
  return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
}

function moduleNotFound(packageName: string): Error {
  const err = new Error(
    `Cannot find package '${packageName}' imported from /app/node_modules/smoltalk/dist/clients/llamaCppLoader.js`,
  );
  (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

beforeEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

afterEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

describe("loadLlamaCpp", () => {
  it("imports, registers under llama-cpp, and returns the module", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    const mod = await loadLlamaCpp();

    expect(importCount).toBe(1);
    expect(mod.LlamaCPP).toBe(TestProvider);
    expect(typeof mod.resolveModel).toBe("function");
    expect(hasProvider("llama-cpp")).toBe(true);
  });

  it("caches a successful load (second call performs no import)", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    await loadLlamaCpp();
    await loadLlamaCpp();

    expect(importCount).toBe(1);
  });

  it("shares one in-flight load between concurrent first calls", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    const [a, b] = await Promise.all([loadLlamaCpp(), loadLlamaCpp()]);

    expect(importCount).toBe(1);
    expect(a).toBe(b);
  });

  it("clears the cache on failure so a later call can retry", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      if (importCount === 1) {
        throw new Error("transient breakage");
      }
      return fakeModule();
    });

    await expect(loadLlamaCpp()).rejects.toThrow(/transient breakage/);
    const mod = await loadLlamaCpp();

    expect(importCount).toBe(2);
    expect(mod.LlamaCPP).toBe(TestProvider);
  });

  it("gives the install hint when the package itself is missing", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound("smoltalk-llama-cpp");
    });

    await expect(loadLlamaCpp()).rejects.toThrow(
      /Install it \(npm i smoltalk-llama-cpp\) and try again/,
    );
  });

  it("wraps other failures without the install hint (broken import chain)", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound("node-llama-cpp");
    });

    const failure = (await loadLlamaCpp().catch((e: Error) => e)) as Error;

    expect(failure.message).toMatch(/Failed to load smoltalk-llama-cpp/);
    expect(failure.message).toMatch(/node-llama-cpp/);
    expect(failure.message).not.toMatch(/npm i smoltalk-llama-cpp\)/);
  });

  it("rejects a module without a LlamaCPP export as not-the-package", async () => {
    _setImportForTests(async () => ({ somethingElse: true }));

    await expect(loadLlamaCpp()).rejects.toThrow(/does not export LlamaCPP/);
  });

  it("rejects a 0.1.x-shaped module (no resolveModel) with the upgrade hint", async () => {
    _setImportForTests(async () => ({ LlamaCPP: TestProvider }));

    await expect(loadLlamaCpp()).rejects.toThrow(
      /too old for this version of smoltalk.*>=0\.2\.0/s,
    );
  });

  it("leaves a pre-existing registration untouched but still returns the module", async () => {
    class PreRegistered extends TestProvider {}
    registerProvider("llama-cpp", PreRegistered);
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    const mod = await loadLlamaCpp();

    expect(importCount).toBe(1);
    expect(mod.LlamaCPP).toBe(TestProvider);
    const client = getClient({
      model: "any-model",
      provider: "llama-cpp",
      messages: [],
    });
    expect(client).toBeInstanceOf(PreRegistered);
  });

  it("re-registers from the cached module after unregisterProvider", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return fakeModule();
    });

    await loadLlamaCpp();
    unregisterProvider("llama-cpp");
    expect(hasProvider("llama-cpp")).toBe(false);

    await loadLlamaCpp();

    expect(importCount).toBe(1);
    expect(hasProvider("llama-cpp")).toBe(true);
  });

  it("imports from entryPath as a file URL when given", async () => {
    const seen: string[] = [];
    _setImportForTests(async (specifier) => {
      seen.push(specifier);
      return fakeModule();
    });

    await loadLlamaCpp({
      entryPath: "/opt/plugins/smoltalk-llama-cpp/dist/index.js",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith("file://")).toBe(true);
    expect(seen[0]).toContain("/opt/plugins/smoltalk-llama-cpp/dist/index.js");
  });
});
