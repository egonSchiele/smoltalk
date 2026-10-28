import { describe, it, expect } from "vitest";
import { z } from "zod";
import { repairStringifiedArguments } from "./toolArguments.js";

// The shape Agency gives a fetch tool: optional parameters are nullable.
const fetchSchema = z.object({
  baseUrl: z.string(),
  allowedDomains: z.array(z.string()).nullable(),
  headers: z.record(z.string(), z.string()).nullable(),
  timeout: z.number().nullable(),
  body: z.union([z.record(z.string(), z.any()), z.string(), z.null()]),
});

describe("repairStringifiedArguments", () => {
  it("returns arguments that already parse as they are", () => {
    const args = { baseUrl: "https://example.com", allowedDomains: [], headers: {}, timeout: 30000, body: null };
    const result = repairStringifiedArguments(args, fetchSchema);
    expect(result.args).toBe(args);
    expect(result.repairedKeys).toEqual([]);
  });

  it("parses the arguments a provider sent as JSON text", () => {
    const result = repairStringifiedArguments(
      { baseUrl: "https://example.com", allowedDomains: '["example.com"]', headers: "{}", timeout: "30000", body: null },
      fetchSchema,
    );
    expect(result.args).toEqual({
      baseUrl: "https://example.com",
      allowedDomains: ["example.com"],
      headers: {},
      timeout: 30000,
      body: null,
    });
    expect(result.repairedKeys).toEqual(["allowedDomains", "headers", "timeout"]);
  });

  it("leaves a string the schema accepts, even when it reads as JSON", () => {
    const result = repairStringifiedArguments(
      { baseUrl: "https://example.com", allowedDomains: "[]", headers: null, timeout: null, body: "{}" },
      fetchSchema,
    );
    expect(result.args.allowedDomains).toEqual([]);
    expect(result.args.body).toBe("{}");
    expect(result.repairedKeys).toEqual(["allowedDomains"]);
  });

  it('also turns "null" into null for a parameter that takes null, once a repair proves the endpoint stringifies', () => {
    const result = repairStringifiedArguments(
      { baseUrl: "https://example.com", allowedDomains: "[]", headers: null, timeout: null, body: "null" },
      fetchSchema,
    );
    expect(result.args.allowedDomains).toEqual([]);
    expect(result.args.body).toBeNull();
    expect(result.repairedKeys).toEqual(["allowedDomains", "body"]);
  });

  it('leaves "null" as text when nothing else needed repairing', () => {
    const args = { baseUrl: "https://example.com", allowedDomains: [], headers: null, timeout: null, body: "null" };
    const result = repairStringifiedArguments(args, fetchSchema);
    expect(result.args).toBe(args);
    expect(result.repairedKeys).toEqual([]);
  });

  it('leaves "null" as text for a parameter that does not take null', () => {
    const schema = z.object({ baseUrl: z.string(), timeout: z.number() });
    const result = repairStringifiedArguments({ baseUrl: "null", timeout: "30" }, schema);
    expect(result.args).toEqual({ baseUrl: "null", timeout: 30 });
    expect(result.repairedKeys).toEqual(["timeout"]);
  });

  it("changes nothing when the schema cannot be checked synchronously", () => {
    const schema = z.object({
      url: z.string().refine(async () => true),
      timeout: z.number(),
    });
    const args = { url: "https://example.com", timeout: "30" };
    const result = repairStringifiedArguments(args, schema);
    expect(result.args).toBe(args);
    expect(result.repairedKeys).toEqual([]);
  });

  it("changes nothing when parsing the strings does not make the arguments fit", () => {
    // timeout is not JSON text, so the set still fails after allowedDomains is parsed.
    const args = { baseUrl: "https://example.com", allowedDomains: "[]", headers: null, timeout: "soon", body: null };
    const result = repairStringifiedArguments(args, fetchSchema);
    expect(result.args).toBe(args);
    expect(result.repairedKeys).toEqual([]);
  });

  it("changes nothing when a parsed string is still the wrong type", () => {
    const args = { baseUrl: "https://example.com", allowedDomains: "[1, 2]", headers: null, timeout: null, body: null };
    const result = repairStringifiedArguments(args, fetchSchema);
    expect(result.args).toBe(args);
    expect(result.repairedKeys).toEqual([]);
  });

  it("changes nothing when the failure is not a string at all", () => {
    const args = { allowedDomains: "[]", headers: null, timeout: null, body: null };
    const result = repairStringifiedArguments(args, fetchSchema);
    // baseUrl is missing, which no parsing can fix.
    expect(result.args).toBe(args);
    expect(result.repairedKeys).toEqual([]);
  });
});
