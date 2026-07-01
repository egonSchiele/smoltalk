// Temporary stub — replaced in Task 8.
import type { FileProvider } from "../files.js";
export const googleFileProvider: FileProvider = {
  async upload() {
    return { success: false as const, error: "not implemented" };
  },
  async delete() {
    return { success: false as const, error: "not implemented" };
  },
};
