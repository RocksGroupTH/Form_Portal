/**
 * Turns a bulk approve/send response into what the user should be told.
 *
 * The AP-2 bulk endpoints answer per item — `{ id, ok, error }` — and the
 * queues used to read only the counts, so a request that was refused for a
 * concrete, fixable reason ("ต้องยืนยัน Vendor ก่อนอนุมัติ") surfaced as a
 * green "สำเร็จ 0 รายการ · ไม่สำเร็จ 1" with the reason discarded. Nothing on
 * screen told the officer what to do next, and a total failure still looked
 * like a success.
 *
 * Pure so it can be tested; the caller does the toast.
 */

export interface BulkItemResult {
  id: number;
  ok: boolean;
  error?: string;
}

export interface BulkMessage {
  /** "success" only when every item went through — anything else is an error. */
  kind: "success" | "error";
  title: string;
  /** Per-item reasons, one line each. Absent when nothing failed. */
  description?: string;
}

/** How many reasons to spell out before summarising the rest. */
const MAX_LINES = 4;

const FALLBACK_REASON = "ไม่ทราบสาเหตุ";

/**
 * @param verb        the action, in Thai, e.g. "อนุมัติ" or "ส่ง"
 * @param results     the response's per-item results
 * @param okCount     the server's count; recomputed from `results` if absent
 * @param label       id → the number to show a human, e.g. "ADV26-00031"
 */
export function buildBulkMessage(
  verb: string,
  results: BulkItemResult[],
  okCount?: number,
  label?: (id: number) => string,
): BulkMessage {
  const failed = results.filter((r) => !r.ok);
  const ok = okCount ?? results.length - failed.length;

  if (failed.length === 0) {
    return { kind: "success", title: `${verb}สำเร็จ ${ok} รายการ` };
  }

  const lines = failed.slice(0, MAX_LINES).map((r) => {
    const who = label?.(r.id) ?? `#${r.id}`;
    return `${who}: ${r.error?.trim() || FALLBACK_REASON}`;
  });
  const rest = failed.length - lines.length;
  if (rest > 0) lines.push(`และอีก ${rest} รายการ`);

  // Everything failed → say so plainly rather than leading with a count of 0.
  const title = ok === 0
    ? `${verb}ไม่สำเร็จ ${failed.length} รายการ`
    : `${verb}สำเร็จ ${ok} · ไม่สำเร็จ ${failed.length} รายการ`;

  return { kind: "error", title, description: lines.join("\n") };
}
