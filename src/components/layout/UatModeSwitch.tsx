"use client";

import { useState } from "react";
import { mutate } from "swr";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useViewerUat } from "@/lib/hooks/useFormEnvironments";
import { uatSwitchLeavesRecord, urlAfterUatSwitch } from "@/lib/form-environment/uat-switch-url";
import { canSwitchEnvironment } from "@/lib/form-environment/viewer-controls";

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
  /**
   * Whether confirming would also leave the record named by `?id=` behind.
   * Drives one extra paragraph of dialog copy only — the switch goes to Home
   * either way. Read from `window.location` when the dialog opens rather than
   * during render: the navbar is never server-rendered, but a click handler is
   * the only place `window` is unambiguously there, and the answer cannot
   * change between opening the dialog and confirming it.
   */
  const [leavingRecord, setLeavingRecord] = useState(false);

  // The null check is separate so TypeScript narrows `viewer` below;
  // `canSwitchEnvironment` stays a plain boolean rather than a type predicate,
  // because a non-tester is a perfectly real viewer that it answers false for.
  if (!viewer || !canSwitchEnvironment(viewer)) return null;

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
      // Refresh the one payload every chip/filter reads, then leave the page
      // entirely for Home. Nearly every list in this app is client-fetched
      // through SWR and `router.refresh()` only re-renders the server component
      // tree, which this app barely uses — so a soft refresh leaves rows on
      // screen from the database the viewer just switched away from, and a hard
      // reload of a fill page re-opens the record in `?id=`, which is the one
      // thing the switch was meant to leave. Home is the page that is correct
      // in either environment; `urlAfterUatSwitch` resolves it against this
      // origin so a viewer already on Home gets a reload rather than an
      // assignment that may not reload at all.
      await mutate("/api/form-environment");
      const next = urlAfterUatSwitch(window.location.href);
      if (next === window.location.href) window.location.reload();
      else window.location.assign(next);
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
        onClick={() => {
          setLeavingRecord(uatSwitchLeavesRecord(window.location.href, !uat));
          setOpen(true);
        }}
        className={
          compact
            ? "flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer border-none transition-colors shrink-0"
            : "flex items-center gap-1.5 h-9 px-2.5 rounded-lg cursor-pointer transition-colors shrink-0"
        }
        style={{
          // Amber, not red. The chip reports which database the viewer is
          // writing to; red reads as an error, and being in UAT is a state
          // somebody chose. It still has to carry across the bar at a glance,
          // hence a tint where the neighbouring controls are plain.
          //
          // `--status-uat-*` is the one definition of that amber; the Form
          // Environment switches read the same tokens, so the chip and the
          // switch cannot drift into two different ambers.
          background: uat ? "var(--status-uat-bg)" : "var(--bg-card)",
          color: uat ? "var(--status-uat-text)" : "var(--text-muted)",
          ...(compact
            ? {}
            : {
                border: uat
                  ? "1px solid var(--status-uat-border)"
                  : "1px solid var(--border-card)",
              }),
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
            ? "หลังจากสลับแล้ว คำขอที่คุณส่งหรือดำเนินการต่อจากนี้จะถูกบันทึกลงฐานข้อมูล Production (ข้อมูลจริง) แทนฐานข้อมูลทดสอบ UAT และระบบจะพากลับไปหน้าแรก"
            : "หลังจากสลับแล้ว คำขอที่คุณส่งหรือดำเนินการต่อจากนี้จะถูกบันทึกลงฐานข้อมูล UAT (ข้อมูลทดสอบ) แทนฐานข้อมูล Production จนกว่าคุณจะสลับกลับ และระบบจะพากลับไปหน้าแรก"}
        </p>
        {leavingRecord && (
          <p className="text-[13px] mb-4" style={{ color: "var(--text-primary)" }}>
            {uat
              ? "คำขอที่เปิดอยู่ในหน้านี้เป็นข้อมูล UAT ระบบจะปิดคำขอนี้ทิ้ง (คำขอยังถูกบันทึกไว้ เปิดได้จากหน้าแรกหรือคำขอของฉัน)"
              : "คำขอที่เปิดอยู่ในหน้านี้เป็นข้อมูลจริง (Production) ระบบจะปิดคำขอนี้ทิ้ง (คำขอยังถูกบันทึกไว้ เปิดได้จากหน้าแรกหรือคำขอของฉัน)"}
          </p>
        )}
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
