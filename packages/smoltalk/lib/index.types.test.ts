import { describe, it, expect } from "vitest";
// Compile-only: fails typecheck if any of these type exports is missing.
import type {
  ProviderFileRef,
  AttachmentSource,
  FileProvider,
  UploadFileOptions,
  FileProviderContext,
  BlobRef,
} from "./index.js";

type _All = ProviderFileRef | AttachmentSource | FileProvider | UploadFileOptions | FileProviderContext | BlobRef;

describe("type exports", () => {
  it("compiles", () => {
    const x: BlobRef = { kind: "base64", base64: "A", mimeType: "image/png" };
    expect(x.kind).toBe("base64");
  });
});
