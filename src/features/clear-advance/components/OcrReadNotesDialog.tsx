"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { OcrReadNote } from "@/lib/clr/ocr-read-notes";

/**
 * What the read was unsure about, said once after the rows have landed.
 *
 * It replaces a confirm screen, not a warning banner, so it is deliberately
 * not a gate: everything it mentions is already in the expense table and
 * editable, and dismissing it loses nothing. The point is that a requester who
 * uploads five receipts and gets three rows is told, rather than discovering
 * it when the total looks settled and is not.
 *
 * It opens only when there is something to say. A clean read is the ordinary
 * case and puts its rows in the table in silence — which is the whole reason
 * the confirm screen went.
 */
export function OcrReadNotesDialog({
  notes,
  onClose,
}: {
  notes: OcrReadNote[];
  onClose: () => void;
}) {
  /* Counts first, then the rows, because the first question is "did anything
     go missing" and the second is "which line do I look at". */
  const isTotal = (k: OcrReadNote["kind"]) => k === "count" || k === "skipped" || k === "truncated";
  const totals = notes.filter((n) => isTotal(n.kind));
  const rows = notes.filter((n) => !isTotal(n.kind));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="อ่านใบเสร็จแล้ว — มีบางอย่างที่ควรตรวจ">
      <div className="flex flex-col gap-3">
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          รายการทั้งหมดถูกใส่ในตาราง “รายการค่าใช้จ่ายจริง” แล้ว และแก้ไขได้ตามปกติ
        </p>

        {totals.length > 0 && (
          <div className="rounded-xl px-3.5 py-3 flex flex-col gap-1.5"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
            {totals.map((n, i) => (
              <span key={i} className="text-[12px]" style={{ color: "var(--text-primary)" }}>{n.text}</span>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {rows.map((n, i) => (
              <span key={i} className="text-[12px] flex items-start gap-1.5"
                style={{ color: "var(--text-info-yellow)" }}>
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>{n.text}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button type="button" onClick={onClose}>ตรวจแล้ว</Button>
        </div>
      </div>
    </Dialog>
  );
}
