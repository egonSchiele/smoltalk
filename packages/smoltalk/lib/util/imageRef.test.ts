import { describe, it, expect, vi } from "vitest";
import { normalizeImageRef } from "./imageRef.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("normalizeImageRef", () => {
  it("passes through bytes refs", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const r = await normalizeImageRef({
      kind: "bytes",
      data,
      mimeType: "image/png",
    });
    expect(r.data).toBe(data);
    expect(r.mimeType).toBe("image/png");
  });

  it("decodes base64 refs", async () => {
    const r = await normalizeImageRef({
      kind: "base64",
      base64: Buffer.from([1, 2, 3]).toString("base64"),
      mimeType: "image/jpeg",
    });
    expect(Array.from(r.data)).toEqual([1, 2, 3]);
    expect(r.mimeType).toBe("image/jpeg");
  });

  it("reads from path and infers mimeType from extension", async () => {
    const path = join(tmpdir(), `smoltalk-test-${Date.now()}.png`);
    writeFileSync(path, Buffer.from([9, 9, 9]));
    try {
      const r = await normalizeImageRef({ kind: "path", path });
      expect(Array.from(r.data)).toEqual([9, 9, 9]);
      expect(r.mimeType).toBe("image/png");
    } finally {
      unlinkSync(path);
    }
  });

  it("fetches from URL and uses Content-Type", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([7, 7]), {
        headers: { "content-type": "image/webp" },
      }),
    );
    const r = await normalizeImageRef({
      kind: "url",
      url: "https://example.com/x",
    });
    expect(Array.from(r.data)).toEqual([7, 7]);
    expect(r.mimeType).toBe("image/webp");
    fetchSpy.mockRestore();
  });

  it("throws when path has unrecognized extension and no explicit mimeType", async () => {
    const path = join(tmpdir(), `smoltalk-test-${Date.now()}.bin`);
    writeFileSync(path, Buffer.from([1]));
    try {
      await expect(
        normalizeImageRef({ kind: "path", path }),
      ).rejects.toThrow(/Could not determine image MIME type/);
    } finally {
      unlinkSync(path);
    }
  });

  it("throws when URL response has no usable Content-Type and no explicit mimeType", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([7]), {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    await expect(
      normalizeImageRef({ kind: "url", url: "https://example.com/x" }),
    ).rejects.toThrow(/Could not determine image MIME type/);
    fetchSpy.mockRestore();
  });

  it("explicit mimeType on path/url overrides inferred", async () => {
    const path = join(tmpdir(), `smoltalk-test-${Date.now()}-2.png`);
    writeFileSync(path, Buffer.from([1]));
    try {
      const r = await normalizeImageRef({
        kind: "path",
        path,
        mimeType: "image/jpeg",
      });
      expect(r.mimeType).toBe("image/jpeg");
    } finally {
      unlinkSync(path);
    }
  });
});
