"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronRight, Upload, AlertCircle, Clock } from "lucide-react";
import {
  type ErpPrepStatus,
} from "@/features/accounting/constants";
import { fmtDateOnly, fmtDateTime, fmtMoney } from "@/features/accounting/components/ApprovalQueueFilters";
import {
  buildErpJournalSections,
  type ErpJournalBuildContext,
  type ErpJournalBuildResult,
  type ErpJournalGroup,
  type ErpJournalLine,
  type ErpInterfaceTargetSection,
} from "@/lib/acc/erp-journal-builder";
import { ERP_INTERFACE_UNASSIGNED } from "@/features/accounting/lib/erp-interface-target";
import type { ErpPrepRow } from "@/lib/acc/erp-prep-service";
import {
  segmentSendState,
  type ErpInterfaceSendTarget,
} from "@/features/accounting/components/ErpInterfaceSendDialog";
import {
  buildPpapGroupNoByPairKey,
  ppapGroupNoForLine,
  sortJournalLinesForPpap,
} from "@/lib/acc/erp-ppap-payload";
import { useErpSandboxDevHost } from "@/features/accounting/hooks/useErpSandboxDevHost";

const BANK_COLOR = "#dc2626";

function prepStatusStyle(status: ErpPrepStatus): React.CSSProperties {
  if (status === "ready") {
    return {
      background: "var(--bg-info-green)",
      color: "var(--text-info-green)",
      border: "1px solid var(--border-info-green)",
    };
  }
  return {
    background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
    color: "var(--color-warning)",
    border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
  };
}

