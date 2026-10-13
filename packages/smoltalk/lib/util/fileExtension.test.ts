import { extname } from "node:path";
import { describe, expect, it } from "vitest";
import { fileExtension } from "./fileExtension.js";

describe("fileExtension", () => {
  const cases = [
    "/x/photo.PNG",
    "/x/noext",
    "/x/.bashrc",
    "/x/archive.tar.gz",
    "/x.y/file",
    "/x/trailing.",
    "relative.jpg",
    "C:\\dir.d\\pic.JPEG",
    "",
    ".",
    "..",
    "...",
    "a..",
    ".a.",
  ];

  it("agrees with path.extname, lower-cased", () => {
    for (const path of cases) {
      expect(fileExtension(path), path).toBe(extname(path).toLowerCase());
    }
  });
});
