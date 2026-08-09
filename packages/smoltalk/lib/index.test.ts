import { describe, it, expect } from "vitest";
import * as smoltalk from "./index.js";
import type {
  TextToSpeechModel,
  SpeechToTextModelName,
  TextToSpeechModelName,
} from "./index.js";

describe("public exports", () => {
  it("exports builders and normalizeBlob", () => {
    expect(typeof smoltalk.imagePart).toBe("function");
    expect(typeof smoltalk.filePart).toBe("function");
    expect(typeof smoltalk.textPart).toBe("function");
    expect(typeof smoltalk.userMessage).toBe("function");
    expect(typeof smoltalk.normalizeBlob).toBe("function");
  });

  it("exports the files API", () => {
    expect(typeof smoltalk.uploadFile).toBe("function");
    expect(typeof smoltalk.deleteFile).toBe("function");
    expect(typeof smoltalk.registerFileProvider).toBe("function");
    expect(typeof smoltalk.loadBlob).toBe("function");
  });

  it("exports the audio model registry additions", () => {
    expect(typeof smoltalk.isTextToSpeechModel).toBe("function");
    expect(typeof smoltalk.isSpeechToTextModel).toBe("function");
    expect(typeof smoltalk.getModelForProvider).toBe("function");

    // Compile-time-only assertions: these fail `tsc` (not vitest) if the
    // type/alias exports above are removed or reshaped.
    const ttsModel: TextToSpeechModel = {
      type: "text-to-speech",
      modelName: "tts-1",
      provider: "openai",
      perCharacterCost: 0.000015,
    };
    const sttName: SpeechToTextModelName = "whisper-1";
    const ttsName: TextToSpeechModelName = "tts-1";
    expect(ttsModel.type).toBe("text-to-speech");
    expect(sttName).toBe("whisper-1");
    expect(ttsName).toBe("tts-1");
  });

  it("exports the transcription API and keeps internal machinery private", () => {
    expect(typeof smoltalk.transcribe).toBe("function");
    expect(typeof smoltalk.registerTranscriptionProvider).toBe("function");
    expect(typeof smoltalk.BaseTranscriptionClient).toBe("function");
    expect(typeof smoltalk.DEFAULT_TRANSCRIBE_BYTES).toBe("number");
    // Internal lifecycle machinery stays off the package root.
    expect("getTranscriptionClient" in smoltalk).toBe(false);
    expect("OpenAITranscriptionClient" in smoltalk).toBe(false);
    expect("OPENAI_TRANSCRIBE_MODELS" in smoltalk).toBe(false);
    expect("_resetForTests" in smoltalk).toBe(false);
  });

  it("exports the speech (TTS) API and keeps internal machinery private", () => {
    expect(typeof smoltalk.speak).toBe("function");
    expect(typeof smoltalk.registerSpeechProvider).toBe("function");
    expect(typeof smoltalk.BaseSpeechClient).toBe("function");
    // Internal lifecycle machinery stays off the package root; limits live in model data.
    expect("getSpeechClient" in smoltalk).toBe(false);
    expect("OpenAISpeechClient" in smoltalk).toBe(false);
    expect("OPENAI_SPEECH_MODELS" in smoltalk).toBe(false);
    expect("MAX_TTS_CHARS" in smoltalk).toBe(false);
    expect("_resetForTests" in smoltalk).toBe(false);
  });
});
