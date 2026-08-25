"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertCircle, ExternalLink } from "lucide-react";
import { fmtMoney } from "@/features/accounting/components/ApprovalQueueFilters";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";

/** Where to go to fix a given preview error. Dept map is shared with AP-1. */
function settingsHrefForError(error?: string): string {
  const e = error ?? "";
  // AP-2 reuses AP-1's HR↔ERP department map — fix it in Accounting settings.
  if (e.includes("แผนก") || e.toLowerCase().includes("department")) {
    return "/request/accounting/settings?tab=departments";
  }
  return "/request/advance/settings?tab=erpInterface";
}

export interface PreviewLine {
  groupNo: string;
  postingDate: string;
  documentType: string;
  accountType: string;
  accountNo: string;
  description: string;
  branchCode: string;
  departmentCode: string;
  amount: number;
  debitAmount: number | null;
  creditAmount: number | null;
  externalDocument: string;
}
export interface PreviewItem {
  id: number;
  requestNo: string | null;
  interfaceTarget: string | null;
  journalBatchName: string | null;
  paymentDate: string | null;
  payeeName: string | null;
  environment: string | null;
  ok: boolean;
  error?: string;
  lines: PreviewLine[];
}

const BANK_COLOR = "#dc2626";

const JOURNAL_HEADERS = [
  "Posting Date", "Group", "Type", "Account Type", "Account No.", "Description",
  "Branch", "Dept", "Amount", "Debit", "Credit", "External Doc.",
] as const;

function fmtJournalAmount(amount: number): string {
  const f = fmtMoney(Math.abs(amount));
  return amount < 0 ? `-${f}` : f;
}

function JournalRow({ line }: { line: PreviewLine }) {
  const isGl = line.accountType === "G/L Account";
  const isBank = line.accountType === "Bank Account";
  return (
    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{line.postingDate}</td>
      <td className="px-2.5 py-2 whitespace-nowrap font-mono font-semibold" style={{ color: "var(--nav-active-text)" }}>{line.groupNo}</td>
      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{line.documentType}</td>
      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: isBank ? BANK_COLOR : "var(--text-primary)" }}>{line.accountType}</td>
      <td className="px-2.5 py-2 font-mono whitespace-nowrap" style={{ color: "var(--text-primary)", fontWeight: isGl ? 700 : 400 }}>{line.accountNo}</td>
      <td className="px-2.5 py-2 min-w-[180px] max-w-[280px] truncate" title={line.description} style={{ color: "var(--text-primary)" }}>{line.description}</td>
      <td className="px-2.5 py-2 whitespace-nowrap">{line.branchCode || "—"}</td>
      <td className="px-2.5 py-2 whitespace-nowrap">{line.departmentCode || "—"}</td>
      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: isBank ? BANK_COLOR : "var(--text-primary)", fontWeight: isGl ? 700 : 500 }}>{fmtJournalAmount(line.amount)}</td>
      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{line.debitAmount != null ? fmtMoney(line.debitAmount) : "—"}</td>
      <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">{line.creditAmount != null ? fmtMoney(line.creditAmount) : "—"}</td>
      <td className="px-2.5 py-2 font-mono whitespace-nowrap" style={{ background: "color-mix(in srgb, var(--color-warning) 18%, transparent)" }}>{line.externalDocument || "—"}</td>
    </tr>
  );
}

interface Section {
  target: string;
  name: string;
  logo: string | null;
  journalBatchName: string | null;
  environment: string | null;
  okItems: PreviewItem[];
  badItems: PreviewItem[];
  totalDebit: number;
}

export function AdvanceJournalPreview({ items, loading }: { items: PreviewItem[]; loading?: boolean }) {
  const sections = useMemo<Section[]>(() => {
    const byTarget = new Map<string, PreviewItem[]>();
    for (const it of items) {
      const t = it.interfaceTarget ?? "—";
      const list = byTarget.get(t) ?? [];
      list.push(it);
      byTarget.set(t, list);
    }
    return Array.from(byTarget.entries()).map(([target, list]) => {
      const okItems = list.filter((i) => i.ok);
      const badItems = list.filter((i) => !i.ok);
      const brand = ERP_INTERFACE_BRANDS.find((b) => b.id === target);
      const totalDebit = okItems.reduce(
        (s, i) => s + i.lines.reduce((ls, l) => ls + (l.debitAmount ?? 0), 0), 0,
      );
      return {
        target,
        name: brand?.name ?? target,
        logo: brand ? `/brandlogo/${brand.id.toLowerCase()}-200.png` : null,
        journalBatchName: okItems[0]?.journalBatchName ?? null,
        environment: list[0]?.environment ?? null,
        okItems, badItems, totalDebit,
      };
    });
  }, [items]);

  if (loading && items.length === 0) {
    return <p className="text-[12px] py-4 text-center" style={{ color: "var(--text-muted)" }}>กำลังคำนวณ journal...</p>;
  }
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <div key={s.target} className="rounded-xl overflow-hidden"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          {/* section header */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5"
            style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-card)" }}>
            {s.logo && (
              <img src={s.logo} alt="" className="h-6 w-auto object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
            <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{s.name}</span>
            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>{s.target}</span>
            {s.environment && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                {s.environment === "Sandbox" ? "UAT" : "PROD"}
              </span>
            )}
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Journal {s.journalBatchName ?? "—"} · {s.okItems.length} ใบ
            </span>
            <span className="ml-auto text-[13px] font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>
              {fmtMoney(s.totalDebit)} บาท
            </span>
          </div>

          {/* incomplete-config warnings */}
          {s.badItems.map((b) => (
            <div key={b.id} className="flex items-center gap-2 px-3 py-2 text-[11px]"
              style={{ color: "var(--text-info-yellow)", background: "var(--bg-info-yellow)", borderBottom: "1px solid var(--border-light)" }}>
              <AlertCircle size={13} className="shrink-0" />
              <span className="font-bold shrink-0">{b.requestNo ?? `#${b.id}`}</span>
              <span className="flex-1 min-w-0">{b.error}</span>
              <Link
                href={settingsHrefForError(b.error)}
                className="shrink-0 inline-flex items-center gap-1 font-semibold no-underline px-2 py-1 rounded-lg"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                ไปตั้งค่า <ExternalLink size={11} />
              </Link>
            </div>
          ))}

          {/* journal table */}
          {s.okItems.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] min-w-[980px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}>
                    {JOURNAL_HEADERS.map((h) => (
                      <th key={h} className={`px-2.5 py-1.5 font-semibold whitespace-nowrap ${h === "Amount" || h === "Debit" || h === "Credit" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.okItems.map((it) => it.lines.map((l, i) => (
                    <JournalRow key={`${it.id}-${i}`} line={l} />
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
