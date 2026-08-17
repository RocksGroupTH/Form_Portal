"use client";

import { FlaskConical, TriangleAlert } from "lucide-react";
import { isUatId } from "@/lib/form-environment/uat-identity";
import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";

/**
 * Says which set of books the record on screen belongs to, whenever that could
 * surprise the person looking at it.
 *
 * Two cases, and they are not symmetrical:
 *
 * 1. **A UAT record, to anybody.** A detail page loads one row through the
 *    form's own pool, so nothing in the payload says which database answered —
 *    the id does, because UAT identities start at 900000. A non-tester manager
 *    reaches these deliberately, by the id rule, so the marker cannot depend on
 *    the viewer being a tester.
 * 2. **A production record, to a viewer in UAT mode.** The navbar chip says UAT
 *    and the page is real work: a claim opened from a production email link,
 *    or — since `viewerListEnvironment` stopped filtering these out of
 *    `/my-work` — an ordinary user's request sitting in a tester's own approval
 *    queue. The Cancel / Approve / Reject buttons below are live against real
 *    data, and the UAT-mode cookie outlives the session that set it by up to 30
 *    days, so "I thought I was in the test system" is the realistic mistake.
 *
 * Nothing renders for the ordinary case — a production record seen by somebody
 * in production mode — and no *content* renders while the viewer payload is
 * still in flight, matching `FormEnvironmentChip`: a marker that guesses is
 * worse than one that waits.
 *
 * While it waits it still occupies its own height. This sits directly above the
 * Cancel / Approve / Reject bar, so appearing a round trip after first paint
 * would push those buttons down under a cursor already on its way to one. An
 * invisible placeholder costs nothing and keeps the target still.
 */
export function UatDataBanner({ requestId }: { requestId: number | null | undefined }) {
  const { data, isLoading } = useFormEnvironments();

  if (isUatId(requestId)) {
    return (
      <div
        className="rounded-2xl px-4 py-2.5 mb-4 flex items-center gap-2"
        style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
      >
        <FlaskConical size={15} className="shrink-0" />
        <p className="text-[12px] font-bold m-0">ข้อมูลทดสอบ (UAT) — ไม่ใช่คำขอจริง</p>
      </div>
    );
  }

  // A saved record only — a page with no id yet is a blank draft, and there is
  // no production row to warn about.
  const isSavedRecord = typeof requestId === "number" && Number.isFinite(requestId) && requestId > 0;
  if (!isSavedRecord) return null;

  // Hold the space, say nothing, until the payload decides.
  const waiting = isLoading && !data;
  if (!waiting && !data?.viewer.uatMode) return null;

  return (
    <div
      className="rounded-2xl px-4 py-2.5 mb-4 flex items-center gap-2"
      aria-hidden={waiting}
      style={{
        background: "var(--status-draft-bg)",
        color: "var(--status-draft-text)",
        visibility: waiting ? "hidden" : "visible",
      }}
    >
      <TriangleAlert size={15} className="shrink-0" />
      <p className="text-[12px] font-bold m-0">
        ข้อมูลจริง (Production) — คุณกำลังอยู่ในโหมด UAT การกดอนุมัติ ปฏิเสธ หรือยกเลิกที่หน้านี้
        จะมีผลกับคำขอจริง
      </p>
    </div>
  );
}
