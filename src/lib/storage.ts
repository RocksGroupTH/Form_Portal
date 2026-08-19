import { promises as fs } from "fs";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(process.cwd(), "uploads", "forms");

/**
 * Thrown when a storage path would land outside `UPLOAD_ROOT`.
 *
 * A distinct class so callers can answer 400 rather than 500 — and so this can
 * never be mistaken for a missing file, which `deleteFile` swallows.
 */
export class StoragePathError extends Error {
  constructor(subPath: string) {
    super(`Refusing a storage path outside the upload root: ${JSON.stringify(subPath)}`);
    this.name = "StoragePathError";
  }
}

/**
 * Resolve a stored relative path against the upload root, and prove it stayed
 * inside it.
 *
 * `path.join` alone does not: it normalises `..` away, so
 * `join(root, "a/../../../etc/passwd")` resolves happily outside `root` and
 * returns a path the caller then reads, writes or unlinks. Every one of these
 * three functions used to do exactly that, on values that reach them from
 * request input (a client-chosen `fieldKey` and file name went straight into
 * the path) and from database columns (`AccRequestFile.StoragePath`, which is
 * whatever an earlier write put there).
 *
 * `path.relative` is the check that actually holds: after resolving both ends,
 * a contained target has a relative path that is neither absolute nor starts
 * with `..`. Comparing prefixes with `startsWith` would not do — `/uploads-evil`
 * has `/uploads` as a string prefix.
 */
export function resolveStoragePath(subPath: string): string {
  if (typeof subPath !== "string" || subPath.trim() === "") {
    throw new StoragePathError(String(subPath));
  }
  // A rooted or drive-qualified path replaces the base entirely under
  // path.resolve, so it never even reaches the containment test below.
  if (path.isAbsolute(subPath) || /^[a-zA-Z]:/.test(subPath)) {
    throw new StoragePathError(subPath);
  }

  const fullPath = path.resolve(UPLOAD_DIR, subPath);
  const relative = path.relative(UPLOAD_DIR, fullPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StoragePathError(subPath);
  }
  return fullPath;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function uploadFile(
  subPath: string,
  buffer: Buffer,
): Promise<string> {
  const fullPath = resolveStoragePath(subPath);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, buffer);
  return subPath;
}

export async function downloadFile(
  storagePath: string,
): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(storagePath));
}

export async function deleteFile(storagePath: string): Promise<void> {
  // Containment first, and outside the catch: a traversing path must raise, not
  // be silently ignored the way a missing file is.
  const fullPath = resolveStoragePath(storagePath);
  await fs.unlink(fullPath).catch(() => {});
}
