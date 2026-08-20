"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Typed, not clicked: turning Production off hides a live form from general users. */
const CONFIRM_WORD = "Confirm";

type SwitchField = "production" | "uat";

interface FormEnvironmentRow {
  formCode: string;
  formNameEn: string;
  formNameTh: string;
  productionEnabled: boolean;
  uatEnabled: boolean;
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

/** "Production" / "UAT" — the label a switch shows and the toast names. */
function fieldLabel(field: SwitchField): string {
  return field === "production" ? "Production" : "UAT";
}

/** เปิด / ปิด — the direction a switch is moving. */
function directionLabel(next: boolean): string {
  return next ? "เปิด" : "ปิด";
}

/** The one transition that hides a live form from general users — gated by typed Confirm. */
function isProductionOff(field: SwitchField, next: boolean): boolean {
  return field === "production" && !next;
}

/** What this specific transition does — shown in the confirmation dialog body. */
function transitionDescription(field: SwitchField, next: boolean): ReactNode {
  if (field === "production") {
    return next ? (
      <>
        ผู้ใช้ทั่วไปจะเห็นและใช้งานฟอร์มนี้ได้ตามปกติ บนฐาน <b>Production</b>
      </>
    ) : (
      <>
        ฟอร์มนี้จะถูก<b>ซ่อนจากผู้ใช้ทั่วไปทั้งหมดทันที</b> จนกว่าจะเปิดกลับ — สวิตช์ UAT ไม่เกี่ยวข้องและไม่เปลี่ยนตาม
      </>
    );
  }
  return next ? (
    <>
      ผู้ทดสอบที่เปิดโหมด UAT ของตัวเองจะใช้งานฟอร์มนี้ได้ คำขอที่สร้างจะถูกเขียนลงฐาน <b>UAT</b> และสมุดรายวัน
      จะถูกส่งเข้า Business Central <b>Sandbox</b> — ผู้ใช้ทั่วไปบน Production ไม่ได้รับผลกระทบ
    </>
  ) : (
    <>
      ผู้ทดสอบในโหมด UAT จะ<b>ใช้งานฟอร์มนี้ไม่ได้อีกต่อไป</b> ผู้ใช้ทั่วไปบน Production ไม่ได้รับผลกระทบ และคำขอ
      เดิมใน UAT ยังอยู่เหมือนเดิม
    </>
  );
}

/**
 * One form's Production or UAT switch: a track with a knob that slides, the
 * label beside it, and the Thai word for the state it is in.
 *
 * It replaced a dot-and-word pill that carried its state in fill colour alone.
 * On a table of them that read as a row of status labels rather than controls,
 * and its off state — a neutral grey — looked like a disabled button rather
 * than a switch that is off. Hiding a live form from every user is not
 * something to do by accident, so the state is now said three ways: knob
 * position, `เปิด`/`ปิด`, and colour. A reader who cannot separate the green
 * from the red from the grey still gets the first two.
 *
 * `ui/Toggle` is not reused: it is a full-width settings row with a 42px track,
 * far too large for two switches in one 11px table cell, and it flips on click
 * where this one must open the confirmation dialog instead. `aria-checked`
 * therefore reports the saved state, which does not change until the dialog is
 * confirmed — that is the honest reading of "is this form on right now".
 */
function EnvironmentSwitch({
  label,
  on,
  onBg,
  onText,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  onBg: string;
  onText: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="ui-switch inline-flex items-center gap-1.5 py-1 pl-1 pr-2.5 rounded-full text-[10px] whitespace-nowrap border-none transition-colors disabled:cursor-default disabled:opacity-60 enabled:cursor-pointer"
      style={{ background: on ? onBg : "var(--bg-badge)", color: on ? onText : "var(--text-muted)" }}
    >
      {/* Track and knob are both currentColor, so they stay legible against
          whichever of the three token pairs the caller passed without naming a
          fourth colour that would have to be checked in two themes. */}
      <span
        aria-hidden
        className="relative inline-block shrink-0 rounded-full"
        style={{ width: 24, height: 14, background: "color-mix(in srgb, currentColor 25%, transparent)" }}
      >
        <span
          className="absolute rounded-full transition-transform"
          style={{
            width: 10,
            height: 10,
            top: 2,
            left: 2,
            background: "currentColor",
            transform: on ? "translateX(10px)" : "translateX(0)",
          }}
        />
      </span>
      <span className="font-bold">{label}</span>
      <span className="font-medium">{on ? "เปิด" : "ปิด"}</span>
    </button>
  );
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
  /** The switch waits here until confirmed — typed, for Production off; clicked, otherwise. */
  const [pending, setPending] = useState<{ row: FormEnvironmentRow; field: SwitchField; next: boolean } | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState("");

  const rows = data?.ok ? data.data ?? [] : [];
  const loadError = data && !data.ok ? data.error ?? "โหลดข้อมูลไม่สำเร็จ" : null;
  const coverage = coverageRes?.ok ? coverageRes.data : null;

  const setFlag = async (formCode: string, field: SwitchField, next: boolean) => {
    setSaving(formCode);
    try {
      const res = await fetch("/api/settings/form-environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formCode, field, value: next }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
      toast.success(`${formCode} · ${fieldLabel(field)} ${directionLabel(next)}`);
      setPending(null);
      setConfirmText("");
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Info: what the two switches do ── */}
      <div
        className="rounded-xl px-4 py-3 flex items-start gap-2.5"
        style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
      >
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <p className="text-[12px] leading-relaxed">
          Production และ UAT ของแต่ละฟอร์ม<b>เปิด/ปิดแยกจากกัน</b> — Production คือฟอร์มที่ผู้ใช้ทั่วไปเห็นและใช้งาน
          ได้ ส่วน UAT คือฟอร์มที่ผู้ทดสอบซึ่งเปิดโหมด UAT ของตัวเองใช้งานได้เท่านั้น ไม่ว่าจะสลับสวิตช์ไหน{" "}
          <b>คำขอเดิมจะไม่ถูกย้ายฐานข้อมูล</b> — มีเพียงคำขอใหม่ของผู้ทดสอบในโหมด UAT เท่านั้นที่จะถูกเขียนลงฐาน UAT
          และส่งสมุดรายวันเข้า Business Central <b>Sandbox</b> แทน Production ส่วนการปิด Production จะ
          <b>ซ่อนฟอร์มนี้จากผู้ใช้ทั่วไปทันที</b> — สวิตช์ UAT ไม่เกี่ยวข้องและไม่เปลี่ยนตาม ผู้ทดสอบในโหมด UAT
          ยังใช้งานได้ตามปกติถ้า UAT ยังเปิดอยู่
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
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Switches</th>
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
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <EnvironmentSwitch
                          label="Production"
                          on={row.productionEnabled}
                          onBg="var(--status-ok-bg)"
                          onText="var(--status-ok-text)"
                          disabled={saving === row.formCode}
                          onClick={() => {
                            setConfirmText("");
                            setPending({ row, field: "production", next: !row.productionEnabled });
                          }}
                        />
                        <EnvironmentSwitch
                          label="UAT"
                          on={row.uatEnabled}
                          onBg="var(--status-bad-bg)"
                          onText="var(--status-bad-text)"
                          disabled={saving === row.formCode}
                          onClick={() => {
                            setConfirmText("");
                            setPending({ row, field: "uat", next: !row.uatEnabled });
                          }}
                        />
                        {saving === row.formCode && (
                          <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />
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

      {/* ── Confirmation: Production off is typed, everything else is a plain confirm ── */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending
            ? `${directionLabel(pending.next)} ${fieldLabel(pending.field)} — ${pending.row.formCode}`
            : ""
        }
        contentClassName="max-w-md"
      >
        {pending && (
          <div className="px-5 pb-5 pt-1 flex flex-col gap-3">
            <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-secondary)" }}>
              <b>{pending.row.formCode}</b> · {pending.row.formNameTh || pending.row.formNameEn}
              {" — "}
              {transitionDescription(pending.field, pending.next)}
            </p>
            <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
              คำขอเดิม {pending.row.productionCount.toLocaleString()} รายการใน Production และ{" "}
              {pending.row.uatCount.toLocaleString()} รายการใน UAT
            </p>

            {isProductionOff(pending.field, pending.next) ? (
              <>
                <label className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                  พิมพ์ <code className="font-bold">Confirm</code> เพื่อยืนยัน
                  <input
                    autoFocus
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && confirmText.trim() === CONFIRM_WORD) {
                        void setFlag(pending.row.formCode, pending.field, pending.next);
                      }
                    }}
                    placeholder={CONFIRM_WORD}
                    className="mt-1.5 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                    style={{
                      background: "var(--bg-input)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-input)",
                    }}
                  />
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setPending(null)}
                    className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none"
                    style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    disabled={confirmText.trim() !== CONFIRM_WORD || saving === pending.row.formCode}
                    onClick={() => void setFlag(pending.row.formCode, pending.field, pending.next)}
                    className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold border-none text-white disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
                    style={{ background: "var(--color-danger)" }}
                  >
                    {saving === pending.row.formCode ? "กำลังปิด..." : "ปิด Production"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setPending(null)}
                  className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                >
                  ยกเลิก
                </button>
                <button
                  disabled={saving === pending.row.formCode}
                  onClick={() => void setFlag(pending.row.formCode, pending.field, pending.next)}
                  className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold border-none text-white disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
                  style={{ background: "var(--color-action)" }}
                >
                  {saving === pending.row.formCode
                    ? "กำลังบันทึก..."
                    : `${directionLabel(pending.next)} ${fieldLabel(pending.field)}`}
                </button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
