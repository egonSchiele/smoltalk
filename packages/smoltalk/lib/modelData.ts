import z from "zod";
import type { ModelType } from "./models.js";
import { Result, success, failure } from "./types/result.js";

export const SUPPORTED_SCHEMA_VERSION = 1;

export type HostedTool = {
  name: string;
  provider: string;
  description?: string;
  costPerCall?: number;
  inputTokenCost?: number;
  outputTokenCost?: number;
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

const HostedToolSchema = z
  .object({
    name: z.string(),
    provider: z.string(),
    description: z.string().optional(),
    costPerCall: z.number().optional(),
    inputTokenCost: z.number().optional(),
    outputTokenCost: z.number().optional(),
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

  const env = EnvelopeSchema.safeParse(json);
  if (!env.success) {
    return failure(`Model data blob is malformed: ${z.prettifyError(env.error)}`);
  }
  if (env.data.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return failure(
      `Model data schemaVersion ${env.data.schemaVersion} is newer than this smoltalk supports (${SUPPORTED_SCHEMA_VERSION}). Please upgrade smoltalk.`,
    );
  }

  const models: ModelType[] = [];
  for (const entry of env.data.models) {
    const parsed = ModelEntrySchema.safeParse(entry);
    if (!parsed.success) {
      console.warn(`Skipping invalid model entry: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    models.push(parsed.data as unknown as ModelType);
  }

  const hostedTools: HostedTool[] = [];
  let rawTools: unknown[] = [];
  if (env.data.hostedTools) {
    rawTools = env.data.hostedTools;
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
    schemaVersion: env.data.schemaVersion,
    generatedAt: env.data.generatedAt,
    models,
    hostedTools,
  });
}
