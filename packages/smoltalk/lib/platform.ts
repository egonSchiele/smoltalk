/**
 * The functions smoltalk takes from the platform it runs on. Two files
 * implement them, `platform.node.ts` and `platform.browser.ts`, and the
 * `#platform` entry in package.json's `imports` picks one: Node resolves
 * it to the Node file, and a bundler run with its browser condition
 * (esbuild `--platform=browser`, Vite, webpack `target: "web"`) picks the
 * browser file. Shared code imports `#platform` and never `node:*`.
 *
 * The browser file throws from every file function and answers `undefined`
 * for every environment variable, so a browser caller passes API keys in
 * and cannot use path attachments, `file:` model data, or the llama.cpp
 * loader's `entryPath`.
 */
export type Platform = {
  /** The bytes of the file at `path`. With `maxBytes`, refuses a larger
   *  file before reading it, with a {@link FileTooLargeError}. */
  readFileBytes(path: string, maxBytes?: number): Promise<Uint8Array>;
  /** The extension of `path` including the dot, lower-cased, or "". */
  fileExtension(path: string): string;
  /** The text of the file a `file:` URL names, as UTF-8. */
  readTextFromFileUrl(url: string): Promise<string>;
  /** The `file:` URL for a file system path. */
  pathToFileUrl(path: string): string;
  /** The environment variable `name`, or `undefined` when unset or when
   *  the platform has no environment. */
  env(name: string): string | undefined;
};

/** Thrown by `readFileBytes` when the file is larger than `maxBytes`. */
export class FileTooLargeError extends Error {
  constructor(
    public readonly path: string,
    public readonly size: number,
    public readonly maxBytes: number,
  ) {
    super(`File ${path} is ${size} bytes, over the limit of ${maxBytes} bytes.`);
    this.name = "FileTooLargeError";
  }
}
