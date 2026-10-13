import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as browser from "./platform.browser.js";
import * as node from "./platform.node.js";
import { FileTooLargeError, type Platform } from "./platform.js";

const NAMES: (keyof Platform)[] = [
  "readFileBytes",
  "readTextFromFileUrl",
  "pathToFileUrl",
  "env",
];

describe("#platform on Node", () => {
  it("exports every function", () => {
    for (const name of NAMES) {
      expect(typeof node[name]).toBe("function");
    }
  });

  it("reads a file's bytes and refuses one over maxBytes before reading", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "smoltalk-platform-"));
    const file = path.join(dir, "a.bin");
    await writeFile(file, new Uint8Array([1, 2, 3, 4]));
    expect(await node.readFileBytes(file)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await node.readFileBytes(file, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(node.readFileBytes(file, 3)).rejects.toBeInstanceOf(FileTooLargeError);
    await expect(node.readFileBytes(file, 3)).rejects.toMatchObject({ size: 4, maxBytes: 3 });
  });

  it("reads the text of a file: URL", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "smoltalk-platform-"));
    const file = path.join(dir, "a.txt");
    await writeFile(file, "héllo", "utf8");
    expect(await node.readTextFromFileUrl(node.pathToFileUrl(file))).toBe("héllo");
  });

  it("gives a file: URL", () => {
    expect(node.pathToFileUrl("/opt/a b/c.js")).toBe("file:///opt/a%20b/c.js");
  });

  it("reads the environment", () => {
    process.env.SMOLTALK_PLATFORM_TEST = "yes";
    try {
      expect(node.env("SMOLTALK_PLATFORM_TEST")).toBe("yes");
    } finally {
      delete process.env.SMOLTALK_PLATFORM_TEST;
    }
    expect(node.env("SMOLTALK_PLATFORM_TEST")).toBeUndefined();
  });
});

describe("#platform in a browser", () => {
  it("exports every function", () => {
    for (const name of NAMES) {
      expect(typeof browser[name]).toBe("function");
    }
  });

  it("throws from every file function, naming it", async () => {
    await expect(browser.readFileBytes("/x")).rejects.toThrow(
      "readFileBytes is not available in a browser build of smoltalk.",
    );
    await expect(browser.readTextFromFileUrl("file:///x")).rejects.toThrow(
      "readTextFromFileUrl is not available in a browser build of smoltalk.",
    );
    expect(() => browser.pathToFileUrl("/x")).toThrow(
      "pathToFileUrl is not available in a browser build of smoltalk.",
    );
  });

  it("answers undefined for every environment variable", () => {
    process.env.SMOLTALK_PLATFORM_TEST = "yes";
    try {
      expect(browser.env("SMOLTALK_PLATFORM_TEST")).toBeUndefined();
    } finally {
      delete process.env.SMOLTALK_PLATFORM_TEST;
    }
  });
});
