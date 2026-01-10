import { FunctionDeclaration } from "@google/genai";
import { z } from "zod";

type OpenAIToolParameters = {
  type: "object";
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
};

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: OpenAIToolParameters;
  };
};

export function zodToOpenAITool(
  name: string,
  schema: z.ZodType,
  options: Partial<{
    description?: string;
    strict?: boolean;
  }> = {}
): OpenAITool {
  // Convert Zod schema to JSON Schema
  const jsonSchema = schema.toJSONSchema();

  let description: string = "";
  if (options?.description) {
    description = options.description;
  } else if (
    typeof jsonSchema === "object" &&
    "description" in jsonSchema &&
    typeof jsonSchema.description === "string"
  ) {
    description = jsonSchema.description;
  }

  // Build the parameters object
  const parameters: OpenAIToolParameters = {
    type: "object",
    properties: jsonSchema.properties || {},
    required: jsonSchema.required || [],
  };

  const strict = options?.strict || false;

  /* The additionalProperties field in an OpenAI schema,
  which is based on JSON Schema, controls how the API handles
  properties not explicitly listed in the properties section of an object. 
  By default, additionalProperties is set to true, which allows
  the JSON object to contain any extra properties not defined in the schema.
  */
  parameters.additionalProperties = !strict;

  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
    },
  };
}

/**
 * Removes properties that Google's API doesn't support from JSON schemas
 */
function removeUnsupportedProperties(
  obj: Record<string, unknown>
): Record<string, unknown> {
  if (typeof obj === "object" && obj !== null) {
    const newObj = { ...obj };

    // Remove properties that Google's API doesn't support
    delete newObj.additionalProperties;
    delete newObj.$schema;
    delete newObj.strict;

    // Recursively process nested objects and arrays
    for (const key in newObj) {
      if (key in newObj) {
        if (Array.isArray(newObj[key])) {
          newObj[key] = (newObj[key] as unknown[]).map((item) =>
            typeof item === "object" && item !== null
              ? removeUnsupportedProperties(item as Record<string, unknown>)
              : item
          );
        } else if (typeof newObj[key] === "object" && newObj[key] !== null) {
          newObj[key] = removeUnsupportedProperties(
            newObj[key] as Record<string, unknown>
          );
        }
      }
    }

    return newObj;
  }

  return obj;
}

/**
 * Converts an OpenAI tool definition to a Google FunctionDeclaration format
 *
 * @param openAITool - The tool definition in OpenAI format
 * @returns The tool definition in Google FunctionDeclaration format
 *
 * @example
 * ```ts
 * const openAITool = {
 *   type: "function" as const,
 *   function: {
 *     name: "add",
 *     description: "Adds two numbers together",
 *     parameters: {
 *       type: "object",
 *       properties: {
 *         a: { type: "number", description: "First number" },
 *         b: { type: "number", description: "Second number" }
 *       },
 *       required: ["a", "b"],
 *       additionalProperties: false
 *     }
 *   }
 * };
 *
 * const googleTool = convertOpenAIToolToGoogle(openAITool);
 * // Returns:
 * // {
 * //   name: "add",
 * //   description: "Adds two numbers together",
 * //   parametersJsonSchema: {
 * //     type: "object",
 * //     properties: {
 * //       a: { type: "number", description: "First number" },
 * //       b: { type: "number", description: "Second number" }
 * //     },
 * //     required: ["a", "b"]
 * //   }
 * // }
 * ```
 */
export function openAIToGoogleTool(
  openAITool: OpenAITool
): FunctionDeclaration {
  return {
    name: openAITool.function.name,
    description: openAITool.function.description,
    parametersJsonSchema: removeUnsupportedProperties(
      openAITool.function.parameters
    ),
  };
}

export function zodToGoogleTool(
  name: string,
  schema: z.ZodType,
  options: Partial<{
    description?: string;
    strict?: boolean;
  }> = {}
): FunctionDeclaration {
  const openAITool = zodToOpenAITool(name, schema, options);
  return openAIToGoogleTool(openAITool);
}
