"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { useErpInterfaceBrands } from "@/lib/hooks/useErpInterfaceBrands";
import type { AccApproverRow } from "@/features/accounting/types";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { FormOwnerCheckbox } from "@/features/settings/FormOwnerCheckbox";

function codesEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return Array.from(a).sort().join(",") === Array.from(b).sort().join(",");
}

/**
 * Ticks → what is stored. **`null` means UNRESTRICTED** — AP-1's convention,
 * and CLAUDE.md records it as a fail-open that was deliberately left alone:
 * zero rows in `AccApproverInterfaceBrand` reads as every brand.
 *
 * `allIds` is the interface brand list, passed in because it is fetched now
 * rather than a constant of four. **That changes when "all" is reached**, and
 * it is worth stating rather than discovering: with a fifth brand configured,
 * an approver who has four of five ticked stores those four explicitly instead
 * of collapsing to `null`. That is the more faithful record of what an admin
 * ticked, and it is also the safer direction — an explicit four scopes them to
 * four, where `null` would silently widen them to whatever is configured next.
 *
 * **An empty `allIds` cannot reach here in a way that matters.** It is empty
 * only while the list is loading, and every checkbox is rendered from that same
 * list — so there is nothing to tick, `checked` stays as it was initialised,
 * and `persist` is only ever called from a toggle. The `length === 0` guard
 * below is what stops an empty tick set being read as "all" if it ever did.
 */
function toPayload(checked: Set<string>, allIds: readonly string[]): string[] | null {
  const list = Array.from(checked).sort();
  if (list.length === 0) return [];
  if (allIds.length > 0 && list.length === allIds.length) return null;
  return list;
}

function initChecked(codes: string[] | null, allIds: readonly string[]): Set<string> {
  if (codes === null) return new Set(allIds);
  return new Set(codes);
}

function BrandCheckbox({
  checked,
  disabled,
  saving,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const locked = !!disabled || !!saving;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={locked}
      aria-label={ariaLabel}
      disabled={locked}
      onClick={() => {
        if (!locked) onChange();
      }}
      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center mx-auto border-none p-0 transition-all"
      style={{
        background: checked ? "var(--text-info-green)" : "var(--bg-card)",
        boxShadow: checked
          ? "0 0 0 2px color-mix(in srgb, var(--text-info-green) 28%, transparent)"
          : "inset 0 0 0 1.5px var(--border-card)",
        opacity: disabled ? 0.5 : saving ? 0.6 : 1,
        cursor: locked ? "not-allowed" : "pointer",
      }}
    >
      {saving ? (
        <Loader2 size={10} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      ) : checked ? (
        <Check size={11} strokeWidth={3} style={{ color: "var(--bg-card)" }} />
      ) : null}
    </button>
  );
}

function ApproverInterfaceCells({
  approver,
  onSaved,
}: {
  approver: AccApproverRow;
  onSaved: () => void;
}) {
  const { brands: ifaceBrands } = useErpInterfaceBrands();
  const allIds = useMemo(() => ifaceBrands.map((b) => b.id), [ifaceBrands]);
  const [checked, setChecked] = useState<Set<string>>(() => initChecked(approver.interfaceBrandCodes, []));
  const [saving, setSaving] = useState(false);
  const skipSaveRef = useRef(false);

  /* `allIds` is in the dependencies, and it has to be: an unrestricted
     approver (`interfaceBrandCodes === null`) starts with NOTHING ticked
     because the list has not arrived, and every box has to tick itself the
     moment it does. `skipSaveRef` is what stops that re-seed being written
     back as an edit. */
  useEffect(() => {
    skipSaveRef.current = true;
    setChecked(initChecked(approver.interfaceBrandCodes, allIds));
  }, [approver.id, approver.interfaceBrandCodes, allIds]);

  const persist = useCallback(
    async (nextChecked: Set<string>) => {
      const payload = toPayload(nextChecked, allIds);
      if (codesEqual(payload, approver.interfaceBrandCodes)) return;

      setSaving(true);
      try {
        const res = await fetch("/api/request/accounting/settings/approvers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: approver.id,
            email: approver.email,
            interfaceBrandCodes: payload,
          }),
        });
        const json = await res.json();
        if (json.ok) {
          onSaved();
        } else {
          toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        }
      } catch {
        toast.error("บันทึกไม่สำเร็จ");
      } finally {
        setSaving(false);
      }
    },
    [approver.id, approver.email, approver.interfaceBrandCodes, onSaved],
  );

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    void persist(checked);
  }, [checked, persist]);

  const toggleBrand = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <>
      {ifaceBrands.map((iface) => (
        <td key={iface.id} className="px-3 py-2.5 text-center">
          <BrandCheckbox
            checked={checked.has(iface.id)}
            saving={saving}
            onChange={() => toggleBrand(iface.id)}
            ariaLabel={`${approver.displayName ?? approver.email} — ${iface.name}`}
          />
        </td>
      ))}
    </>
  );
}

