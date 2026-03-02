import { describe, it, expect } from "vitest";
import { UserMessage } from "./UserMessage.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { SystemMessage } from "./SystemMessage.js";
import { DeveloperMessage } from "./DeveloperMessage.js";
import { ToolMessage } from "./ToolMessage.js";
import { messageFromJSON } from "./index.js";
import { ToolCall } from "../ToolCall.js";

describe("UserMessage", () => {
  it("stores role, content, and name", () => {
    const msg = new UserMessage("hello", { name: "alice" });
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello");
    expect(msg.name).toBe("alice");
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips", () => {
      const original = new UserMessage("hi", { name: "bob" });
      const restored = UserMessage.fromJSON(original.toJSON());
      expect(restored.role).toBe("user");
      expect(restored.content).toBe("hi");
      expect(restored.name).toBe("bob");
    });

    it("handles missing name", () => {
      const original = new UserMessage("hi");
      const json = original.toJSON();
      expect(json.name).toBeUndefined();
      const restored = UserMessage.fromJSON(json);
      expect(restored.name).toBeUndefined();
    });
  });

  describe("toOpenAIMessage", () => {
    it("returns the correct format", () => {
      const msg = new UserMessage("hello");
      const openai = msg.toOpenAIMessage();
      expect(openai.role).toBe("user");
      expect(openai.content).toBe("hello");
    });
  });

  describe("toOpenAIResponseInputItem", () => {
    it("returns the correct format", () => {
      const msg = new UserMessage("hello");
      const item = msg.toOpenAIResponseInputItem() as any;
      expect(item.type).toBe("message");
      expect(item.role).toBe("user");
      expect(item.content).toBe("hello");
    });
  });

  describe("toGoogleMessage", () => {
    it("returns Content with text part", () => {
      const msg = new UserMessage("hello");
      const google = msg.toGoogleMessage();
      expect(google.role).toBe("user");
      expect(google.parts).toEqual([{ text: "hello" }]);
    });
  });

  describe("toOllamaMessage", () => {
    it("returns the correct format", () => {
      const msg = new UserMessage("hello");
      const ollama = msg.toOllamaMessage();
      expect(ollama.role).toBe("user");
      expect(ollama.content).toBe("hello");
    });
  });
});

