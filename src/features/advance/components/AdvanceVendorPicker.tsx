"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

export interface AdvanceVendorPickerProps {
  requestId: number;
  /** request.brandCode — the API resolves it to the interface company. */
  company: string;
  /** true in the drawer: show a small inline spinner instead of the parent popup. */
  compact?: boolean;
  /** notified after a successful confirm (parent tracks the confirmed vendorNo). */
  onConfirmed?: (vendorNo: string) => void;
  /** notified when the AI match run starts/stops (full page drives its own popup). */
  onMatchingChange?: (matching: boolean) => void;
}

export function AdvanceVendorPicker({
  requestId,
  company,
  compact = false,
  onConfirmed,
  onMatchingChange,
}: AdvanceVendorPickerProps) {
  const [vendors, setVendors] = useState<{ vendorNo: string; displayName: string | null }[]>([]);
  const [selectedVendor, setSelectedVendor] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    fetch(`/api/request/advance/vendors?company=${encodeURIComponent(company)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; vendors?: { vendorNo: string; displayName: string | null }[] }) => {
        if (!cancelled && j.ok && j.vendors) setVendors(j.vendors);
      })
      .catch(() => {});

    setMatching(true);
    onMatchingChange?.(true);
    fetch(`/api/request/advance/vendor-match/${requestId}`, { method: "POST" })
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { vendorNo: string | null; reason: string | null } }) => {
        if (cancelled) return;
        if (j.ok && j.data) {
          setReason(j.data.reason);
          setSelectedVendor((prev) => prev || (j.data?.vendorNo ?? ""));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) { setMatching(false); onMatchingChange?.(false); }
      });
    return () => { cancelled = true; };
  }, [requestId, company, onMatchingChange]);

  function confirm(vendorNo: string) {
    setSelectedVendor(vendorNo);
    if (!vendorNo) return;
    fetch("/api/request/advance/vendor-confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestId, vendorNo }),
    })
      .then((r) => r.json())
      .then((j: { ok: boolean; error?: string }) => {
        if (!j.ok) toast.error(j.error ?? "ยืนยัน Vendor ไม่สำเร็จ");
        else { toast.success("ยืนยัน Vendor แล้ว"); onConfirmed?.(vendorNo); }
      })
      .catch(() => toast.error("ยืนยัน Vendor ไม่สำเร็จ"));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
      <span>Vendor:</span>
      <div style={{ minWidth: 260, maxWidth: 400 }}>
        <SearchableSelect
          value={selectedVendor}
          onChange={confirm}
          options={vendors.map((v) => ({ value: v.vendorNo, label: v.displayName ?? v.vendorNo, subLabel: v.vendorNo }))}
          placeholder="— เลือก Vendor —"
          emptyLabel="— เลือก Vendor —"
          searchPlaceholder="ค้นหาชื่อ หรือ รหัส vendor..."
        />
      </div>
      {compact && matching && (
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" /> AI กำลังจับคู่...
        </span>
      )}
      {selectedVendor ? (
        <span title={reason ?? ""} className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: "rgba(79,163,122,0.15)", color: "#4fa37a" }}>● Match</span>
      ) : (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", color: "var(--color-danger)" }}>● Unmatch</span>
      )}
    </div>
  );
}
