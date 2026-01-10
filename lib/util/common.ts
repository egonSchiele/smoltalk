import { FunctionDeclaration } from "@google/genai";

/**
 * OpenAI tool definition format
 */
export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
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
export function convertOpenAIToolToGoogle(
  openAITool: OpenAIToolDefinition
): FunctionDeclaration {
  return {
    name: openAITool.function.name,
    description: openAITool.function.description,
    parametersJsonSchema: removeUnsupportedProperties(
      openAITool.function.parameters
    ),
  };
}
