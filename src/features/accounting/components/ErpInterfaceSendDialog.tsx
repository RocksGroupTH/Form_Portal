"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { fmtMoney } from "@/features/accounting/components/ApprovalQueueFilters";
import { erpEnvironmentShortLabel } from "@/lib/acc/erp-environment-shared";
import type { ErpJournalGroup } from "@/lib/acc/erp-journal-builder";
import type { ErpJournalBuildContext } from "@/lib/acc/erp-journal-builder";
import {
  buildPpapJournalPayloadFromGroups,
  collectGroupsRequestIds,
} from "@/lib/acc/erp-ppap-payload";
import type { ErpPrepRow } from "@/lib/acc/erp-prep-service";
import type { FormEnvironmentValue } from "@/lib/form-environment";

export interface ErpInterfaceSendTarget {
  interfaceTarget: string;
  interfaceTargetName: string;
  personGroups: ErpJournalGroup[];
  journalBatchName: string | null;
  bcMeta: string | null;
  context: ErpJournalBuildContext;
  /**
   * The environment and request ids GET /api/request/accounting/erp-prep
   * returned when this queue was loaded — echoed back verbatim on send so the
   * server can refuse (409) a click bound to a queue that no longer matches
   * its own resolve. Never recomputed client-side: recomputing would let the
   * sender's own cookie decide again, exactly what this binding exists to stop.
   */
  queueEnvironment: FormEnvironmentValue | null;
  queueRequestIds: number[];
}

type DialogPhase = "confirm" | "sending" | "success" | "error";

function flattenGroupsSources(groups: ErpJournalGroup[]): ErpPrepRow[] {
  const out: ErpPrepRow[] = [];
  const seen = new Set<number>();
  for (const group of groups) {
    for (const batch of group.paymentBatches) {
      for (const s of batch.sources) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          out.push(s);
        }
      }
    }
  }
  return out;
}

function flattenGroupSources(group: ErpJournalGroup): ErpPrepRow[] {
  return flattenGroupsSources([group]);
}

export function personGroupSendState(group: ErpJournalGroup): {
  canSend: boolean;
  label: string;
  kind: "sent" | "failed" | "pending" | "incomplete" | "ready";
} {
  const sources = flattenGroupSources(group);
  if (sources.some((s) => s.erpInterfaceStatus === "Pending")) {
    return { canSend: false, label: "กำลังส่ง", kind: "pending" };
  }
  if (sources.length > 0 && sources.every((s) => s.erpInterfaceStatus === "Sent")) {
    return { canSend: false, label: "ส่งสำเร็จ", kind: "sent" };
  }
  if (sources.some((s) => s.erpInterfaceStatus === "Failed")) {
    return { canSend: group.prepStatus === "ready", label: "ส่งไม่สำเร็จ", kind: "failed" };
  }
  if (group.prepStatus !== "ready") {
    return { canSend: false, label: "ข้อมูลไม่ครบ", kind: "incomplete" };
  }
  return { canSend: true, label: "พร้อมส่ง", kind: "ready" };
}

export function segmentSendState(groups: ErpJournalGroup[]): {
  canSend: boolean;
  label: string;
  kind: "sent" | "failed" | "pending" | "incomplete" | "ready";
} {
  if (groups.length === 0) {
    return { canSend: false, label: "—", kind: "incomplete" };
  }
  const kinds = groups.map((g) => personGroupSendState(g).kind);
  if (kinds.some((k) => k === "pending")) {
    return { canSend: false, label: "กำลังส่ง", kind: "pending" };
  }
  if (kinds.every((k) => k === "sent")) {
    return { canSend: false, label: "ส่งสำเร็จ", kind: "sent" };
  }
  if (kinds.some((k) => k === "failed")) {
    const canSend = groups.every((g) => g.prepStatus === "ready");
    return { canSend, label: "ส่งไม่สำเร็จ", kind: "failed" };
  }
  if (groups.some((g) => g.prepStatus !== "ready")) {
    return { canSend: false, label: "ข้อมูลไม่ครบ", kind: "incomplete" };
  }
  return { canSend: true, label: "พร้อมส่ง", kind: "ready" };
}

