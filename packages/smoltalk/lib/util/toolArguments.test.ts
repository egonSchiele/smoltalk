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
      { baseUrl: "https://example.com", allowedDomains: "[]", headers: null, timeout: null, body: "null" },
      fetchSchema,
    );
    expect(result.args.allowedDomains).toEqual([]);
    expect(result.args.body).toBe("null");
    expect(result.repairedKeys).toEqual(["allowedDomains"]);
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