function ApproverAvatar({ approver }: { approver: AccApproverRow }) {
  if (approver.photoUrl) {
    return (
      <img
        src={approver.photoUrl}
        alt={approver.displayName ?? approver.email}
        className="w-9 h-9 rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
      style={{
        background: approver.isActive ? "var(--nav-active-bg)" : "var(--bg-badge)",
        color: approver.isActive ? "var(--nav-active-text)" : "var(--text-muted)",
      }}
    >
      {(approver.displayName ?? approver.email)
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </div>
  );
}

export function ApproverInterfaceBrandTable({
  approvers,
  savingId,
  onSaved,
  onToggleActive,
}: {
  approvers: AccApproverRow[];
  savingId: number | null;
  onSaved: () => void;
  onToggleActive: (approver: AccApproverRow) => void;
}) {
  // Before the early return below, so the hook order is the same on every
  // render — an empty roster must not skip it.
  const { brands: ifaceBrands } = useErpInterfaceBrands();
  if (approvers.length === 0) {
    return (
      <div
        className="rounded-xl py-10 text-center"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
      >
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          ไม่พบผู้อนุมัติที่ตรงกับการค้นหา
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border-card)" }}
    >
      <p
        className="text-[11px] px-4 py-2.5 m-0"
        style={{ color: "var(--text-muted)", background: "var(--bg-card-alt)" }}
      >
        ติ๊กกลุ่ม Interface ที่มองเห็นในหน้าอนุมัติและรายงาน — บันทึกอัตโนมัติ · ติ๊กครบทุกกลุ่ม = เห็นทั้งหมด
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[860px]">
          <thead>
            <tr style={{ background: "var(--bg-card-header)", borderBottom: "1px solid var(--border-light)" }}>
              <th
                className="text-left px-4 py-2.5 font-semibold whitespace-nowrap min-w-[220px]"
                style={{ color: "var(--text-secondary)" }}
              >
                ผู้อนุมัติ
              </th>
              {ifaceBrands.map((iface) => (
                <th
                  key={iface.id}
                  className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-20"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <img
                    src={`/brandlogo/${iface.id.toLowerCase()}-200.png`}
                    alt={iface.name}
                    className="h-6 w-auto object-contain mx-auto mb-0.5"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="block text-[10px]">{iface.id}</span>
                </th>
              ))}
              {/* Before สถานะ (the user, 2026-09-24). It is not an access
                  right and sits here only because this is where a form's
                  people are managed — see `FormOwnerCheckbox`. */}
              <th
                className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-24"
                style={{ color: "var(--text-secondary)" }}
              >
                เจ้าของฟอร์ม
              </th>
              <th
                className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-24"
                style={{ color: "var(--text-secondary)" }}
              >
                สถานะ
              </th>
              <th
                className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-14"
                style={{ color: "var(--text-secondary)" }}
              >
                {" "}
              </th>
            </tr>
          </thead>
          <tbody>
            {approvers.map((a) => (
              <tr
                key={a.id}
                style={{
                  borderBottom: "1px solid var(--border-light)",
                  opacity: a.isActive ? 1 : 0.55,
                }}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <ApproverAvatar approver={a} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold m-0 truncate" style={{ color: "var(--text-heading)" }}>
                        {a.displayName ?? "—"}
                      </p>
                      <p className="text-[10px] m-0 mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                        {a.staffId ? `รหัส ${a.staffId} · ` : ""}{a.email}
                      </p>
                    </div>
                  </div>
                </td>
                {a.isActive ? (
                  <ApproverInterfaceCells approver={a} onSaved={onSaved} />
                ) : (
                  <td className="px-3 py-2.5 text-center" colSpan={ifaceBrands.length}>
                    <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                      เปิดใช้งานเพื่อกำหนดกลุ่ม Interface
                    </span>
                  </td>
                )}
                {/* Ticked for an inactive row too: an owner is a contact line,
                    not an approval, so switching somebody off as an approver
                    is not a reason to stop telling requesters to ask them. */}
                <td className="px-3 py-2.5 text-center">
                  <FormOwnerCheckbox
                    formCode={AP1_FORM_CODE}
                    email={a.email}
                    displayName={a.displayName}
                    staffId={a.staffId}
                  />
                </td>
                <td className="px-3 py-2.5 text-center">
                  {a.isActive ? (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-lg inline-block"
                      style={{ background: "#e4f4ea", color: "#4fa37a" }}
                    >
                      ใช้งาน
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-lg inline-block"
                      style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}
                    >
                      ปิด
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => onToggleActive(a)}
                    disabled={savingId === a.id}
                    className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none mx-auto"
                    style={{
                      background: a.isActive ? "#fbe7ea" : "#e4f4ea",
                      color: a.isActive ? "#d27f8c" : "#4fa37a",
                      opacity: savingId === a.id ? 0.5 : 1,
                    }}
                    title={a.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  >
                    {a.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