export function ErpInterfaceSendDialog({
  open,
  onOpenChange,
  target,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ErpInterfaceSendTarget | null;
  onSuccess: () => void;
}) {
  const [phase, setPhase] = useState<DialogPhase>("confirm");
  const [errorMessage, setErrorMessage] = useState("");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setPhase("confirm");
      setErrorMessage("");
    }
    wasOpenRef.current = open;
  }, [open]);

  const summary = useMemo(() => {
    if (!target) return null;
    const payload = buildPpapJournalPayloadFromGroups(
      target.personGroups,
      target.journalBatchName ?? "",
    );
    const sources = flattenGroupsSources(target.personGroups);
    const total = sources.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
    return {
      sourceCount: sources.length,
      lineCount: payload.lines.length,
      total,
      requestNos: sources.map((s) => s.requestNo).filter(Boolean) as string[],
    };
  }, [target]);

  const envLabel = target
    ? erpEnvironmentShortLabel(target.context.erpEnvironment)
    : "PROD";
  const isProd = target?.context.erpEnvironment === "Production";

  const handleSend = useCallback(async () => {
    if (!target) return;
    if (!target.queueEnvironment) {
      // Should not happen — the dialog only opens from a queue that already
      // loaded — but fail closed rather than post with nothing to bind the
      // click to.
      setErrorMessage("โหลดคิวใหม่ก่อนส่ง — ไม่พบสภาพแวดล้อมของคิวที่แสดงอยู่");
      setPhase("error");
      return;
    }
    setPhase("sending");
    setErrorMessage("");

    try {
      const res = await fetch("/api/request/accounting/erp-prep/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interfaceTarget: target.interfaceTarget,
          environment: target.queueEnvironment,
          requestIds: target.queueRequestIds,
        }),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        setErrorMessage(json.error ?? "ส่งเข้า ERP ไม่สำเร็จ");
        setPhase("error");
        return;
      }
      setPhase("success");
      toast.success("ส่งเข้า ERP สำเร็จ");
      onOpenChange(false);
      onSuccess();
    } catch {
      setErrorMessage("เกิดข้อผิดพลาดในการเชื่อมต่อ — ลองใหม่หรือแจ้ง IT");
      setPhase("error");
    }
  }, [target, onSuccess, onOpenChange]);

  if (!target || !summary) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="ส่งข้อมูลเข้า ERP"
      scrollable={false}
      uniformSurface
      contentClassName="max-w-md"
    >
      <div className="px-5 pb-5 flex flex-col gap-4">
        {phase === "confirm" && (
          <>
            <div
              className="rounded-lg px-3 py-2.5"
              style={{
                background: isProd
                  ? "color-mix(in srgb, var(--color-warning) 12%, transparent)"
                  : "color-mix(in srgb, var(--color-info) 12%, transparent)",
                border: `1px solid ${isProd ? "color-mix(in srgb, var(--color-warning) 35%, transparent)" : "var(--border-info-green)"}`,
              }}
            >
              <p className="text-[12px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
                สภาพแวดล้อม: {envLabel}
                {target.context.erpEnvironment === "Sandbox" ? " (Sandbox)" : " (Production)"}
              </p>
              <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
                {isProd
                  ? "ข้อมูลจะถูกบันทึกใน Business Central Production — ตรวจสอบยอดและบัญชีให้ถูกต้องก่อนยืนยัน"
                  : "ข้อมูลจะถูกบันทึกใน Business Central UAT/Sandbox"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <p className="text-[10px] font-bold uppercase m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>กลุ่ม Interface</p>
                <p className="m-0 font-semibold" style={{ color: "var(--text-primary)" }}>{target.interfaceTargetName}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>Journal Batch</p>
                <p className="m-0 font-semibold" style={{ color: "var(--text-primary)" }}>{target.journalBatchName ?? "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] font-bold uppercase m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>รอบส่ง</p>
                <p className="m-0 font-semibold" style={{ color: "var(--text-primary)" }}>
                  รวมเอกสารที่พร้อมส่งทั้งหมดใน {target.interfaceTargetName}
                </p>
              </div>
              {target.bcMeta && (
                <div className="col-span-2">
                  <p className="text-[10px] font-bold uppercase m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>BC</p>
                  <p className="m-0 truncate text-[11px]" style={{ color: "var(--text-muted)" }} title={target.bcMeta}>{target.bcMeta}</p>
                </div>
              )}
            </div>

            <div
              className="rounded-lg px-3 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
            >
              <span style={{ color: "var(--text-secondary)" }}>{summary.sourceCount} เอกสาร</span>
              <span style={{ color: "var(--text-secondary)" }}>{summary.lineCount} บรรทัด Journal</span>
              <span className="font-bold tabular-nums ml-auto" style={{ color: "var(--text-heading)" }}>
                {fmtMoney(summary.total)} บาท
              </span>
            </div>

            {summary.requestNos.length > 0 && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                เลขที่: {summary.requestNos.slice(0, 6).join(", ")}
                {summary.requestNos.length > 6 ? ` +${summary.requestNos.length - 6}` : ""}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                ยกเลิก
              </Button>
              <Button type="button" variant="primary" onClick={handleSend}>
                <Upload size={14} />
                ยืนยันส่งเข้า ERP
              </Button>
            </div>
          </>
        )}

        {phase === "sending" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={32} className="animate-spin" style={{ color: "var(--nav-active-text)" }} />
            <p className="text-[13px] font-medium m-0" style={{ color: "var(--text-heading)" }}>
              กำลังส่งข้อมูลเข้า Business Central…
            </p>
            <p className="text-[11px] m-0 text-center" style={{ color: "var(--text-muted)" }}>
              กรุณารอสักครู่ อย่าปิดหน้าต่างนี้
            </p>
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 size={40} style={{ color: "var(--text-info-green)" }} />
            <p className="text-[14px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              ส่งเข้า ERP สำเร็จ
            </p>
            <p className="text-[12px] m-0 text-center" style={{ color: "var(--text-muted)" }}>
              อัปเดตสถานะ {collectGroupsRequestIds(target.personGroups).length} เอกสารแล้ว
            </p>
            <Button type="button" className="mt-2" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex gap-2">
              <AlertCircle size={20} className="shrink-0 mt-0.5" style={{ color: "var(--color-danger)" }} />
              <div>
                <p className="text-[13px] font-bold m-0" style={{ color: "var(--color-danger)" }}>
                  ส่งเข้า ERP ไม่สำเร็จ
                </p>
                <p className="text-[12px] m-0 mt-2 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>
                  {errorMessage}
                </p>
              </div>
            </div>
            <p className="text-[11px] m-0 rounded-lg px-3 py-2" style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}>
              หากปัญหายังไม่หาย กรุณาแจ้ง IT พร้อมกลุ่ม {target.interfaceTarget} และข้อความด้านบน
            </p>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                ปิด
              </Button>
              <Button type="button" onClick={() => setPhase("confirm")}>
                ลองส่งใหม่
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
