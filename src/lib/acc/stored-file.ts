/**
 * Removing a stored object, dispatched to the backend that actually holds it.
 *
 * `AccRequestFile` records two things about where the bytes are —
 * `StorageBackend` (`'local'` | `'sharepoint'`) and `StoragePath` (a filesystem
 * path relative to `UPLOAD_ROOT`, or a Graph driveItem id) — and three delete
 * paths ignored the first one:
 *
 * - AP-17's `collectAndDeleteRequestArtifacts` selected `StoragePath` only and
 *   its two callers passed every value to the local `deleteFile`;
 * - AP-1's `deleteItem` did the same with the item's attachment paths;
 * - AP-1's `deleteDraft` deleted the rows and never touched storage at all.
 *
 * Everything Accounting uploads now goes to SharePoint, so in practice each of
 * those handed a Graph driveItem id to `fs.unlink`, which silently missed, and
 * then deleted the only row that recorded where the file was. The bytes stay in
 * the document library — including national-ID scans, which is a retention
 * problem rather than a leak, and an invisible one because the pointer is gone.
 *
 * `.catch(() => {})` at the call sites was hiding it, so this reports instead:
 * failures come back as a list, and a caller that has already committed its
 * database transaction logs them rather than pretending they did not happen.
 * There is no outbox here — that needs a table and a migration — but a failure
 * is at least recoverable from the log, which it was not before.
 */

import { deleteFile } from "@/lib/storage";

// Imported on demand rather than statically. `@/lib/sharepoint` reaches `@/env`,
// which validates every environment variable at module load, so a static edge
// would mean a local-backend delete could not run without Graph credentials
// configured — including in a test. Same pattern as the `await import()` calls
// in `@/lib/auth`. The module cache makes the repeat cost nil.
async function removeFromSharePoint(itemId: string): Promise<void> {
  const { deleteFileFromSharePoint } = await import("@/lib/sharepoint");
  await deleteFileFromSharePoint(itemId);
}

/** The two columns a delete needs. Select both, always. */
export interface StoredFileRef {
  storagePath: string | null;
  storageBackend: string | null;
}

export interface StoredFileDeleteFailure {
  ref: StoredFileRef;
  message: string;
}

/**
 * Remove one stored object. Resolves either way — a failure is returned, not
 * thrown, because every caller runs after its transaction has committed and must
 * not turn a successful delete into a 500.
 */
export async function deleteStoredFile(ref: StoredFileRef): Promise<StoredFileDeleteFailure | null> {
  const path = (ref.storagePath ?? "").trim();
  // A placeholder row whose upload never finished ('' / 'pending') has nothing
  // stored behind it.
  if (!path) return null;

  const backend = (ref.storageBackend ?? "").trim().toLowerCase();
  if (backend === "pending") return null;

  try {
    if (backend === "sharepoint") {
      await removeFromSharePoint(path);
    } else {
      await deleteFile(path);
    }
    return null;
  } catch (err) {
    return { ref, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Remove a batch, and log whatever could not be removed.
 *
 * `context` names the operation so the log line is actionable — the row is gone
 * by the time this runs, so the message is the only remaining record of which
 * object was orphaned.
 */
export async function deleteStoredFiles(
  refs: readonly StoredFileRef[],
  context: string,
): Promise<StoredFileDeleteFailure[]> {
  const failures: StoredFileDeleteFailure[] = [];
  for (const ref of refs) {
    const failure = await deleteStoredFile(ref);
    if (failure) failures.push(failure);
  }
  if (failures.length > 0) {
    console.error(
      `[storage] ${context}: ${failures.length} stored file(s) could not be removed and are now orphaned —`,
      failures.map((f) => `${f.ref.storageBackend ?? "?"}:${f.ref.storagePath ?? "?"} (${f.message})`),
    );
  }
  return failures;
}
