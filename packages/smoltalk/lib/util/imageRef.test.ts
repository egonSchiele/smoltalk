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
      ).rejects.toThrow(/Could not determine an allowed MIME type/);
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
    ).rejects.toThrow(/Could not determine an allowed MIME type/);
    fetchSpy.mockRestore();
  });

  it("passes the configured timeout to fetch via AbortSignal.timeout", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/png" },
      }),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    await normalizeImageRef({
      kind: "url",
      url: "https://example.com/x",
      timeoutMs: 1234,
    });
    expect(timeoutSpy).toHaveBeenCalledWith(1234);
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
    timeoutSpy.mockRestore();
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

describe("normalizeImageRef MIME prefix + size options", () => {
  it("accepts a .pdf path when application/pdf is allowed", async () => {
    const path = join(tmpdir(), `smoltalk-test-${Date.now()}-doc.pdf`);
    writeFileSync(path, Buffer.from("%PDF-1.4 fake"));
    try {
      const out = await normalizeImageRef(
        { kind: "path", path },
        { allowedMimePrefixes: ["application/pdf"] },
      );
      expect(out.mimeType).toBe("application/pdf");
    } finally {
      unlinkSync(path);
    }
  });

  it("throws for a .pdf path under the default image-only prefixes", async () => {
    const path = join(tmpdir(), `smoltalk-test-${Date.now()}-doc2.pdf`);
    writeFileSync(path, Buffer.from("%PDF-1.4 fake"));
    try {
      await expect(normalizeImageRef({ kind: "path", path })).rejects.toThrow(/allowed MIME type/);
    } finally {
      unlinkSync(path);
    }
  });

  it("accepts a url whose Content-Type is allowed", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/pdf" } }),
    );
    const out = await normalizeImageRef(
      { kind: "url", url: "https://x/y.pdf" },
      { allowedMimePrefixes: ["application/pdf"] },
    );
    expect(out.mimeType).toBe("application/pdf");
    fetchSpy.mockRestore();
  });

  it("accepts a pdf base64 ref when application/pdf is allowed", async () => {
    const out = await normalizeImageRef(
      { kind: "base64", base64: "AAA", mimeType: "application/pdf" },
      { allowedMimePrefixes: ["application/pdf"] },
    );
    expect(out.mimeType).toBe("application/pdf");
  });

  it("throws when the resolved data exceeds maxBytes", async () => {
    const big = Buffer.alloc(100).toString("base64");
    await expect(
      normalizeImageRef({ kind: "base64", base64: big, mimeType: "image/png" }, { maxBytes: 10 }),
    ).rejects.toThrow(/exceeds the maximum size/);
  });
});
