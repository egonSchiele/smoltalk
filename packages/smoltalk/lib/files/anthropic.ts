// Temporary stub — replaced in Task 7.
import type { FileProvider } from "../files.js";
export const anthropicFileProvider: FileProvider = {
  async upload() {
    return { success: false as const, error: "not implemented" };
  },
  async delete() {
    return { success: false as const, error: "not implemented" };
  },
};
