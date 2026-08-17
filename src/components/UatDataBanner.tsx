import { FlaskConical } from "lucide-react";
import { isUatId } from "@/lib/form-environment/uat-identity";

/**
 * Marks a request that lives in the UAT form database.
 *
 * A detail page loads one row through the form's own pool, so nothing in the
 * payload says which database answered — the id does, because UAT identities
 * start at 900000. Renders nothing for a production request.
 */
export function UatDataBanner({ requestId }: { requestId: number | null | undefined }) {
  if (!isUatId(requestId)) return null;

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
