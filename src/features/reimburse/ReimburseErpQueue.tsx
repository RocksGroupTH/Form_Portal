"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Building2, CheckCircle2, FileX, Info, Loader2, Lock } from "lucide-react";
import { fmtBaht } from "@/features/travel-booking/components/shared";
// Type-only, from the pure policy module rather than `./erp-queue-service` —
// that file imports `getAccPool`, which reaches `@/lib/db/mssql` and `@/env`
// at module scope. `ReimburseApprovalQueue.tsx` makes the identical choice
// against `queue-policy.ts` for the same reason.
import type { ErpReadiness, ReimburseErpQueueRow } from "@/lib/acc/reimburse/erp-queue-policy";

/**
 * AP-4's Interface ERP queue — every APPROVED claim, read-only.
 *
 * **There is no send here, on purpose.** Nothing in this app writes
 * `AccRequest.ErpInterface*` for AP-4 outside a send path, and that send path
 * does not exist yet — the Business Central call arrives with a later change.
 * `CK_AccRequest_ErpInterfaceStatus` admits only `Pending`/`Sent`/`Failed`;
 * there is no value meaning "held pending build-out", so there is nothing a
 * button here could correctly write. A control that cannot succeed is worse
 * than no control — AP-3's `ClrErpInterfaceQueue` is the screen model for the
 * table, the badges and the formatting, but its selection, its send action,
 * its preview modal and its Excel export are deliberately not carried over.
 *
 * **Readiness here is early warning, not something fixable from this screen.**
 * `erpReadiness` (`./erp-queue-policy.ts`) names which line is missing its
 * G/L account, but every row on THIS queue is `Status='Approved'` — past
 * `ACCOUNT_FINAL` by construction, since `belongsInErpQueue` admits nothing
 * else. `ExpenseAccountsPanel`'s save route, `setReimburseItemAccounts`,
 * claims the request with `WHERE … Status='ManagerApproved' AND
 * CurrentStepCode='ACCOUNT'` (`approval-service.ts`) — a predicate no row here
 * can ever satisfy — so the PATCH refuses every one of them with a 409. The
 * window to correct a line's category closes at `ACCOUNT_FINAL`; what this
 * screen shows is the problem surfacing one step too late to act on in-app.
 *
 * **Nothing currently requires a non-null `Category` before `ACCOUNT_FINAL`
 * either** — `approveReimburseAccountCheck`/the final approval check no
 * category at all — so a claim can arrive here unready with no in-app path to
 * correction. The send task this queue is staged for needs one of: a
 * readiness gate that refuses to let `ACCOUNT_FINAL` close a claim with a
 * missing category, or a widened edit window that lets accounting fix a line
 * after `Approved`. Neither exists yet; this comment is the record that the
 * gap was seen, not closed.
 */

interface ApiEnvelope {
  ok: boolean;
  data?: ReimburseErpQueueRow[];
  error?: string;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetcher(url: string): Promise<ReimburseErpQueueRow[]> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => null)) as ApiEnvelope | null;
  if (!json?.ok) {
    throw new ApiError(typeof json?.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ", res.status);
  }
  return json.data ?? [];
}

/** Full date + time, local getters. `th-TH` alone is the Buddhist calendar — see AP-3's own comment on the identical line. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("th-TH-u-ca-gregory", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `raw` is already `YYYY-MM-DD` local-calendar text — parsing through `Date` would reinterpret it as UTC midnight. */
function fmtYmd(raw: string | null): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

function EnvBadge({ env }: { env: string | null }) {
  if (!env) {
    return <span style={{ color: "var(--text-faint)" }}>—</span>;
  }
  const isSandbox = env === "Sandbox";
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-1"
      style={
        isSandbox
          ? {
              background: "color-mix(in srgb, var(--color-warning) 16%, transparent)",
              color: "var(--color-warning)",
              border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
            }
          : {
              background: "color-mix(in srgb, var(--status-bad-text) 14%, transparent)",
              color: "var(--status-bad-text)",
              border: "1px solid color-mix(in srgb, var(--status-bad-text) 30%, transparent)",
            }
      }
    >
      {isSandbox ? "UAT" : "PROD"}
    </span>
  );
}

function ErpStatusBadge({ status, error }: { status: string | null; error: string | null }) {
  if (!status) {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}
      >
        ยังไม่ส่ง
      </span>
    );
  }
  if (status === "Sent") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}
      >
        ส่งแล้ว
      </span>
    );
  }
  if (status === "Pending") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "color-mix(in srgb, var(--color-warning) 14%, transparent)", color: "var(--color-warning)" }}
      >
        กำลังส่ง...
      </span>
    );
  }
  if (status === "Failed") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        title={error ?? undefined}
        style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)" }}
      >
        ล้มเหลว
      </span>
    );
  }
  return <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{status}</span>;
}

function ReadinessCell({ readiness }: { readiness: ErpReadiness }) {
  if (readiness.ready) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}
      >
        <CheckCircle2 size={11} /> พร้อมส่ง
      </span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
        title={readiness.issues.join("; ")}
        style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)" }}
      >
        <AlertTriangle size={11} /> ยังไม่พร้อม
      </span>
      <p className="text-[10.5px] leading-snug m-0" style={{ color: "var(--status-bad-text)" }}>
        {readiness.issues.join(", ")}
      </p>
    </div>
  );
}

