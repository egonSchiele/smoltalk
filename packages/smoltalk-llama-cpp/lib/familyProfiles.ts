/**
 * What the plugin knows about each model family, in one place.
 *
 * A local model runs on parts from four parties: the vendor's chat
 * template, llama.cpp's decoding, node-llama-cpp's native rendering of the
 * template, and the grammar that holds a reply to a schema. Each family
 * spells its thinking and tool markers its own way, and each part has to
 * be taught each family. Rather than an `if` per family at every point
 * that cares, a family gets one profile here, looked up by the
 * architecture named in the GGUF file, and the code asks the profile.
 *
 * A profile is for a family, not a model. A fact about one model, such as
 * its sampling or the draft that pairs with it, belongs with the caller's
 * catalog, not here.
 *
 * Only families this plugin has been run against have a profile. Any other
 * architecture gets the default, which behaves as the plugin did before
 * profiles existed: it tells every wrapper about thinking and lets the
 * wrapper class decide the reply layout.
 */
import {
  DeepSeekChatWrapper,
  Gemma4ChatWrapper,
  LlamaText,
  QwenChatWrapper,
  SeedChatWrapper,
  SpecialTokensText,
} from "node-llama-cpp";
import type { ChatWrapper } from "node-llama-cpp";
import type { SmolConfig } from "smoltalk";

/**
 * What a call asked about thinking. `on` and `off` are `thinking.enabled`;
 * both false when the call did not say. `budget` is the most tokens the
 * model may think for: the call's own `budgetTokens`, else the budget the
 * google client gives a `reasoningEffort`. Undefined leaves node-llama-cpp's
 * own default, three quarters of the context.
 */
export type ThinkingChoice = {
  on: boolean;
  off: boolean;
  budget: number | undefined;
  effort: SmolConfig["reasoningEffort"];
};

/** The `customWrapperSettings` node-llama-cpp takes when resolving a
 *  wrapper: one key per wrapper it might pick. */
export type WrapperSettings = Record<string, Record<string, unknown>>;

/**
 * How a family lays its reply out, which decides whether the thinking
 * grammar (thinkingGrammar.ts) can wrap a typed reply.
 *
 * - `blockThenAnswer`: one thought block, then the answer. The grammar
 *   lets the model think up to the block's closing token and holds the
 *   rest to the schema.
 * - `channels`: the answer sits in its own channel after a header of its
 *   own, as Harmony does. The plain schema grammar applies.
 * - `byWrapper`: not known for the family; decided from the wrapper class
 *   node-llama-cpp picked.
 */
export type ReplyLayout = "blockThenAnswer" | "channels" | "byWrapper";

export type FamilyProfile = {
  /** For messages. */
  name: string;
  /** The settings that tell the family's chat wrapper about the call's
   *  thinking choice, or undefined when the call said nothing, so the
   *  wrapper's own default applies. */
  thinkingSettings: (choice: ThinkingChoice) => WrapperSettings | undefined;
  replyLayout: ReplyLayout;
  /** Tool markers to use in place of the wrapper's own, for a family whose
   *  wrapper in node-llama-cpp spells them differently from the model's
   *  chat template. */
  toolMarkers?: () => ChatWrapper["settings"]["functions"];
  /** Whether node-llama-cpp's draft predictor returns when a model of this
   *  family samples (temperature above zero). It hung on Qwen3.5 in 3.21. */
  draftSamplesSafely: boolean;
};

// ---------------------------------------------------------------------------
// The families
// ---------------------------------------------------------------------------

/** Qwen's wrapper has a switch: `thoughts` is "discourage" for off, "auto"
 *  to open the block when asked. */
function qwenThinking(choice: ThinkingChoice): WrapperSettings | undefined {
  if (choice.off) {
    return { qwen: { thoughts: "discourage" } };
  }
  if (choice.on) {
    return { qwen: { thoughts: "auto" } };
  }
  return undefined;
}

/** Gemma 4's wrapper has a switch too: `reasoning`. */
function gemma4Thinking(choice: ThinkingChoice): WrapperSettings | undefined {
  if (choice.off) {
    return { gemma4: { reasoning: false } };
  }
  if (choice.on) {
    return { gemma4: { reasoning: true } };
  }
  return undefined;
}

/** Seed's wrapper takes a budget: zero for off, the call's budget for on. */
function seedThinking(choice: ThinkingChoice): WrapperSettings | undefined {
  if (choice.off) {
    return { seed: { thinkingBudget: 0 } };
  }
  if (choice.on && choice.budget !== undefined) {
    return { seed: { thinkingBudget: choice.budget } };
  }
  return undefined;
}