function fmtJournalAmount(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = fmtMoney(abs);
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

const JOURNAL_HEADERS = [
  "Posting Date",
  "Type",
  "Account Type",
  "Account No.",
  "Description",
  "Branch",
  "Dept",
  "Amount",
  "Debit",
  "Credit",
  "External Doc.",
] as const;

type JournalSegment = "queue" | "sent" | "incomplete";

function filterIfaceRowsForSegment(rows: ErpPrepRow[], segment: JournalSegment): ErpPrepRow[] {
  if (segment === "sent") {
    return rows.filter((r) => r.erpInterfaceStatus === "Sent");
  }
  if (segment === "incomplete") {
    return rows.filter((r) => r.prepStatus !== "ready");
  }
  return rows.filter((r) => r.prepStatus === "ready" && r.erpInterfaceStatus !== "Sent");
}

interface SentSendBatch {
  sentAt: string | null;
  rows: ErpPrepRow[];
}

/** Group sent documents into send rounds (same minute = one batch). */
function sentBatchKey(sentAt: string | null | undefined): string {
  if (!sentAt) return "__unknown__";
  const d = new Date(sentAt);
  if (isNaN(d.getTime())) return "__unknown__";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function groupSentRowsByBatch(rows: ErpPrepRow[]): SentSendBatch[] {
  const map = new Map<string, ErpPrepRow[]>();
  for (const row of rows) {
    const key = sentBatchKey(row.erpInterfaceSentAt);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  const batches: SentSendBatch[] = [];
  for (const batchRows of Array.from(map.values())) {
    let maxSent: string | null = null;
    for (const r of batchRows) {
      if (r.erpInterfaceSentAt && (!maxSent || r.erpInterfaceSentAt > maxSent)) {
        maxSent = r.erpInterfaceSentAt;
      }
    }
    batches.push({ sentAt: maxSent, rows: batchRows });
  }

  batches.sort((a, b) => {
    if (!a.sentAt && !b.sentAt) return 0;
    if (!a.sentAt) return 1;
    if (!b.sentAt) return -1;
    return b.sentAt.localeCompare(a.sentAt);
  });

  return batches;
}

function personGroupsFromIfaceRows(
  rows: ErpPrepRow[],
  context: ErpJournalBuildContext,
  target: string,
  isUnassigned: boolean,
): ErpJournalGroup[] {
  if (rows.length === 0) return [];
  const built = buildErpJournalSections(rows, context);
  if (isUnassigned) return built.unassigned.personGroups;
  return built.sections.find((s) => s.targetBrandCode === target)?.personGroups ?? [];
}

function segmentDocStats(rows: ErpPrepRow[]): { count: number; total: number } {
  let total = 0;
  for (const r of rows) total += Number(r.totalAmount) || 0;
  return { count: rows.length, total };
}

function groupsAllLines(groups: ErpJournalGroup[]): ErpJournalLine[] {
  const lines: ErpJournalLine[] = [];
  for (const group of groups) {
    lines.push(...groupAllLines(group));
  }
  return lines;
}

function JournalLineRow({ line, groupNo }: { line: ErpJournalLine; groupNo?: string | null }) {
  const isBank = line.accountType === "Bank Account";
  const isGl = line.accountType === "G/L Account";

  return (
    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
        {fmtDateOnly(line.postingDate)}
      </td>
      {groupNo != null ? (
        <td className="px-2.5 py-2 whitespace-nowrap">
          <span
            className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
            style={{
              color: "var(--nav-active-text)",
              background: "color-mix(in srgb, var(--nav-active-text) 10%, var(--bg-card))",
              border: "1px solid color-mix(in srgb, var(--nav-active-text) 22%, transparent)",
            }}
          >
            {groupNo || "—"}
          </span>
        </td>
      ) : null}
      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
        {line.documentType}
      </td>
      <td
        className="px-2.5 py-2 whitespace-nowrap"
        style={{ color: isBank ? BANK_COLOR : "var(--text-primary)" }}
      >
        {line.accountType}
      </td>
      <td
        className="px-2.5 py-2 font-mono whitespace-nowrap"
        style={{ color: "var(--text-primary)", fontWeight: isGl ? 700 : 400 }}
      >
        {line.accountNo}
      </td>
      <td className="px-2.5 py-2 min-w-[180px] max-w-[280px] truncate" title={line.description} style={{ color: "var(--text-primary)" }}>
        {line.description}
      </td>
      <td className="px-2.5 py-2 whitespace-nowrap">{line.branchCode}</td>
      <td className="px-2.5 py-2 whitespace-nowrap">{line.departmentCode}</td>
      <td
        className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap"
        style={{ color: isBank ? BANK_COLOR : "var(--text-primary)", fontWeight: isGl ? 700 : 500 }}
      >
        {fmtJournalAmount(line.amount)}
      </td>
      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">
        {line.debitAmount != null ? fmtMoney(line.debitAmount) : "—"}
      </td>
      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">
        {line.creditAmount != null ? fmtMoney(line.creditAmount) : "—"}
      </td>
      <td
        className="px-2.5 py-2 font-mono whitespace-nowrap"
        style={{ background: "color-mix(in srgb, var(--color-warning) 18%, transparent)" }}
      >
        {line.externalDocument || "—"}
      </td>
    </tr>
  );
}

function flattenSources(personGroups: ErpJournalGroup[]): ErpPrepRow[] {
  const sources: ErpPrepRow[] = [];
  for (const group of personGroups) {
    for (const batch of group.paymentBatches) {
      for (const row of batch.sources) sources.push(row);
    }
  }
  sources.sort((a, b) => {
    const pd = (a.paymentDate ?? "").localeCompare(b.paymentDate ?? "");
    if (pd !== 0) return pd;
    const an = a.requestNo ?? "";
    const bn = b.requestNo ?? "";
    if (an !== bn) return an.localeCompare(bn);
    return a.id - b.id;
  });
  return sources;
}

function groupAllLines(group: ErpJournalGroup): ErpJournalLine[] {
  const lines: ErpJournalLine[] = [];
  for (const batch of group.paymentBatches) {
    for (const line of batch.lines) {
      lines.push(line);
    }
  }
  return lines;
}

function personGroupStatusStyle(kind: ReturnType<typeof segmentSendState>["kind"]): React.CSSProperties {
  if (kind === "sent") {
    return {
      background: "var(--bg-info-green)",
      color: "var(--text-info-green)",
      border: "1px solid var(--border-info-green)",
    };
  }
  if (kind === "failed") {
    return {
      background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
      color: "var(--color-danger)",
      border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
    };
  }
  if (kind === "ready") {
    return {
      background: "color-mix(in srgb, var(--nav-active-text) 10%, var(--bg-card))",
      color: "var(--nav-active-text)",
      border: "1px solid color-mix(in srgb, var(--nav-active-text) 28%, transparent)",
    };
  }
  return {
    background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
    color: "var(--color-warning)",
    border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
  };
}

function segmentStatusStyle(kind: ReturnType<typeof segmentSendState>["kind"]): React.CSSProperties {
  return personGroupStatusStyle(kind);
}

function SegmentJournalPanel({
  groups,
  segment,
  interfaceTarget,
  interfaceTargetName,
  journalBatchName,
  bcMeta,
  context,
  onOpenDocument,
  onRequestSend,
  sentAt,
}: {
  groups: ErpJournalGroup[];
  segment: JournalSegment;
  interfaceTarget: string;
  interfaceTargetName: string;
  journalBatchName: string | null;
  bcMeta: string | null;
  context: ErpJournalBuildContext;
  onOpenDocument: (id: number) => void;
  onRequestSend?: (target: ErpInterfaceSendTarget) => void;
  sentAt?: string | null;
}) {
  const isArchive = segment === "sent";
  const sendState = useMemo(() => segmentSendState(groups), [groups]);
  const allLines = useMemo(() => groupsAllLines(groups), [groups]);
  const groupNoByPairKey = useMemo(() => buildPpapGroupNoByPairKey(allLines), [allLines]);
  const sources = useMemo(() => flattenSources(groups), [groups]);
  const totalAmount = useMemo(
    () => sources.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0),
    [sources],
  );
  const failedError = useMemo(() => {
    for (const group of groups) {
      for (const batch of group.paymentBatches) {
        for (const s of batch.sources) {
          if (s.erpInterfaceStatus === "Failed" && s.erpInterfaceError) {
            return s.erpInterfaceError;
          }
        }
      }
    }
    return null;
  }, [groups]);

  const segmentTitle =
    segment === "queue"
      ? "รอบรอส่ง"
      : segment === "incomplete"
        ? "ข้อมูลไม่ครบ"
        : sentAt
          ? `ส่งเมื่อ ${fmtDateTime(sentAt)}`
          : "รอบที่ส่งแล้ว";

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${isArchive ? "color-mix(in srgb, var(--border-info-green) 45%, var(--border-light))" : "var(--border-light)"}`,
        background: isArchive ? "color-mix(in srgb, var(--bg-info-green) 6%, var(--bg-card))" : "var(--bg-card)",
        opacity: isArchive ? 0.92 : 1,
      }}
    >
      <div
        className="px-3 py-2.5 flex flex-wrap items-center gap-2"
        style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
            {isArchive ? (
              sentAt ? (
                <Clock size={13} className="inline mr-1.5 -mt-0.5" style={{ color: "var(--text-info-green)" }} />
              ) : (
                <CheckCircle2 size={13} className="inline mr-1.5 -mt-0.5" style={{ color: "var(--text-info-green)" }} />
              )
            ) : null}
            {segmentTitle}
          </p>
          <p className="text-[10px] m-0 mt-0.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
            {fmtMoney(totalAmount)} บาท · {sources.length} เอกสาร
          </p>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={segmentStatusStyle(sendState.kind)}>
          {sendState.label}
        </span>
        {!isArchive && onRequestSend && sendState.canSend && (
          <button
            type="button"
            onClick={() =>
              onRequestSend({
                interfaceTarget,
                interfaceTargetName,
                personGroups: groups,
                journalBatchName,
                bcMeta,
                context,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border-none cursor-pointer"
            style={
              sendState.kind === "failed"
                ? {
                    background: "transparent",
                    color: "var(--color-danger)",
                    border: "1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)",
                  }
                : { background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }
            }
          >
            <Upload size={13} />
            {sendState.kind === "failed" ? "ส่งใหม่" : "ส่งเข้า ERP"}
          </button>
        )}
      </div>
      {!isArchive && failedError && (
        <div
          className="px-3 py-2 flex gap-2 text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--color-danger) 8%, transparent)",
            borderBottom: "1px solid var(--border-light)",
            color: "var(--color-danger)",
          }}
        >
          <AlertCircle size={14} className="shrink-0" />
          <span className="break-words">{failedError}</span>
        </div>
      )}
      <InterfaceSectionBody
        personGroups={groups}
        allLines={allLines}
        groupNoByPairKey={groupNoByPairKey}
        onOpenDocument={onOpenDocument}
        embedded
        compactSources={isArchive}
      />
    </div>
  );
}

function InterfaceSectionBody({
  personGroups,
  allLines,
  groupNoByPairKey,
  onOpenDocument,
  embedded,
  compactSources,
}: {
  personGroups: ErpJournalGroup[];
  allLines: ErpJournalLine[];
  groupNoByPairKey?: Map<string, string>;
  onOpenDocument: (id: number) => void;
  embedded?: boolean;
  compactSources?: boolean;
}) {
  const showPpapGroup = useErpSandboxDevHost();
  const resolvedGroupNoMap = useMemo(
    () => groupNoByPairKey ?? buildPpapGroupNoByPairKey(allLines),
    [groupNoByPairKey, allLines],
  );
  const lines = useMemo(
    () => sortJournalLinesForPpap(allLines, resolvedGroupNoMap),
    [allLines, resolvedGroupNoMap],
  );
  const journalHeaders = useMemo(
    () => (showPpapGroup
      ? (["Posting Date", "Group", ...JOURNAL_HEADERS.slice(1)] as const)
      : JOURNAL_HEADERS),
    [showPpapGroup],
  );
  const sources = useMemo(() => flattenSources(personGroups), [personGroups]);
  const sum = sources.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
  const amountsMatch = Math.round(sum * 100) === Math.round(lines
    .filter((l) => l.accountType === "G/L Account")
    .reduce((s, l) => s + (l.debitAmount ?? 0), 0) * 100);

  return (
    <div
      className="px-3 py-3"
      style={{
        ...(embedded ? {} : { borderTop: "1px solid var(--border-light)" }),
        background: "var(--bg-card)",
      }}
    >
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-light)", background: "var(--bg-card)" }}>
        {lines.length > 0 ? (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-[11px] min-w-[980px]">
              <thead>
                <tr style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}>
                  {journalHeaders.map((h) => (
                    <th
                      key={h}
                      className={`px-2.5 py-2 font-semibold whitespace-nowrap ${h === "Amount" || h === "Debit" || h === "Credit" ? "text-right" : "text-left"}`}
                      style={{ color: h === "Group" ? "var(--nav-active-text)" : "var(--text-faint)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <JournalLineRow
                    key={`${line.personGroupKey ?? "line"}-${line.accountType}-${line.accountNo}-${idx}`}
                    line={line}
                    groupNo={showPpapGroup ? (ppapGroupNoForLine(line, resolvedGroupNoMap) || "G1") : null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div
          className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide"
          style={{
            background: "var(--bg-card-alt)",
            borderTop: lines.length > 0 ? "1px solid var(--border-light)" : undefined,
            color: "var(--text-faint)",
          }}
        >
          เอกสารอ้างอิง · {sources.length} รายการ
        </div>

        <table className={`w-full text-[11px] ${compactSources ? "hidden sm:table" : ""}`}>
          <thead>
            <tr style={{ background: "var(--bg-card-alt)" }}>
              <th className="text-left px-2.5 py-1.5 font-semibold" style={{ color: "var(--text-faint)" }}>เลขที่</th>
              <th className="text-left px-2.5 py-1.5 font-semibold" style={{ color: "var(--text-faint)" }}>ผู้ขอ</th>
              <th className="text-left px-2.5 py-1.5 font-semibold" style={{ color: "var(--text-faint)" }}>แบรนด์เบิก</th>
              <th className="text-left px-2.5 py-1.5 font-semibold" style={{ color: "var(--text-faint)" }}>วันจ่าย</th>
              <th className="text-left px-2.5 py-1.5 font-semibold" style={{ color: "var(--text-faint)" }}>เดินทาง</th>
              <th className="text-left px-2.5 py-1.5 font-semibold hidden sm:table-cell" style={{ color: "var(--text-faint)" }}>ยานพาหนะ</th>
              <th className="text-right px-2.5 py-1.5 font-semibold" style={{ color: "var(--text-faint)" }}>ยอด</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                <td className="px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenDocument(s.id)}
                    className="font-semibold border-none bg-transparent p-0 cursor-pointer hover:underline"
                    style={{ color: "var(--nav-active-text)" }}
                  >
                    {s.requestNo ?? "—"}
                  </button>
                </td>
                <td className="px-2.5 py-1.5 max-w-[120px] truncate" style={{ color: "var(--text-secondary)" }} title={s.requesterFullName ?? undefined}>
                  {s.requesterFullName ?? "—"}
                </td>
                <td className="px-2.5 py-1.5 font-mono text-[10px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {s.brandCode ?? "—"}
                </td>
                <td className="px-2.5 py-1.5" style={{ color: "var(--text-muted)" }}>{fmtDateOnly(s.paymentDate)}</td>
                <td className="px-2.5 py-1.5" style={{ color: "var(--text-muted)" }}>{fmtDateOnly(s.travelDate)}</td>
                <td className="px-2.5 py-1.5 hidden sm:table-cell" style={{ color: "var(--text-muted)" }}>{s.vehicleName ?? "—"}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">{fmtMoney(s.totalAmount)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
              <td colSpan={6} className="px-2.5 py-1.5 font-bold" style={{ color: "var(--text-heading)" }}>
                <span className="inline-flex items-center gap-1">
                  รวม {sources.length} เอกสาร
                  {amountsMatch && lines.length > 0 && <CheckCircle2 size={12} style={{ color: "var(--text-info-green)" }} />}
                </span>
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>
                {fmtMoney(sum)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InterfaceSectionMeta({ section }: { section: ErpInterfaceTargetSection }) {
  const sectionReady = section.summary.incomplete === 0 && section.summary.personGroupCount > 0;

  return (
    <div
      className="px-4 py-3 flex items-start gap-3"
      style={{
        borderBottom: "1px solid var(--border-light)",
        background: sectionReady ? "var(--bg-info-green)" : "var(--bg-card-alt)",
      }}
    >
      <img
        src={section.targetBrandLogo}
        alt=""
        className="h-8 w-auto object-contain shrink-0 mt-0.5"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
            {section.targetBrandName}
          </span>
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            {section.targetBrandCode}
          </span>
          {sectionReady ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(79, 163, 122, 0.15)", color: "var(--text-info-green)" }}>
              ครบแล้ว
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
              ยังไม่ครบ
            </span>
          )}
        </div>

        {section.claimBrands.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[10px] font-bold uppercase" style={{ color: "var(--text-faint)" }}>แบรนด์เบิก</span>
            {section.claimBrands.map((c) => (
              <span
                key={c.brandCode}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", color: "var(--text-secondary)" }}
              >
                {c.brandLogo && (
                  <img src={c.brandLogo} alt="" className="h-3 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                {c.brandName}
              </span>
            ))}
          </div>
        )}

        <p className="text-[10px] m-0 mt-1.5" style={{ color: "var(--text-muted)" }}>
          Journal {section.journalBatchName ?? "—"}
          {" · "}
          {section.summary.personGroupCount} กลุ่ม (คน+แผนก)
          {" · "}
          พร้อม {section.summary.ready} / ไม่ครบ {section.summary.incomplete}
          {" · "}
          <span className="font-bold tabular-nums">{fmtMoney(section.summary.totalAmount)} บาท</span>
        </p>
        {section.bcMeta && (
          <p className="text-[10px] m-0 mt-1 truncate" style={{ color: "var(--text-faint)" }}>{section.bcMeta}</p>
        )}
      </div>
    </div>
  );
}

function JournalSegmentTabs({
  segment,
  onChange,
  counts,
}: {
  segment: JournalSegment;
  onChange: (segment: JournalSegment) => void;
  counts: { queue: number; sent: number; incomplete: number };
}) {
  const tabs: { id: JournalSegment; label: string; count: number }[] = [
    { id: "queue", label: "รอส่ง", count: counts.queue },
    { id: "sent", label: "ส่งแล้ว", count: counts.sent },
    { id: "incomplete", label: "ไม่ครบ", count: counts.incomplete },
  ];

  return (
    <div
      className="flex flex-wrap gap-1.5 p-1 rounded-xl"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
    >
      {tabs.map((tab) => {
        const active = segment === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border-none cursor-pointer transition-opacity"
            style={{
              background: active ? "var(--nav-active-bg)" : "transparent",
              color: active ? "var(--nav-active-text)" : "var(--text-muted)",
              boxShadow: active ? "0 1px 2px color-mix(in srgb, var(--shadow-color, #000) 8%, transparent)" : undefined,
            }}
          >
            {tab.label}
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums"
              style={{
                background: active ? "var(--bg-card)" : "var(--bg-badge)",
                color: active ? "var(--nav-active-text)" : "var(--text-faint)",
              }}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function JournalSegmentSummary({
  segment,
  stats,
  batchCount,
}: {
  segment: JournalSegment;
  stats: { count: number; total: number };
  batchCount?: number;
}) {
  const label = segment === "queue" ? "รอส่ง" : segment === "sent" ? "ส่งแล้ว" : "ไม่ครบ";
  const countLabel =
    segment === "sent" && batchCount != null && batchCount > 1
      ? `${batchCount} รอบ · ${stats.count} เอกสาร`
      : `${stats.count} เอกสาร`;
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg text-[11px]"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
    >
      <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
        {label} {countLabel}
      </span>
      <span className="ml-auto tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>
        {fmtMoney(stats.total)} บาท
      </span>
    </div>
  );
}

function JournalSegmentEmpty({
  segment,
  sentMonthFilter,
}: {
  segment: JournalSegment;
  sentMonthFilter?: string;
}) {
  const messages: Record<JournalSegment, string> = {
    queue: "ไม่มีเอกสารที่รอส่ง — ดูที่แถบ「ส่งแล้ว」หรือรอเอกสารใหม่",
    sent: sentMonthFilter
      ? "ไม่มีรายการที่ส่งในเดือนที่เลือก"
      : "ยังไม่มีรายการที่ส่งเข้า ERP",
    incomplete: "ไม่มีเอกสารที่ข้อมูลไม่ครบ",
  };
  return (
    <p className="text-[12px] py-8 text-center m-0" style={{ color: "var(--text-muted)" }}>
      {messages[segment]}
    </p>
  );
}

function InterfaceSectionCard({
  section,
  expanded,
  onToggle,
  onOpenDocument,
}: {
  section: ErpInterfaceTargetSection;
  expanded: boolean;
  onToggle: () => void;
  onOpenDocument: (id: number) => void;
}) {
  const sectionReady = section.summary.incomplete === 0 && section.summary.personGroupCount > 0;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${sectionReady ? "var(--border-info-green)" : "var(--border-card)"}`,
        background: sectionReady ? "var(--bg-info-green)" : "var(--bg-card-alt)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={16} className="shrink-0 mt-1" style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronRight size={16} className="shrink-0 mt-1" style={{ color: "var(--text-muted)" }} />
        )}
        <img
          src={section.targetBrandLogo}
          alt=""
          className="h-8 w-auto object-contain shrink-0 mt-0.5"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
              {section.targetBrandName}
            </span>
            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
              {section.targetBrandCode}
            </span>
            {sectionReady ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(79, 163, 122, 0.15)", color: "var(--text-info-green)" }}>
                ครบแล้ว
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
                ยังไม่ครบ
              </span>
            )}
          </div>

          {section.claimBrands.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] font-bold uppercase" style={{ color: "var(--text-faint)" }}>แบรนด์เบิก</span>
              {section.claimBrands.map((c) => (
                <span
                  key={c.brandCode}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", color: "var(--text-secondary)" }}
                >
                  {c.brandLogo && (
                    <img src={c.brandLogo} alt="" className="h-3 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  {c.brandName}
                </span>
              ))}
            </div>
          )}

          <p className="text-[10px] m-0 mt-1.5" style={{ color: "var(--text-muted)" }}>
            Journal {section.journalBatchName ?? "—"}
            {" · "}
            {section.summary.personGroupCount} กลุ่ม (คน+แผนก)
            {" · "}
            พร้อม {section.summary.ready} / ไม่ครบ {section.summary.incomplete}
            {" · "}
            <span className="font-bold tabular-nums">{fmtMoney(section.summary.totalAmount)} บาท</span>
          </p>
          {section.bcMeta && (
            <p className="text-[10px] m-0 mt-1 truncate" style={{ color: "var(--text-faint)" }}>{section.bcMeta}</p>
          )}
        </div>
      </button>

      {expanded && (
        <InterfaceSectionBody
          personGroups={section.personGroups}
          allLines={section.allLines}
          groupNoByPairKey={buildPpapGroupNoByPairKey(section.allLines)}
          onOpenDocument={onOpenDocument}
        />
      )}
    </div>
  );
}

