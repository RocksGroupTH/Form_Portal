/**
 * Which PV number the control report should show for a clearing.
 *
 * Two fields have always been able to answer this and the report read the
 * wrong one. `PvDocNo` is a box on the account step that somebody types into
 * by hand — it dates from before the ERP interface existed, when the number
 * had to be copied out of BC. `ErpDocumentNo` is what BC returned when the
 * journal was actually created, and the report did not select it at all: a
 * clearing posted as PVA2609-0030 showed "—" and read as unpaid (found in the
 * full-loop test, 2026-09-14).
 *
 * BC wins when both are filled. Not because the typing is careless, but
 * because the send is the event that created the document: a hand-typed
 * number sitting beside a different sent one is either a note about something
 * else or a typo, and the posting is what the accounts reconcile against.
 *
 * `source` is returned rather than just the text so the screen can say where
 * the number came from. A number the system produced and one a person typed
 * carry different weight, and the report is read by people deciding whether a
 * clearing is settled.
 */
export interface ReportPvInput {
  /** What BC returned when the journal was created. */
  erpDocumentNo?: string | null;
  /** What an accountant typed on the approval step. */
  pvDocNo?: string | null;
}

export interface ReportPv {
  text: string | null;
  source: "erp" | "manual" | null;
}

export function reportPv(row: ReportPvInput): ReportPv {
  const erp = (row.erpDocumentNo ?? "").trim();
  if (erp) return { text: erp, source: "erp" };
  const manual = (row.pvDocNo ?? "").trim();
  if (manual) return { text: manual, source: "manual" };
  return { text: null, source: null };
}