/** Harmony (gpt-oss) only takes an effort, so off is its lowest effort,
 *  and an effort the call named is passed on whether thinking is on or
 *  not. */
function harmonyThinking(choice: ThinkingChoice): WrapperSettings | undefined {
  if (choice.off) {
    return { harmony: { reasoningEffort: "low" } };
  }
  if (choice.effort !== undefined) {
    return { harmony: { reasoningEffort: choice.effort } };
  }
  return undefined;
}

/**
 * The markers Gemma 4 puts around a tool call and its result, from the
 * model's own chat template and Google's prompt-format page. node-llama-cpp
 * 3.21.1's wrapper closes a result with `</tool_response>` where the model
 * expects `<tool_response|>`, opens it with `<tool_response>` rather than
 * `<|tool_response>`, and wraps a call's parameters in a second pair of
 * braces. A model shown its results that way stopped answering: it ended
 * its turn at once, or wrote a stray `<tool_call|>` and nothing else.
 */
function gemma4ToolMarkers(): ChatWrapper["settings"]["functions"] {
  return {
    call: {
      optionalPrefixSpace: false,
      prefix: LlamaText(new SpecialTokensText("<|tool_call>call:")),
      paramsPrefix: "",
      suffix: LlamaText(new SpecialTokensText("<tool_call|>")),
      emptyCallParamsPlaceholder: {},
    },
    result: {
      prefix: LlamaText(
        new SpecialTokensText("<|tool_response>response:"),
        "{{functionName}}",
        "{value:",
      ),
      suffix: LlamaText(new SpecialTokensText("}<tool_response|>")),
    },
  };
}

/** The settings every known wrapper understands, for a model whose family
 *  has no profile: node-llama-cpp reads the key of the wrapper it picks
 *  and ignores the rest. */
function everyWrapperThinking(choice: ThinkingChoice): WrapperSettings | undefined {
  const settings = {
    ...qwenThinking(choice),
    ...gemma4Thinking(choice),
    ...seedThinking(choice),
    ...harmonyThinking(choice),
  };
  return Object.keys(settings).length === 0 ? undefined : settings;
}

const QWEN3: FamilyProfile = {
  name: "Qwen3",
  thinkingSettings: qwenThinking,
  replyLayout: "blockThenAnswer",
  draftSamplesSafely: true,
};

/** Keyed by the GGUF architecture (`general.architecture` in the file). */
const PROFILES: Record<string, FamilyProfile> = {
  qwen3: QWEN3,
  qwen35: {
    ...QWEN3,
    name: "Qwen3.5",
    // node-llama-cpp 3.21's draft predictor never returned when a Qwen3.5
    // model sampled. A Qwen3 pair returned as usual.
    draftSamplesSafely: false,
  },
  gemma4: {
    name: "Gemma 4",
    thinkingSettings: gemma4Thinking,
    replyLayout: "blockThenAnswer",
    toolMarkers: gemma4ToolMarkers,
    draftSamplesSafely: true,
  },
  "gpt-oss": {
    name: "gpt-oss",
    thinkingSettings: harmonyThinking,
    replyLayout: "channels",
    draftSamplesSafely: true,
  },
};

export const DEFAULT_PROFILE: FamilyProfile = {
  name: "unknown family",
  thinkingSettings: everyWrapperThinking,
  replyLayout: "byWrapper",
  draftSamplesSafely: true,
};

/** The profile for a GGUF architecture, or the default when the family
 *  has none. */
export function profileFor(architecture: string | undefined): FamilyProfile {
  if (architecture === undefined) {
    return DEFAULT_PROFILE;
  }
  return PROFILES[architecture] ?? DEFAULT_PROFILE;
}

/** The reply layout a wrapper class implies, for a family with no profile.
 *  Qwen, DeepSeek, Seed, and Gemma 4 write one thought block then the
 *  answer. Harmony and Muse put the answer in a second channel, and the
 *  template fallback for an unknown model can spell its markers as plain
 *  text, so those get the plain schema grammar. */
export function layoutOfWrapper(wrapper: ChatWrapper): ReplyLayout {
  const blockThenAnswer = [
    QwenChatWrapper,
    DeepSeekChatWrapper,
    SeedChatWrapper,
    Gemma4ChatWrapper,
  ];
  return blockThenAnswer.some((cls) => wrapper instanceof cls) ? "blockThenAnswer" : "channels";
}
