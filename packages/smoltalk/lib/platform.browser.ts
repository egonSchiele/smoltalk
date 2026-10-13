// The browser side of #platform. See platform.ts. A browser has no file
// system and no environment, so every file function throws and `env`
// answers undefined.
import type { Platform } from "./platform.js";

function unavailable(fn: string): Error {
  return new Error(`${fn} is not available in a browser build of smoltalk.`);
}

export const readFileBytes: Platform["readFileBytes"] = async () => {
  throw unavailable("readFileBytes");
};

export const readTextFromFileUrl: Platform["readTextFromFileUrl"] = async () => {
  throw unavailable("readTextFromFileUrl");
};

export const pathToFileUrl: Platform["pathToFileUrl"] = () => {
  throw unavailable("pathToFileUrl");
};

export const env: Platform["env"] = () => undefined;
