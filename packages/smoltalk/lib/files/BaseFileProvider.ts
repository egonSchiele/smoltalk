import type { FileProvider, FileProviderContext } from "../files.js";
import type { ProviderFileRef } from "../classes/message/contentParts.js";
import { Result, success, failure, Failure } from "../types/result.js";
import { getLogger } from "../util/logger.js";
import { redactSecret } from "../util/redact.js";

/**
 * Shared behaviour for the built-in file providers: the try/catch, secret
 * redaction, logging, and Result wrapping are identical across providers, so
 * they live here. Subclasses implement only the SDK-specific upload/delete and
 * may throw freely — this class turns a thrown error into a redacted Failure.
 */
export abstract class BaseFileProvider implements FileProvider {
  /** Human-readable provider label used in log and error messages, e.g. "OpenAI". */
  protected abstract readonly label: string;

  /** SDK-specific upload. May throw; the base class handles logging + redaction. */
  protected abstract doUpload(
    data: Uint8Array,
    mimeType: string,
    ctx: FileProviderContext,
  ): Promise<ProviderFileRef>;

  /** SDK-specific delete. May throw; the base class handles logging + redaction. */
  protected abstract doDelete(ref: ProviderFileRef, ctx: { apiKey: string }): Promise<void>;

  async upload(
    data: Uint8Array,
    mimeType: string,
    ctx: FileProviderContext,
  ): Promise<Result<ProviderFileRef>> {
    try {
      return success(await this.doUpload(data, mimeType, ctx));
    } catch (err) {
      return this.fail("upload", err, ctx.apiKey);
    }
  }

  async delete(ref: ProviderFileRef, ctx: { apiKey: string }): Promise<Result<void>> {
    try {
      await this.doDelete(ref, ctx);
      return success(undefined);
    } catch (err) {
      return this.fail("delete", err, ctx.apiKey);
    }
  }

  /**
   * Redact the API key once, then reuse the scrubbed message for BOTH the log
   * call and the returned Failure. The raw error object is never handed to the
   * logger — SDKs sometimes attach the Authorization header to it. (B1)
   */
  private fail(op: "upload" | "delete", err: unknown, apiKey: string): Failure {
    const message = redactSecret((err as Error)?.message ?? String(err), apiKey);
    getLogger().error(`${this.label} file ${op} failed:`, message);
    return failure(`${this.label} file ${op} failed: ${message}`);
  }
}
