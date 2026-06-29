import { describe, it, expect } from "vitest";
import * as smoltalk from "./index.js";

describe("public registration exports", () => {
  it("exposes embedding and image provider registration", () => {
    expect(typeof smoltalk.registerEmbeddingProvider).toBe("function");
    expect(typeof smoltalk.registerImageProvider).toBe("function");
  });
});
