"use client";

import { useState } from "react";
import { mutate } from "swr";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useViewerUat } from "@/lib/hooks/useFormEnvironments";

interface UatModeSwitchProps {
  /** Icon only, no PRO/UAT label — the mobile top bar's compact chips. */
  compact?: boolean;
}

/**
 * The one control that moves a tester between Production and UAT. While UAT
 * is selected it doubles as the standing marker that the viewer is not on
 * Production right now — the cookie it flips outlives the session that set
 * it, so this is what stops a real request from landing in the test database
 * three days later.
 *
 * Rendered from `useViewerUat()` (the shared `/api/form-environment` payload,
 * see `src/lib/hooks/useFormEnvironments.ts`), never from the cookie
 * directly — the navbar is never server-rendered (`SessionProvider` has no
 * `session` prop here), so there is no flash-free read available anyway, and
 * the payload is the one place that already re-verified tester membership.
 *
 * Hidden for anyone who is not an active tester, and hidden for a tester when
 * no form is open to UAT testing right now — EXCEPT when the viewer is
 * already in UAT mode: an admin turning off the last UAT-enabled form must
 * not strand a tester in UAT with no control left to switch back.
 */
export function UatModeSwitch({ compact = false }: UatModeSwitchProps) {
  const viewer = useViewerUat();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!viewer) return null;
  const showControl = viewer.uatMode || (viewer.isTester && viewer.anyUatForm);
  if (!showControl) return null;

  const uat = viewer.uatMode;

  const closeDialog = (next: boolean) => {
    if (submitting) return;
    setOpen(next);
  };

  const confirmSwitch = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/uat-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !uat }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error((json && json.error) || `HTTP ${res.status}`);
      }
      // Refresh the one payload every chip/filter reads, then force a full
      // reload: nearly every list in this app is client-fetched through SWR,
      // and `router.refresh()` only re-renders the server component tree,
      // which this app barely uses. Only a reload guarantees nothing is left
      // showing rows from the database the viewer just switched away from.
      await mutate("/api/form-environment");
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สลับโหมดไม่สำเร็จ");
      setSubmitting(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer border-none transition-colors shrink-0"
        style={{
          background: uat ? "var(--status-bad-bg)" : "var(--bg-badge)",
          color: uat ? "var(--status-bad-text)" : "var(--text-muted)",
        }}
        title={uat ? "กำลังอยู่ในโหมด UAT — คลิกเพื่อสลับกลับ Production" : "คลิกเพื่อสลับไปโหมดทดสอบ UAT"}
        aria-label={
          uat
            ? "Currently in UAT mode. Click to switch to Production."
            : "Currently in Production. Click to switch to UAT mode."
        }
      >
        <FlaskConical size={compact ? 13 : 13} />
        {!compact && <span className="text-[11px] font-extrabold">{uat ? "UAT" : "PRO"}</span>}
      </button>

      <Dialog
        open={open}
        onOpenChange={closeDialog}
        title={uat ? "สลับกลับ Production" : "สลับไปโหมด UAT"}
      >
        <p className="text-[13px] mb-4" style={{ color: "var(--text-muted)" }}>
          {uat
            ? "หลังจากสลับแล้ว คำขอที่คุณส่งหรือดำเนินการต่อจากนี้จะถูกบันทึกลงฐานข้อมูล Production (ข้อมูลจริง) แทนฐานข้อมูลทดสอบ UAT"
            : "หลังจากสลับแล้ว คำขอที่คุณส่งหรือดำเนินการต่อจากนี้จะถูกบันทึกลงฐานข้อมูล UAT (ข้อมูลทดสอบ) แทนฐานข้อมูล Production จนกว่าคุณจะสลับกลับ"}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={submitting} onClick={() => closeDialog(false)}>
            ยกเลิก
          </Button>
          <Button variant="danger" loading={submitting} onClick={() => void confirmSwitch()}>
            {uat ? "สลับไป Production" : "สลับไป UAT"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
