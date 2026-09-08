"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

/**
 * The Vendor cell in the AP-2 approval queue — confirm without leaving the page.
 *
 * The ACC_OFFICER step only approves a request whose vendor is *confirmed*, so
 * before this existed a bulk approve at that step could never succeed: the only
 * place to confirm was the detail page, one request at a time. Here the officer
 * confirms down the column and then approves the lot in one go.
 *
 * Now the only Vendor control in AP-2 — the queue, the preview drawer and the
 * full request page all use it. The one it replaced loaded the whole vendor
 * list and POSTed a fresh match every time it mounted, which per row would have
 * meant a list fetch and a match run for every line in the queue, and on the
 * full page put a "AI กำลังจับคู่" popup over the screen for a lookup that had
 * already happened. This reads the row the caller already fetched and only asks
 * the server when the officer acts.
 */

export interface VendorOption {
  vendorNo: string;
  displayName: string | null;
}

/**
 * One in-flight/settled request per brand, shared by every row. Rows mount
 * together, so without this a 20-row queue would fetch the same list 20 times.
 * Module-level on purpose: the list is BC master data and does not change
 * within a session.
 */
const vendorCache = new Map<string, Promise<VendorOption[]>>();

function loadVendors(brandCode: string): Promise<VendorOption[]> {
  const key = brandCode.trim().toUpperCase();
  const hit = vendorCache.get(key);
  if (hit) return hit;
  const p = fetch(`/api/request/advance/vendors?company=${encodeURIComponent(brandCode)}`)
    .then((r) => r.json())
    .then((j: { ok: boolean; vendors?: VendorOption[] }) => (j.ok && j.vendors ? j.vendors : []))
    .catch(() => [] as VendorOption[]);
  vendorCache.set(key, p);
  return p;
}

export interface AdvanceQueueVendorCellProps {
  requestId: number;
  /** request.brandCode — the API resolves it to the interface company. */
  brandCode: string | null;
  vendorNo: string | null;
  vendorName: string | null;
  /** null/'pending' | 'suggested' | 'confirmed' | 'none' */
  status: string | null;
  /** Why the matcher landed where it did — shown when there is nothing matched. */
  reason?: string | null;
  /** Called after a successful confirm so the queue can refresh. */
  onConfirmed: () => void;
}

export function AdvanceQueueVendorCell({
  requestId, brandCode, vendorNo, vendorName, status, reason, onConfirmed,
}: AdvanceQueueVendorCellProps) {
  const [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState<VendorOption[] | null>(null);
  const confirmed = status === "confirmed" && !!vendorNo;

  // Every row shows a live dropdown, so every row wants the list — but they all
  // share one request per brand, so a 20-row queue still fetches it once.
  useEffect(() => {
    if (!brandCode) return;
    let cancelled = false;
    loadVendors(brandCode).then((v) => { if (!cancelled) setVendors(v); });
    return () => { cancelled = true; };
  }, [brandCode]);

  async function confirm(no: string) {
    if (!no || !brandCode) return;
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/vendor-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, vendorNo: no }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "บันทึก Vendor ไม่สำเร็จ"); return; }
      toast.success(`บันทึก Vendor ${no} แล้ว`);
      onConfirmed();
    } catch {
      toast.error("ยืนยัน Vendor ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  // One live dropdown in every state, saving on pick (decision: user,
  // 2026-09-07) — no "เปลี่ยน" to reveal it and no confirm step after it. There
  // is nothing to stage: picking a vendor is a single field write, and the
  // officer sees the result in the same cell they changed.
  //
  // The marker to its left carries what the dropdown cannot: a tick once the
  // row is confirmed, and nothing while it is still waiting. That is the only
  // difference left between a row that can be approved and one that cannot.
  return (
    // `flex w-full` rather than `inline-flex`: in a table cell the column still
    // sizes to the 280px minimum below, but in the preview drawer — where the
    // cell sits in a full-width block — the dropdown stretches to fill instead
    // of leaving ~90px of the panel unused.
    <span className="flex w-full items-center gap-1.5 whitespace-nowrap">
      <span className="w-[13px] shrink-0 inline-flex justify-center">
        {busy ? <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-faint)" }} />
          : confirmed ? <Check size={13} style={{ color: "#4fa37a" }} />
          : null}
      </span>
      {/* At least wide enough for a whole "ADV0080 · นายภาสพงษ์ พิษณุพจน์" — a
          truncated vendor is the one thing in this column worth reading in full,
          and the table scrolls rather than squeezing its neighbours. Grows past
          that wherever the container is wider. */}
      <span className="flex-1 min-w-0" style={{ minWidth: 280 }}
        title={confirmed ? vendorName ?? undefined : reason ?? undefined}>
        <SearchableSelect
          value={vendorNo ?? ""}
          onChange={confirm}
          disabled={busy}
          // Code and name in one label rather than label + subLabel, for two
          // reasons: a subLabel makes the closed control render two lines, which
          // would grow every row in the queue; and SearchableSelect filters on
          // `label` and `value` only — never `subLabel` — so a name pushed down
          // there stops being searchable, and a name is what an officer types.
          // One string keeps the row one line, leads with the code, and matches
          // either half.
          options={(vendors ?? []).map((v) => ({
            value: v.vendorNo,
            label: v.displayName ? `${v.vendorNo} · ${v.displayName}` : v.vendorNo,
          }))}
          placeholder={vendors === null ? "กำลังโหลด..." : "— เลือก Vendor —"}
          emptyLabel="— เลือก Vendor —"
          searchPlaceholder="ค้นหาชื่อ หรือ รหัส vendor..."
        />
      </span>
    </span>
  );
}