export function ReimburseErpQueue() {
  const { data, error, isLoading } = useSWR<ReimburseErpQueueRow[]>(
    "/api/request/reimburse/erp-queue",
    fetcher,
    { refreshInterval: 30_000 },
  );

  const rows = data ?? [];
  const forbidden = error instanceof ApiError && error.status === 403;

  const [brand, setBrand] = useState<string>("__ALL__");

  const brandCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const b = r.brandCode || "—";
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const uniqueBrands = useMemo(() => Object.keys(brandCounts).sort(), [brandCounts]);

  const filteredRows = useMemo(
    () => (brand === "__ALL__" ? rows : rows.filter((r) => (r.brandCode || "—") === brand)),
    [rows, brand],
  );

  return (
    <>
      {/* A refused viewer must not read "the list below is…" above "ไม่มีสิทธิ์เข้าถึง" —
          `ReimburseApprovalQueue` gates its own notice on `!forbidden` for the same reason. */}
      {!forbidden && (
        <div
          className="rounded-xl px-3.5 py-3 mb-4 flex items-start gap-2.5"
          style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <Info size={15} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-yellow)" }} />
          <p className="text-[12.5px] leading-relaxed m-0" style={{ color: "var(--text-info-yellow)" }}>
            รายการด้านล่างคือคำขอเบิกเงินคืนที่อนุมัติครบแล้วและรอส่งเข้า Business Central —
            ระบบยังไม่เปิดใช้งานการส่งจริง ฟังก์ชันส่งข้อมูลจะเปิดใช้งานเมื่อเชื่อมต่อกับ Business Central แล้ว
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Building2 size={15} style={{ color: "var(--text-muted)" }} />
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>แบรนด์:</span>
          <div className="flex gap-1 flex-wrap">
            {[{ id: "__ALL__", label: "ทั้งหมด" }, ...uniqueBrands.map((b) => ({ id: b, label: b }))].map((o) => {
              const active = brand === o.id;
              const count = o.id === "__ALL__" ? rows.length : brandCounts[o.id] ?? 0;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setBrand(o.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg cursor-pointer border transition-colors"
                  style={{
                    background: active ? "var(--nav-active-bg)" : "transparent",
                    color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                    borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                  }}
                >
                  {o.label}
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: active ? "var(--nav-active-text)" : "var(--bg-card-alt)",
                      color: active ? "var(--nav-active-bg)" : "var(--text-faint)",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* No card of its own — the page's shared `rounded-2xl` card (`page.tsx`)
          supplies the border and background, exactly as AP-3's tab bodies rely
          on their page for the same chrome. */}
      {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : forbidden ? (
          <div className="py-16 text-center px-4">
            <Lock size={32} style={{ color: "var(--text-faint)", margin: "0 auto 12px" }} />
            <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
              ไม่มีสิทธิ์เข้าถึง
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              หน้านี้สำหรับผู้ที่ได้รับสิทธิ์ &quot;คิวอนุมัติ (บัญชี)&quot; ของ AP-4 เท่านั้น —
              ผู้ดูแลระบบเพิ่มสิทธิ์ได้ที่ ตั้งค่าขอเบิกเงินคืนพนักงาน → สิทธิ์เข้าถึง
            </p>
          </div>
        ) : error ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--color-danger)" }}>
            {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
          </p>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <FileX size={32} style={{ color: "var(--text-muted)" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {rows.length === 0 ? "ไม่มีรายการที่อนุมัติแล้วรอส่งเข้า ERP" : "ไม่มีรายการตามเงื่อนไข"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto">
            <table className="w-full text-[12px] border-collapse min-w-[1200px]">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}>
                <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                  {["เลขที่", "แบรนด์", "ผู้ยื่น", "วันที่จ่าย", "จำนวนเงิน", "รายการ", "ความพร้อม", "สถานะ ERP", "Doc No (ERP)", "วันที่ส่งเข้า ERP", "Env"].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap text-left" style={{ color: "var(--text-secondary)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";
                  return (
                    <tr
                      key={row.id}
                      className="transition-colors"
                      style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "color-mix(in srgb, var(--nav-active-bg) 20%, var(--bg-card))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = rowBg;
                      }}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold" style={{ color: "var(--nav-active-text)" }}>
                          {row.requestNo || `#${row.id}`}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {row.brandCode || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                        {row.requesterName || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                        {fmtYmd(row.paymentDate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium" style={{ color: "var(--color-action)" }}>
                        {fmtBaht(row.totalAmount)}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {row.itemCount}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <ReadinessCell readiness={row.readiness} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <ErpStatusBadge status={row.erpStatus} error={row.erpError} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]" style={{ color: row.erpDocumentNo ? "var(--text-secondary)" : "var(--text-faint)" }}>
                        {row.erpDocumentNo || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                        {fmtDateTime(row.erpSentAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <EnvBadge env={row.erpEnvironment} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr
                  style={{
                    borderTop: "2px solid var(--border-card)",
                    background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))",
                    boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)",
                  }}
                >
                  <td colSpan={11} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                    รอส่ง {filteredRows.length} รายการ
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
    </>
  );
}
