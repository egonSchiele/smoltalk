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

  it("exports the transcription API and keeps _resetForTests internal", () => {
    expect(typeof smoltalk.transcribe).toBe("function");
    expect(typeof smoltalk.registerTranscriptionProvider).toBe("function");
    expect(smoltalk.OPENAI_TRANSCRIBE_MODELS).toBeInstanceOf(Set);
    expect(smoltalk.OPENAI_TRANSCRIBE_MODELS.has("whisper-1")).toBe(true);
    expect(typeof smoltalk.DEFAULT_TRANSCRIBE_BYTES).toBe("number");
    expect("_resetForTests" in smoltalk).toBe(false);
  });

  it("exports the speech (TTS) API and keeps _resetForTests internal", () => {
    expect(typeof smoltalk.speak).toBe("function");
    expect(typeof smoltalk.registerSpeechProvider).toBe("function");
    expect(smoltalk.OPENAI_SPEECH_MODELS).toBeInstanceOf(Set);
    expect(smoltalk.OPENAI_SPEECH_MODELS.has("tts-1")).toBe(true);
    expect(smoltalk.OPENAI_SPEECH_MODELS.has("tts-1-hd")).toBe(true);
    expect(smoltalk.MAX_TTS_CHARS).toBe(4096);
    expect(smoltalk.MIN_OPENAI_TTS_SPEED).toBe(0.25);
    expect(smoltalk.MAX_OPENAI_TTS_SPEED).toBe(4);
    expect("_resetForTests" in smoltalk).toBe(false);
  });
});
