import { describe, it, expect } from "vitest";
import * as smoltalk from "./index.js";

describe("public exports", () => {
  it("exports builders and normalizeImageRef", () => {
    expect(typeof smoltalk.imagePart).toBe("function");
    expect(typeof smoltalk.filePart).toBe("function");
    expect(typeof smoltalk.textPart).toBe("function");
    expect(typeof smoltalk.userMessage).toBe("function");
    expect(typeof smoltalk.normalizeImageRef).toBe("function");
  });

  it("exports the files API", () => {
    expect(typeof smoltalk.uploadFile).toBe("function");
    expect(typeof smoltalk.deleteFile).toBe("function");
    expect(typeof smoltalk.registerFileProvider).toBe("function");
    expect(typeof smoltalk.loadBlob).toBe("function");
  });
});
