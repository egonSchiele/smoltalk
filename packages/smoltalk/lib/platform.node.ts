// The Node side of #platform. See platform.ts.
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FileTooLargeError, type Platform } from "./platform.js";

export const readFileBytes: Platform["readFileBytes"] = async (path, maxBytes) => {
  if (maxBytes !== undefined) {
    const info = await stat(path);
    if (info.size > maxBytes) {
      throw new FileTooLargeError(path, info.size, maxBytes);
    }
  }
  const buf = await readFile(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
};

export const fileExtension: Platform["fileExtension"] = (path) => extname(path).toLowerCase();

export const readTextFromFileUrl: Platform["readTextFromFileUrl"] = (url) =>
  readFile(fileURLToPath(url), "utf8");

export const pathToFileUrl: Platform["pathToFileUrl"] = (path) => pathToFileURL(path).href;

export const env: Platform["env"] = (name) => process.env[name];
