import { describe, it, expect } from "vitest";
import * as smoltalk from "./index.js";
import type {
  TextToSpeechModel,
  SpeechToTextModelName,
  TextToSpeechModelName,
} from "./index.js";

describe("public exports", () => {
  it("exports builders and normalizeImageRef", () => {
    expect(typeof smoltalk.imagePart).toBe("function");
    expect(typeof smoltalk.filePart).toBe("function");
    expect(typeof smoltalk.textPart).toBe("function");
    expect(typeof smoltalk.userMessage).toBe("function");
    expect(typeof smoltalk.normalizeImageRef).toBe("function");
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
});
