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
 * Deliberately not AdvanceVendorPicker: that one loads the whole vendor list
 * and POSTs a fresh match on mount, which per row would mean one list fetch and
 * one match run for every line in the queue. This reads the match the queue
 * already fetched and only asks the server when the officer acts.
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
  // Only a row that needs the officer to choose pulls the list in.
  const needsPicker = status !== "confirmed" && !vendorNo;

  useEffect(() => {
    if (!needsPicker || !brandCode) return;
    let cancelled = false;
    loadVendors(brandCode).then((v) => { if (!cancelled) setVendors(v); });
    return () => { cancelled = true; };
  }, [needsPicker, brandCode]);

  async function confirm(no: string) {
    if (!no || !brandCode) return;
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/vendor-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, vendorNo: no }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "ยืนยัน Vendor ไม่สำเร็จ"); return; }
      toast.success("ยืนยัน Vendor แล้ว");
      onConfirmed();
    } catch {
      toast.error("ยืนยัน Vendor ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  // The code, not the name (decision: user, 2026-09-07). Thai vendor names run
  // long and made this the widest column in a table that already scrolls; the
  // code is short, fixed-width and the thing that reaches BC. The name stays a
  // hover away, and the picker below still searches on it.
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap font-mono"
        style={{ color: "var(--text-secondary)" }} title={vendorName ?? undefined}>
        <Check size={13} className="shrink-0" style={{ color: "#4fa37a" }} />
        {vendorNo}
      </span>
    );
  }

  // Matched but not yet confirmed: one click, since the match is a staff-code
  // lookup rather than a guess.
  if (vendorNo) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className="text-[12px] font-mono" style={{ color: "var(--text-muted)" }}
          title={vendorName ?? undefined}>
          {vendorNo}
        </span>
        <button type="button" onClick={() => confirm(vendorNo)} disabled={busy}
          className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border-none"
          style={{
            background: "var(--nav-active-bg)", color: "var(--nav-active-text)",
            cursor: busy ? "wait" : "pointer",
          }}
          title={`ยืนยัน ${vendorName ?? vendorNo} (${vendorNo})`}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : "ยืนยัน"}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-block" style={{ minWidth: 180 }} title={reason ?? undefined}>
      <SearchableSelect
        value=""
        onChange={confirm}
        // Name as the label even though the column shows codes: SearchableSelect
        // filters on `label` and `value` only, never `subLabel`, so putting the
        // name underneath would make it unsearchable — and a name is what an
        // officer types when the match came up empty. The code is `value`, so
        // both still find a row.
        options={(vendors ?? []).map((v) => ({
          value: v.vendorNo, label: v.displayName ?? v.vendorNo, subLabel: v.vendorNo,
        }))}
        placeholder={vendors === null ? "กำลังโหลด..." : "— เลือก Vendor —"}
        emptyLabel="— เลือก Vendor —"
        searchPlaceholder="ค้นหาชื่อ หรือ รหัส vendor..."
      />
    </span>
  );
}
