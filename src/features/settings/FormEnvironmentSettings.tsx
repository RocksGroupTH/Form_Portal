"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Database, Loader2 } from "lucide-react";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type EnvironmentValue = "Production" | "UAT";

interface FormEnvironmentRow {
  formCode: string;
  formNameEn: string;
  formNameTh: string;
  environment: EnvironmentValue;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string | null;
  productionCount: number;
  uatCount: number;
}

interface CoverageRoute {
  route: string;
  classification: string;
}

interface Coverage {
  available: boolean;
  total: number;
  unclassified: CoverageRoute[];
  all: CoverageRoute[];
}

/** Local time, never toISOString — the server runs on Thai time. */
function formatStamp(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function FormEnvironmentSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data: FormEnvironmentRow[]; error?: string }>(
    "/api/settings/form-environment",
    fetcher,
  );
  const { data: coverageRes } = useSWR<{ ok: boolean; data: Coverage; error?: string }>(
    "/api/settings/form-environment/coverage",
    fetcher,
  );

  const [saving, setSaving] = useState<string | null>(null);

  const rows = data?.ok ? data.data ?? [] : [];
  const loadError = data && !data.ok ? data.error ?? "โหลดข้อมูลไม่สำเร็จ" : null;
  const coverage = coverageRes?.ok ? coverageRes.data : null;

  const setEnvironment = async (formCode: string, environment: EnvironmentValue) => {
    setSaving(formCode);
    try {
      const res = await fetch("/api/settings/form-environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formCode, environment }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
      toast.success(`${formCode} → ${environment}`);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Warning: switching does not move existing requests ── */}
      <div
        className="rounded-xl px-4 py-3 flex items-start gap-2.5"
        style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
      >
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <p className="text-[12px] leading-relaxed">
          เปลี่ยนเป็น UAT แล้ว request เดิมที่อยู่ใน Production <b>ไม่ย้ายตาม</b> — ยังอยู่ที่เดิมและเปิดดูได้
          ฟอร์มแค่เริ่มเขียนที่ใหม่ สลับกลับก็เช่นกัน request ที่ทำใน UAT จะค้างอยู่ใน UAT พร้อมป้าย UAT
        </p>
      </div>

      {/* ── Form table ── */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Database size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>
            Forms
          </h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {rows.length} forms
          </span>
        </div>

        {isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : loadError ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-danger)" }}>
            {loadError}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            ไม่พบฟอร์มใน AccFormMaster
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Form</th>
                  <th className="text-right px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Production</th>
                  <th className="text-right px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>UAT</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Environment</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Last changed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.formCode}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                    }}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                        >
                          {row.formCode}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {row.formNameTh || row.formNameEn}
                          </p>
                          {row.formNameTh && row.formNameEn && (
                            <p className="text-[10px] truncate" style={{ color: "var(--text-faint)" }}>
                              {row.formNameEn}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {row.productionCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {row.uatCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div
                        className="inline-flex rounded-lg p-0.5 gap-0.5"
                        style={{ background: "var(--bg-badge)" }}
                      >
                        {(["Production", "UAT"] as EnvironmentValue[]).map((value) => {
                          const active = row.environment === value;
                          const isUat = value === "UAT";
                          return (
                            <button
                              key={value}
                              disabled={saving === row.formCode || active}
                              onClick={() => setEnvironment(row.formCode, value)}
                              className="px-2.5 py-1 rounded-md text-[10px] font-bold border-none disabled:cursor-default enabled:cursor-pointer"
                              style={
                                active
                                  ? isUat
                                    ? { background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }
                                    : { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                                  : { background: "transparent", color: "var(--text-muted)" }
                              }
                            >
                              {value}
                            </button>
                          );
                        })}
                        {saving === row.formCode && (
                          <Loader2 size={12} className="animate-spin self-center mx-1" style={{ color: "var(--text-muted)" }} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {formatStamp(row.updatedAt)}
                      {row.updatedByName && (
                        <span style={{ color: "var(--text-faint)" }}> · {row.updatedByName}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Route coverage ── */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <h2 className="text-[14px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
          Route coverage
        </h2>
        <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
          API route ใต้ <code>/api/request</code> ที่ไม่มีกฎใน <code>ROUTE_RULES</code> จะตกไปที่ Production เสมอ
        </p>

        {!coverageRes ? (
          <div className="py-4 flex justify-center">
            <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : !coverage ? (
          <p className="text-[12px]" style={{ color: "var(--text-danger)" }}>
            {coverageRes.error ?? "ตรวจสอบ route ไม่สำเร็จ"}
          </p>
        ) : !coverage.available ? (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            ตรวจสอบไม่ได้บนเครื่องนี้ — ต้องมีซอร์ส <code>src/app/api/request</code> อยู่บนดิสก์
          </p>
        ) : coverage.unclassified.length === 0 ? (
          <div
            className="rounded-lg px-3 py-2 flex items-center gap-2 text-[12px]"
            style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }}
          >
            <CheckCircle2 size={14} />
            ครบทั้ง {coverage.total} routes — ไม่มี route ที่ยังไม่ถูกจัดประเภท
          </div>
        ) : (
          <div
            className="rounded-lg px-3 py-2.5 text-[12px]"
            style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
          >
            <div className="flex items-center gap-2 font-bold mb-1.5">
              <AlertTriangle size={14} />
              {coverage.unclassified.length} จาก {coverage.total} routes ยังไม่ถูกจัดประเภท
            </div>
            <ul className="flex flex-col gap-0.5 font-mono text-[11px]">
              {coverage.unclassified.map((r) => (
                <li key={r.route}>{r.route}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
