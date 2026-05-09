import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  zodToOpenAITool,
  zodToOpenAIResponsesTool,
  openAIToGoogleTool,
  zodToGoogleTool,
} from "./tool.js";

const addSchema = z.object({
  a: z.number().describe("First number"),
  b: z.number().describe("Second number"),
});

const nestedSchema = z.object({
  user: z.object({
    name: z.string(),
    age: z.number(),
  }),
  tags: z.array(z.string()),
});

describe("zodToOpenAITool", () => {
  it("converts a basic Zod schema to OpenAI tool format", () => {
    const tool = zodToOpenAITool("add", addSchema);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("add");
    expect(tool.function.parameters.type).toBe("object");
    expect(tool.function.parameters.properties).toHaveProperty("a");
    expect(tool.function.parameters.properties).toHaveProperty("b");
    expect(tool.function.parameters.required).toContain("a");
    expect(tool.function.parameters.required).toContain("b");
  });

  it("uses the provided description option", () => {
    const tool = zodToOpenAITool("add", addSchema, {
      description: "Adds two numbers",
    });
    expect(tool.function.description).toBe("Adds two numbers");
  });

  it("extracts description from the Zod schema when not provided", () => {
    const described = z.object({ x: z.number() }).describe("A described schema");
    const tool = zodToOpenAITool("test", described);
    expect(tool.function.description).toBe("A described schema");
  });

  it("defaults to empty description when none available", () => {
    const tool = zodToOpenAITool("test", z.object({ x: z.number() }));
    expect(tool.function.description).toBe("");
  });

  it("sets additionalProperties to true when strict is false (default)", () => {
    const tool = zodToOpenAITool("test", addSchema);
    expect(tool.function.parameters.additionalProperties).toBe(true);
  });

  it("sets additionalProperties to false when strict is true", () => {
    const tool = zodToOpenAITool("test", addSchema, { strict: true });
    expect(tool.function.parameters.additionalProperties).toBe(false);
  });
});

describe("zodToOpenAIResponsesTool", () => {
  it("converts a Zod schema to OpenAI Responses tool format", () => {
    const tool = zodToOpenAIResponsesTool("add", addSchema);
    expect(tool.type).toBe("function");
    expect(tool.name).toBe("add");
    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.properties).toHaveProperty("a");
    expect(tool.strict).toBe(false);
  });

  it("sets strict to true when requested", () => {
    const tool = zodToOpenAIResponsesTool("add", addSchema, { strict: true });
    expect(tool.strict).toBe(true);
    expect(tool.parameters.additionalProperties).toBe(false);
  });

  it("includes description when provided via options", () => {
    const tool = zodToOpenAIResponsesTool("add", addSchema, {
      description: "Add numbers",
    });
    expect(tool.description).toBe("Add numbers");
  });

  it("extracts description from Zod schema", () => {
    const described = z.object({ x: z.number() }).describe("Schema desc");
    const tool = zodToOpenAIResponsesTool("test", described);
    expect(tool.description).toBe("Schema desc");
  });

  it("omits description field when none available", () => {
    const tool = zodToOpenAIResponsesTool("test", z.object({ x: z.number() }));
    expect(tool.description).toBeUndefined();
  });
});

describe("openAIToGoogleTool", () => {
  it("converts an OpenAI tool to Google FunctionDeclaration format", () => {
    const openAITool = {
      type: "function" as const,
      function: {
        name: "add",
        description: "Adds two numbers",
        parameters: {
          type: "object" as const,
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"] as string[],
          additionalProperties: false,
        },
      },
    };
    const google = openAIToGoogleTool(openAITool);
    expect(google.name).toBe("add");
    expect(google.description).toBe("Adds two numbers");
    expect(google.parametersJsonSchema).toBeDefined();
  });

  it("strips additionalProperties from the parameters", () => {
    const openAITool = {
      type: "function" as const,
      function: {
        name: "test",
        description: "test",
        parameters: {
          type: "object" as const,
          properties: { x: { type: "number" } },
          required: ["x"] as string[],
          additionalProperties: false,
        },
      },
    };
    const google = openAIToGoogleTool(openAITool);
    expect(google.parametersJsonSchema).not.toHaveProperty(
      "additionalProperties",
    );
  });

  it("strips $schema and strict from nested objects", () => {
    const openAITool = {
      type: "function" as const,
      function: {
        name: "test",
        description: "test",
        parameters: {
          type: "object" as const,
          properties: {
            nested: {
              type: "object",
              $schema: "http://json-schema.org/draft-07",
              strict: true,
              properties: { y: { type: "string" } },
            },
          },
          required: [] as string[],
          $schema: "http://json-schema.org/draft-07",
        },
      },
    };
    const google = openAIToGoogleTool(openAITool);
    const params = google.parametersJsonSchema as Record<string, any>;
    expect(params).not.toHaveProperty("$schema");
    expect(params.properties.nested).not.toHaveProperty("$schema");
    expect(params.properties.nested).not.toHaveProperty("strict");
  });
});

describe("zodToGoogleTool", () => {
  it("converts a Zod schema to Google format via OpenAI intermediate", () => {
    const google = zodToGoogleTool("add", addSchema, {
      description: "Adds two numbers",
    });
    expect(google.name).toBe("add");
    expect(google.description).toBe("Adds two numbers");
    expect(google.parametersJsonSchema).toBeDefined();
    const params = google.parametersJsonSchema as Record<string, any>;
    expect(params).not.toHaveProperty("additionalProperties");
  });

  it("handles nested object schemas", () => {
    const google = zodToGoogleTool("create_user", nestedSchema, {
      description: "Create a user",
    });
    expect(google.name).toBe("create_user");
    const params = google.parametersJsonSchema as Record<string, any>;
    expect(params.properties).toHaveProperty("user");
    expect(params.properties).toHaveProperty("tags");
  });
});
