import z from "zod";
import type { ModelType } from "./models.js";
import { Result, success, failure } from "./types/result.js";

export const SUPPORTED_SCHEMA_VERSION = 1;

// The price itself, with no per-model overrides. This is what
// hostedToolPricingFor() returns (a single resolved price).
export type HostedToolPrice = {
  unit: "per_call" | "per_session" | "per_hour" | "per_gb_day" | "tokens" | "free";
  amount?: number;        // USD per unit; omitted for free / token-based
  freeAllowance?: string; // human note of a free tier, e.g. "50 container-hours/day"
  note?: string;          // long-tail nuance (tiers, "+ content tokens", context-size)
};

export type HostedToolPricing = HostedToolPrice & {
  // Per-model overrides, merged over the base price (base field <- override field).
  // Overrides are plain prices — they cannot themselves carry perModel.
  perModel?: Record<string, Partial<HostedToolPrice>>;
};

export type HostedTool = {
  name: string;             // smoltalk canonical name, e.g. "web_search"
  provider: string;         // "anthropic" | "openai" | "google"
  category?: string;        // cross-provider grouping, e.g. "web_search" | "code_execution"
  description?: string;
  providerToolId?: string;  // the provider's real tool id, e.g. "web_search_preview"
  models?: string[];        // optional allowlist; omitted = all of provider's models
  pricing?: HostedToolPricing;
  disabled?: boolean;
};

export type ModelDataBlob = {
  schemaVersion: number;
  generatedAt: string;
  models: ModelType[];
  hostedTools: HostedTool[];
};

const EnvelopeSchema = z.object({
  schemaVersion: z.number(),
  generatedAt: z.string(),
  models: z.array(z.unknown()),
  hostedTools: z.array(z.unknown()).optional(),
});

// Permissive: require the fields smoltalk keys on, keep everything else.
const ModelEntrySchema = z
  .object({
    modelName: z.string(),
    provider: z.string(),
    type: z.string(),
  })
  .catchall(z.unknown());

// Per-model override: price fields only. No `.catchall`, so unknown keys
// (including a stray nested `perModel`) are stripped — the resolver can never
// reintroduce perModel into its result.
const PerModelPriceSchema = z.object({
  unit: z.string().optional(),
  amount: z.number().optional(),
  freeAllowance: z.string().optional(),
  note: z.string().optional(),
});

// `unit` stays a lenient string (forward-compat, mirroring ModelEntrySchema's
// `type: z.string()`); the closed union is the known/intended set.
const HostedToolPricingSchema = z
  .object({
    unit: z.string(),
    amount: z.number().optional(),
    freeAllowance: z.string().optional(),
    note: z.string().optional(),
    perModel: z.record(z.string(), PerModelPriceSchema).optional(),
  })
  .catchall(z.unknown());

const HostedToolSchema = z
  .object({
    name: z.string(),
    provider: z.string(),
    category: z.string().optional(),
    description: z.string().optional(),
    providerToolId: z.string().optional(),
    models: z.array(z.string()).optional(),
    pricing: HostedToolPricingSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .catchall(z.unknown());

export function parseModelDataBlob(raw: string): Result<ModelDataBlob> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return failure(`Model data is not valid JSON: ${String(err)}`);
  }

  const envelope = EnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    return failure(`Model data blob is malformed: ${z.prettifyError(envelope.error)}`);
  }
  if (envelope.data.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return failure(
      `Model data schemaVersion ${envelope.data.schemaVersion} is newer than this smoltalk supports (${SUPPORTED_SCHEMA_VERSION}). Please upgrade smoltalk.`,
    );
  }

  const models: ModelType[] = [];
  for (const entry of envelope.data.models) {
    const parsed = ModelEntrySchema.safeParse(entry);
    if (!parsed.success) {
      console.warn(`Skipping invalid model entry: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    models.push(parsed.data as unknown as ModelType);
  }

  const hostedTools: HostedTool[] = [];
  let rawTools: unknown[] = [];
  if (envelope.data.hostedTools) {
    rawTools = envelope.data.hostedTools;
  }
  for (const entry of rawTools) {
    const parsed = HostedToolSchema.safeParse(entry);
    if (!parsed.success) {
      console.warn(`Skipping invalid hosted tool: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    hostedTools.push(parsed.data as unknown as HostedTool);
  }

  return success({
    schemaVersion: envelope.data.schemaVersion,
    generatedAt: envelope.data.generatedAt,
    models,
    hostedTools,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null) {
    return false;
  }
  if (typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return true;
}

export function deepMergeEntry<T>(base: T, overlay: T): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay;
  }
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const overValue = overlay[key];
    if (overValue === undefined) {
      continue;
    }
    const currentValue = result[key];
    if (isPlainObject(currentValue) && isPlainObject(overValue)) {
      result[key] = deepMergeEntry(currentValue, overValue);
    } else {
      result[key] = overValue;
    }
  }
  return result as T;
}

function mergeByKey<T>(base: T[], overlay: T[], keyOf: (item: T) => string): T[] {
  const order: string[] = [];
  const map = new Map<string, T>();
  for (const item of base) {
    const key = keyOf(item);
    if (!map.has(key)) {
      order.push(key);
    }
    map.set(key, item);
  }
  for (const item of overlay) {
    const key = keyOf(item);
    const existing = map.get(key);
    if (existing === undefined) {
      order.push(key);
      map.set(key, item);
    } else {
      map.set(key, deepMergeEntry(existing, item));
    }
  }
  return order.map((key) => map.get(key) as T);
}

export function mergeModelData(base: ModelType[], overlay: ModelType[]): ModelType[] {
  return mergeByKey(base, overlay, (m) => `${m.provider}:${m.modelName}`);
}

export function mergeHostedTools(base: HostedTool[], overlay: HostedTool[]): HostedTool[] {
  return mergeByKey(base, overlay, (t) => `${t.provider}:${t.name}`);
}