describe("AssistantMessage", () => {
  it("stores string content", () => {
    const msg = new AssistantMessage("response text");
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("response text");
  });

  it("returns empty string for null content", () => {
    const msg = new AssistantMessage(null);
    expect(msg.content).toBe("");
  });

  it("JSON-stringifies TextPart array content", () => {
    const parts = [{ type: "text" as const, text: "hello" }];
    const msg = new AssistantMessage(parts);
    expect(msg.content).toBe(JSON.stringify(parts));
  });

  it("stores tool calls", () => {
    const tc = new ToolCall("tc-1", "get_weather", { city: "NYC" });
    const msg = new AssistantMessage("here you go", { toolCalls: [tc] });
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].name).toBe("get_weather");
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips with tool calls", () => {
      const tc = new ToolCall("tc-1", "add", { a: 1, b: 2 });
      const original = new AssistantMessage("result", {
        toolCalls: [tc],
        name: "bot",
        refusal: null,
      });
      const restored = AssistantMessage.fromJSON(original.toJSON());
      expect(restored.content).toBe("result");
      expect(restored.name).toBe("bot");
      expect(restored.toolCalls).toHaveLength(1);
      expect(restored.toolCalls![0].name).toBe("add");
      expect(restored.toolCalls![0].arguments).toEqual({ a: 1, b: 2 });
    });

    it("round-trips with null content", () => {
      const original = new AssistantMessage(null);
      const restored = AssistantMessage.fromJSON(original.toJSON());
      expect(restored._content).toBeNull();
      expect(restored.content).toBe("");
    });

    it("round-trips without tool calls", () => {
      const original = new AssistantMessage("just text");
      const restored = AssistantMessage.fromJSON(original.toJSON());
      expect(restored.toolCalls).toBeUndefined();
    });
  });

  describe("toOpenAIMessage", () => {
    it("includes tool_calls when present", () => {
      const tc = new ToolCall("tc-1", "fn", { x: 1 });
      const msg = new AssistantMessage("text", { toolCalls: [tc] });
      const openai = msg.toOpenAIMessage() as any;
      expect(openai.role).toBe("assistant");
      expect(openai.tool_calls).toHaveLength(1);
      expect(openai.tool_calls[0].function.name).toBe("fn");
    });
  });

  describe("toOpenAIResponseInputItem", () => {
    it("returns array with message and tool calls", () => {
      const tc = new ToolCall("tc-1", "fn", { x: 1 });
      const msg = new AssistantMessage("text", { toolCalls: [tc] });
      const items = msg.toOpenAIResponseInputItem() as any[];
      expect(Array.isArray(items)).toBe(true);
      expect(items).toHaveLength(2);
      expect(items[0].type).toBe("message");
      expect(items[1].type).toBe("function_call");
    });

    it("returns empty array for null content and no tool calls", () => {
      const msg = new AssistantMessage(null);
      const items = msg.toOpenAIResponseInputItem() as any[];
      expect(items).toEqual([]);
    });

    it("returns only tool calls when content is null", () => {
      const tc = new ToolCall("tc-1", "fn", {});
      const msg = new AssistantMessage(null, { toolCalls: [tc] });
      const items = msg.toOpenAIResponseInputItem() as any[];
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("function_call");
    });
  });

  describe("toGoogleMessage", () => {
    it("uses model role", () => {
      const msg = new AssistantMessage("hi");
      const google = msg.toGoogleMessage();
      expect(google.role).toBe("model");
    });

    it("includes text and function call parts", () => {
      const tc = new ToolCall("tc-1", "fn", { x: 1 });
      const msg = new AssistantMessage("hi", { toolCalls: [tc] });
      const google = msg.toGoogleMessage();
      expect(google.parts).toHaveLength(2);
      expect(google.parts[0]).toEqual({ text: "hi" });
      expect((google.parts[1] as any).functionCall.name).toBe("fn");
    });
  });

  describe("toOllamaMessage", () => {
    it("includes tool_calls", () => {
      const tc = new ToolCall("tc-1", "fn", { x: 1 });
      const msg = new AssistantMessage("text", { toolCalls: [tc] });
      const ollama = msg.toOllamaMessage();
      expect(ollama.role).toBe("assistant");
      expect(ollama.tool_calls).toHaveLength(1);
    });
  });
});

describe("SystemMessage", () => {
  it("stores string content", () => {
    const msg = new SystemMessage("You are helpful.");
    expect(msg.role).toBe("system");
    expect(msg.content).toBe("You are helpful.");
  });

  it("JSON-stringifies TextPart array content", () => {
    const parts = [{ type: "text" as const, text: "instructions" }];
    const msg = new SystemMessage(parts);
    expect(msg.content).toBe(JSON.stringify(parts));
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips string content", () => {
      const original = new SystemMessage("be helpful", { name: "sys" });
      const restored = SystemMessage.fromJSON(original.toJSON());
      expect(restored.content).toBe("be helpful");
      expect(restored.name).toBe("sys");
    });

    it("round-trips TextPart array content", () => {
      const parts = [{ type: "text" as const, text: "abc" }];
      const original = new SystemMessage(parts);
      const json = original.toJSON();
      expect(json.content).toEqual(parts);
      const restored = SystemMessage.fromJSON(json);
      expect(restored._content).toEqual(parts);
    });
  });

  describe("toOpenAIResponseInputItem", () => {
    it("maps system to developer role", () => {
      const msg = new SystemMessage("instructions");
      const item = msg.toOpenAIResponseInputItem() as any;
      expect(item.type).toBe("message");
      expect(item.role).toBe("developer");
    });
  });

  describe("toGoogleMessage", () => {
    it("returns Content with system role", () => {
      const msg = new SystemMessage("instructions");
      const google = msg.toGoogleMessage();
      expect(google.role).toBe("system");
      expect(google.parts).toEqual([{ text: "instructions" }]);
    });
  });
});

