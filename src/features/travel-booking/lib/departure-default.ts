/**
 * AP-17 ข้อ13 — when จุดขึ้นรถ/ขึ้นเครื่อง may be filled in for the requester.
 * ขาไป defaults to Bangkok; ขากลับ defaults to the province being travelled to.
 * Pure — imports nothing, so the rule is unit-tested without a browser.
 *
 * The rule has to leave anything the requester chose alone, and `current` alone
 * cannot say whether the text in the field was typed or written by a previous
 * default: somebody who types "เชียงใหม่" by hand looks identical to the default
 * that would have written it. `appliedDefault` — what this form last wrote —
 * is what tells the two apart, so the caller has to keep it.
 */
export function nextDeparturePlace({
  current,
  appliedDefault,
  nextDefault,
}: {
  /** What the field holds right now. */
  current: string | null;
  /** What a previous run of this rule wrote there, or null if it never did. */
  appliedDefault: string | null;
  /** The default that applies now — null while there is nothing to default to. */
  nextDefault: string | null;
}): string | null {
  const want = (nextDefault ?? "").trim();
  if (!want) return null;

  const have = (current ?? "").trim();
  if (have === want) return null;
  if (!have) return want;

  // Non-empty and not ours to overwrite unless it is exactly what we last wrote.
  return have === (appliedDefault ?? "").trim() && appliedDefault != null ? want : null;
}
