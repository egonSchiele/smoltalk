// Temporary stub — replaced in Task 6.
import type { FileProvider } from "../files.js";
export const openaiFileProvider: FileProvider = {
  async upload() {
    return { success: false as const, error: "not implemented" };
  },
  async delete() {
    return { success: false as const, error: "not implemented" };
  },
};
