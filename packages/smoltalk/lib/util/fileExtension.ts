/**
 * The extension of a path including its dot, lower-cased, or "" when there
 * is none. Follows Node's `path.extname`: only the last segment counts, a
 * leading dot (`.bashrc`) is not an extension, and a trailing dot gives ".", and ".." gives "".
 * String work only, so it is the same on every platform.
 */
export function fileExtension(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || base === "..") {
    return "";
  }
  return base.slice(dot).toLowerCase();
}
