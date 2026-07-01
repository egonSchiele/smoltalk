import { describe, it, expect, vi } from "vitest";
import { normalizeImageRef, loadBlob } from "./imageRef.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadBlob (no MIME gate)", () => {
  it("loads a non-image base64 without gating", async () => {
    const out = await loadBlob({ kind: "base64", base64: "AAA", mimeType: "text/csv" });
    expect(out.mimeType).toBe("text/csv");
  });
  it("passes bytes through with its mime", async () => {
    const out = await loadBlob({ kind: "bytes", data: new Uint8Array([1, 2]), mimeType: "application/zip" });
    expect(out).toEqual({ data: new Uint8Array([1, 2]), mimeType: "application/zip" });
  });
  it("returns undefined mimeType for a path with an unknown extension (no gate)", async () => {
    const path = join(tmpdir(), `smoltalk-blob-${Date.now()}.bin`);
    writeFileSync(path, Buffer.from([1, 2]));
    try {
      const out = await loadBlob({ kind: "path", path });
      expect(out.mimeType).toBeUndefined();
      expect(Array.from(out.data)).toEqual([1, 2]);
    } finally {
      unlinkSync(path);
    }
  });
  it("loads a url without gating on Content-Type", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([9]), { headers: { "content-type": "application/octet-stream" } }),
    );
    const out = await loadBlob({ kind: "url", url: "https://x/y" });
    expect(out.mimeType).toBe("application/octet-stream");
    spy.mockRestore();
  });
  it("enforces maxBytes on a bytes/base64 source (S1)", async () => {
    const big = Buffer.alloc(100).toString("base64");
    await expect(
      loadBlob({ kind: "base64", base64: big, mimeType: "application/pdf" }, { maxBytes: 10 }),
    ).rejects.toThrow(/exceeds the maximum size/);
  });
  it("rejects a path over maxBytes before reading it (S1)", async () => {
    const path = join(tmpdir(), `smoltalk-blob-${Date.now()}-big.bin`);
    writeFileSync(path, Buffer.alloc(100));
    try {
      await expect(loadBlob({ kind: "path", path }, { maxBytes: 10 })).rejects.toThrow(/exceeds the maximum size/);
    } finally {
      unlinkSync(path);
    }
  });
  it("rejects non-http(s) URL schemes (S2)", async () => {
    // Benign target: the scheme guard must reject before any file read, so even
    // if it regressed this path points at nothing sensitive.
    await expect(loadBlob({ kind: "url", url: "file:///smoltalk-nonexistent-scheme-test" })).rejects.toThrow(/scheme/);
    await expect(loadBlob({ kind: "url", url: "gopher://x/" })).rejects.toThrow(/scheme/);
  });
});

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

  it("rejects an over-cap url on Content-Length before reading the body", async () => {
    let bodyRead = false;
    const body = new Response(new Uint8Array([1, 2, 3])).body;
    const fakeRes = {
      ok: true,
      headers: new Headers({ "content-type": "image/png", "content-length": "999999" }),
      get body() {
        bodyRead = true;
        return body;
      },
      arrayBuffer: async () => {
        bodyRead = true;
        return new Uint8Array([1, 2, 3]).buffer;
      },
    } as unknown as Response;
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(fakeRes);
    await expect(
      normalizeImageRef({ kind: "url", url: "https://x/big.png" }, { maxBytes: 10 }),
    ).rejects.toThrow(/exceeds the maximum size/);
    expect(bodyRead).toBe(false);
    fetchSpy.mockRestore();
  });

  it("aborts a streamed url body once it exceeds maxBytes (lying Content-Length)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      // 100 bytes of body, no/honest content-length absent → caught while streaming.
      new Response(new Uint8Array(100), { headers: { "content-type": "image/png" } }),
    );
    await expect(
      normalizeImageRef({ kind: "url", url: "https://x/y.png" }, { maxBytes: 10 }),
    ).rejects.toThrow(/exceeds the maximum size/);
    fetchSpy.mockRestore();
  });
});