describe("DeveloperMessage", () => {
  it("stores string content", () => {
    const msg = new DeveloperMessage("dev instructions");
    expect(msg.role).toBe("developer");
    expect(msg.content).toBe("dev instructions");
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips", () => {
      const original = new DeveloperMessage("be concise");
      const restored = DeveloperMessage.fromJSON(original.toJSON());
      expect(restored.role).toBe("developer");
      expect(restored.content).toBe("be concise");
    });
  });

  describe("toOpenAIMessage", () => {
    it("returns developer role", () => {
      const msg = new DeveloperMessage("dev");
      const openai = msg.toOpenAIMessage() as any;
      expect(openai.role).toBe("developer");
    });
  });

  describe("toOpenAIResponseInputItem", () => {
    it("maps to developer role", () => {
      const msg = new DeveloperMessage("dev");
      const item = msg.toOpenAIResponseInputItem() as any;
      expect(item.role).toBe("developer");
    });
  });
});

describe("ToolMessage", () => {
  const opts = { tool_call_id: "tc-1", name: "get_weather" };

  it("stores content and tool_call_id", () => {
    const msg = new ToolMessage("sunny", opts);
    expect(msg.role).toBe("tool");
    expect(msg.content).toBe("sunny");
    expect(msg.tool_call_id).toBe("tc-1");
    expect(msg.name).toBe("get_weather");
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips", () => {
      const original = new ToolMessage("result", opts);
      const restored = ToolMessage.fromJSON(original.toJSON());
      expect(restored.content).toBe("result");
      expect(restored.tool_call_id).toBe("tc-1");
      expect(restored.name).toBe("get_weather");
    });
  });

  describe("toOpenAIMessage", () => {
    it("returns tool role with tool_call_id", () => {
      const msg = new ToolMessage("result", opts);
      const openai = msg.toOpenAIMessage() as any;
      expect(openai.role).toBe("tool");
      expect(openai.content).toBe("result");
      expect(openai.tool_call_id).toBe("tc-1");
    });
  });

  describe("toOpenAIResponseInputItem", () => {
    it("returns function_call_output format", () => {
      const msg = new ToolMessage("result", opts);
      const item = msg.toOpenAIResponseInputItem() as any;
      expect(item.type).toBe("function_call_output");
      expect(item.call_id).toBe("tc-1");
      expect(item.output).toBe("result");
    });
  });

  describe("toGoogleMessage", () => {
    it("returns user role with functionResponse", () => {
      const msg = new ToolMessage("result", opts);
      const google = msg.toGoogleMessage();
      expect(google.role).toBe("user");
      expect(google.parts).toHaveLength(1);
      const part = google.parts[0] as any;
      expect(part.functionResponse.name).toBe("get_weather");
      expect(part.functionResponse.response.result).toBe("result");
    });
  });

  describe("toOllamaMessage", () => {
    it("returns tool role with tool_name", () => {
      const msg = new ToolMessage("result", opts);
      const ollama = msg.toOllamaMessage() as any;
      expect(ollama.role).toBe("tool");
      expect(ollama.tool_name).toBe("get_weather");
      expect(ollama.content).toBe("result");
    });
  });
});

describe("messageFromJSON", () => {
  it("dispatches to UserMessage", () => {
    const msg = messageFromJSON({ role: "user", content: "hi" });
    expect(msg).toBeInstanceOf(UserMessage);
  });

  it("dispatches to AssistantMessage", () => {
    const msg = messageFromJSON({ role: "assistant", content: "hello" });
    expect(msg).toBeInstanceOf(AssistantMessage);
  });

  it("dispatches to SystemMessage", () => {
    const msg = messageFromJSON({ role: "system", content: "instructions" });
    expect(msg).toBeInstanceOf(SystemMessage);
  });

  it("dispatches to DeveloperMessage", () => {
    const msg = messageFromJSON({ role: "developer", content: "dev" });
    expect(msg).toBeInstanceOf(DeveloperMessage);
  });

  it("dispatches to ToolMessage", () => {
    const msg = messageFromJSON({
      role: "tool",
      content: "result",
      tool_call_id: "tc-1",
      name: "fn",
    });
    expect(msg).toBeInstanceOf(ToolMessage);
  });

  it("throws on unknown role", () => {
    expect(() => messageFromJSON({ role: "unknown", content: "" })).toThrow(
      /Unknown message/,
    );
  });
});