function InterfaceTargetJournalPanel({
  target,
  isUnassigned,
  section,
  summary,
  ifaceRows,
  context,
  onOpenDocument,
  onRequestSend,
  sentMonthFilter,
}: {
  target: string;
  isUnassigned: boolean;
  section: ErpInterfaceTargetSection | null;
  summary: ErpJournalBuildResult["sections"][0]["summary"] | ErpJournalBuildResult["unassigned"]["summary"] | undefined;
  ifaceRows: ErpPrepRow[];
  context: ErpJournalBuildContext;
  onOpenDocument: (id: number) => void;
  onRequestSend?: (target: ErpInterfaceSendTarget) => void;
  sentMonthFilter?: string;
}) {
  const [journalSegment, setJournalSegment] = useState<JournalSegment>("queue");

  const segmentCounts = useMemo(() => ({
    queue: filterIfaceRowsForSegment(ifaceRows, "queue").length,
    sent: filterIfaceRowsForSegment(ifaceRows, "sent").length,
    incomplete: filterIfaceRowsForSegment(ifaceRows, "incomplete").length,
  }), [ifaceRows]);

  const activeSegmentRows = useMemo(
    () => filterIfaceRowsForSegment(ifaceRows, journalSegment),
    [ifaceRows, journalSegment],
  );

  const activeGroups = useMemo(
    () => personGroupsFromIfaceRows(activeSegmentRows, context, target, isUnassigned),
    [activeSegmentRows, context, target, isUnassigned],
  );

  const activeStats = useMemo(() => segmentDocStats(activeSegmentRows), [activeSegmentRows]);

  const sentBatches = useMemo(() => {
    if (journalSegment !== "sent") return [];
    return groupSentRowsByBatch(activeSegmentRows);
  }, [journalSegment, activeSegmentRows]);

  if (ifaceRows.length === 0) {
    return (
      <p className="text-[12px] py-10 text-center m-0" style={{ color: "var(--text-muted)" }}>
        ไม่พบรายการในกลุ่มนี้
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!isUnassigned ? (
        <JournalSegmentTabs
          segment={journalSegment}
          onChange={setJournalSegment}
          counts={segmentCounts}
        />
      ) : null}

      {!isUnassigned ? (
        <JournalSegmentSummary
          segment={journalSegment}
          stats={activeStats}
          batchCount={journalSegment === "sent" ? sentBatches.length : undefined}
        />
      ) : summary ? (
        <div
          className="flex flex-wrap gap-2 px-3 py-2.5 rounded-lg"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
        >
          <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {summary.personGroupCount} กลุ่ม (คน+แผนก)
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={prepStatusStyle("ready")}>
            พร้อมส่ง {summary.ready}
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={prepStatusStyle("incomplete")}>
            ข้อมูลไม่ครบ {summary.incomplete}
          </span>
          <span className="text-[11px] ml-auto tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>
            รวม {fmtMoney(summary.totalAmount)} บาท
          </span>
        </div>
      ) : null}

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--border-light)", background: "var(--bg-card)" }}
      >
        {isUnassigned ? (
          <div className="px-4 py-3" style={{ background: "var(--bg-info-yellow)", borderBottom: "1px solid var(--border-light)" }}>
            <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              แบรนด์เบิกที่ยังไม่ตั้งปลายทาง
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              <Link
                href="/request/accounting/settings?tab=erpInterface"
                className="font-medium no-underline hover:underline"
                style={{ color: "var(--nav-active-text)" }}
              >
                ตั้ง &quot;ส่งเข้าแบรนด์&quot; ที่ Settings → Interface ERP
              </Link>
            </p>
          </div>
        ) : section ? (
          <InterfaceSectionMeta section={section} />
        ) : null}

        <div className="px-3 py-3">
          {activeSegmentRows.length === 0 ? (
            <JournalSegmentEmpty
              segment={isUnassigned ? "incomplete" : journalSegment}
              sentMonthFilter={sentMonthFilter}
            />
          ) : journalSegment === "sent" ? (
            <div className="flex flex-col gap-3">
              {sentBatches.map((batch, idx) => {
                const batchGroups = personGroupsFromIfaceRows(
                  batch.rows,
                  context,
                  target,
                  isUnassigned,
                );
                const batchKey = batch.sentAt ?? `unknown-${idx}`;
                return (
                  <SegmentJournalPanel
                    key={batchKey}
                    groups={batchGroups}
                    segment="sent"
                    sentAt={batch.sentAt}
                    interfaceTarget={target}
                    interfaceTargetName={section?.targetBrandName ?? target}
                    journalBatchName={section?.journalBatchName ?? null}
                    bcMeta={section?.bcMeta ?? null}
                    context={context}
                    onOpenDocument={onOpenDocument}
                  />
                );
              })}
            </div>
          ) : (
            <SegmentJournalPanel
              groups={activeGroups}
              segment={journalSegment}
              interfaceTarget={target}
              interfaceTargetName={section?.targetBrandName ?? target}
              journalBatchName={section?.journalBatchName ?? null}
              bcMeta={section?.bcMeta ?? null}
              context={context}
              onOpenDocument={onOpenDocument}
              onRequestSend={isUnassigned || journalSegment !== "queue" ? undefined : onRequestSend}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ErpJournalPreview({
  rows,
  context,
  built,
  onOpenDocument,
  interfaceTargetCode,
  onRequestSend,
  sentMonthFilter,
}: {
  rows: ErpPrepRow[];
  context: ErpJournalBuildContext | null;
  built?: ErpJournalBuildResult | null;
  onOpenDocument: (id: number) => void;
  interfaceTargetCode?: string | null;
  onRequestSend?: (target: ErpInterfaceSendTarget) => void;
  sentMonthFilter?: string;
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());

  const result = useMemo(() => {
    if (built !== undefined) return built;
    if (!context) return null;
    return buildErpJournalSections(rows, context);
  }, [built, rows, context]);

  const toggleSection = (code: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  if (!context || !result) {
    return (
      <p className="text-[12px] py-8 text-center m-0" style={{ color: "var(--text-muted)" }}>
        กำลังโหลดข้อมูล Journal...
      </p>
    );
  }

  if (interfaceTargetCode) {
    const target = interfaceTargetCode.trim().toUpperCase();
    const isUnassigned = target === ERP_INTERFACE_UNASSIGNED;
    const section = isUnassigned
      ? null
      : result.sections.find((s) => s.targetBrandCode === target) ?? null;
    const summary = isUnassigned ? result.unassigned.summary : section?.summary;

    return (
      <InterfaceTargetJournalPanel
        target={target}
        isUnassigned={isUnassigned}
        section={section}
        summary={summary}
        ifaceRows={rows}
        context={context}
        onOpenDocument={onOpenDocument}
        onRequestSend={onRequestSend}
        sentMonthFilter={sentMonthFilter}
      />
    );
  }

  const hasData =
    result.sections.length > 0 || result.unassigned.personGroups.length > 0;

  if (!hasData) {
    return (
      <p className="text-[12px] py-10 text-center m-0" style={{ color: "var(--text-muted)" }}>
        ไม่พบรายการที่ตรงกับตัวกรอง
      </p>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      <div
        className="flex flex-wrap gap-2 px-3 py-2.5 rounded-lg"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
      >
        <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {result.summary.interfaceSectionCount} Interface · {result.summary.personGroupCount} กลุ่ม (คน+แผนก)
        </span>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={prepStatusStyle("ready")}>
          พร้อมส่ง {result.summary.ready}
        </span>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={prepStatusStyle("incomplete")}>
          ข้อมูลไม่ครบ {result.summary.incomplete}
        </span>
        <span className="text-[11px] ml-auto tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>
          รวม {fmtMoney(result.summary.totalAmount)} บาท
        </span>
      </div>

      {result.sections.map((section) => {
        const expanded = !collapsedSections.has(section.targetBrandCode);
        return (
          <InterfaceSectionCard
            key={section.targetBrandCode}
            section={section}
            expanded={expanded}
            onToggle={() => toggleSection(section.targetBrandCode)}
            onOpenDocument={onOpenDocument}
          />
        );
      })}

      {result.unassigned.personGroups.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border-info-yellow)", background: "var(--bg-info-yellow)" }}
        >
          <div className="px-4 py-3">
            <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              แบรนด์เบิกที่ยังไม่ตั้งปลายทาง
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              <Link
                href="/request/accounting/settings?tab=erpInterface"
                className="font-medium no-underline hover:underline"
                style={{ color: "var(--nav-active-text)" }}
              >
                ตั้ง &quot;ส่งเข้าแบรนด์&quot; ที่ Settings → Interface ERP
              </Link>
              {" "}ก่อนรวมเข้ากลุ่ม
            </p>
          </div>
          <div style={{ borderTop: "1px solid var(--border-light)", background: "var(--bg-card)" }}>
            <InterfaceSectionBody
              personGroups={result.unassigned.personGroups}
              allLines={result.unassigned.allLines}
              onOpenDocument={onOpenDocument}
            />
          </div>
        </div>
      )}
    </div>
  );
}
