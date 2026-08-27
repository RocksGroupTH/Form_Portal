/**
 * Keeping a booking row's five figures tied to the file they came from.
 *
 * The figures are what the confirmation says. So when the confirmation changes,
 * the figures follow it: a row's **first** file replaces whatever was there,
 * and losing the **last** one takes them away again. Without that, a row keeps
 * numbers from a document nobody can open any more — which is what a stale row
 * with a mismatched total looks like, and there is no way to tell from the
 * screen whether such a figure was read, typed, or left over.
 *
 * Both rules are deliberately about the *first* and *last* file, not any file.
 * A second attachment is another page of the same booking, and wiping on it
 * would destroy figures the first file's read had just produced.
 *
 * Pure and import-free so the decision is unit-tested; the component holds only
 * the wiring. The lock rule next door is here for the same reason, and it is
 * here because it broke while it was inline.
 */

export interface AttachDecision {
  /** Blank all five fields before the read, so nothing survives from the last document. */
  clearFirst: boolean;
  /**
   * The read may write every field it answers, rather than only the empty ones.
   *
   * Normally a person outranks the read — anything typed while the call was in
   * flight stays. On a row's first file that guard is not just unnecessary but
   * actively wrong: the fields were blanked in the same tick, so the state the
   * guard would read is the stale one it exists to protect.
   */
  readReplaces: boolean;
}

export function onFileAttached({ existingFileCount }: { existingFileCount: number }): AttachDecision {
  const isFirst = existingFileCount === 0;
  return { clearFirst: isFirst, readReplaces: isFirst };
}

/** Whether losing this file leaves the figures unsourced, and so to be cleared. */
export function onFileRemoved({ remainingFileCount }: { remainingFileCount: number }): boolean {
  return remainingFileCount === 0;
}
