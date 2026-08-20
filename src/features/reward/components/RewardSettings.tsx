"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, Lock, Pencil, Plus } from "lucide-react";
import { Button, Switch, Toggle } from "@/components/ui";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { BrandChips } from "@/features/reward/components/BrandChips";
import type { RewardOption } from "@/features/reward/types";

/**
 * The reward catalogue editor (brief §"หน้า Setting Reward", items 1-15).
 *
 * Three of its columns cannot be typed — `Request`, `Expire` and `Balance` are
 * derived from the stock counters and the expiry date — so they are rendered as
 * read-only figures with the lock icon rather than as disabled inputs, which
 * would suggest they are editable under some condition.
 *
 * The same applies to the two total-value columns: they are SQL computed columns
 * (`unit × Qty`), so the editor collects the per-unit figures and shows the
 * totals as a consequence.
 */

interface BrandOption {
  brandCode: string;
  brandName: string;
  brandLogo?: string | null;
}

/** One column of the catalogue table. */
interface Column {
  key: string;
  header: string;
  /** Right-align the header too, so it sits over its digits. */
  numeric?: boolean;
  tdClass?: string;
  tdStyle?: (r: RewardOption) => CSSProperties;
  /**
   * Pin to the right edge while the rest scrolls under it.
   *
   * The edit button is the last column, so with every column showing it sat
   * past the right edge of the viewport: reachable only by scrolling the table
   * all the way across, which read as "there is no edit button". A row's action
   * is not something to go looking for.
   */
  stickyRight?: boolean;
  cell: (r: RewardOption) => ReactNode;
}

/** Shared by the pinned header cell and the pinned body cell. */
const STICKY_RIGHT: CSSProperties = {
  position: "sticky",
  right: 0,
  // Enough to sit over a scrolled cell, not so much that it covers a dialog.
  zIndex: 1,
  // Stands the pinned column off the content sliding beneath it.
  boxShadow: "-8px 0 8px -8px rgba(0, 0, 0, 0.18)",
};

async function fetcher(url: string): Promise<RewardOption[]> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  return json.data as RewardOption[];
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_FORM = {
  id: undefined as number | undefined,
  code: "",
  name: "",
  qty: "",
  unitActualValue: "",
  unitBookValue: "",
  startDate: "",
  expireDate: "",
  poNo: "",
  pinNo: "",
  prepaymentNo: "",
  isActive: true,
};

type FormState = typeof EMPTY_FORM;

function TextField({
  label,
  value,
  onChange,
  type = "text",
  integer = false,
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  /**
   * Whole units only — stock counted in pieces, not a measurement.
   *
   * Deliberately not `type="number"`. That control accepts `1.5`, `1e5`, `-2`
   * and `+`, and changes value on a stray scroll wheel; `Number("1.5")` then
   * posts a decimal that `upsertReward` rejects with `Number.isInteger` — a
   * server round trip and a red toast for something the input should never have
   * accepted. A text input filtered to digits cannot express any of those
   * states, while `inputMode="numeric"` still brings up the numeric keypad on a
   * phone.
   *
   * `maxLength` keeps the value inside `sql.Int` (2,147,483,647); without it a
   * pasted 15-digit number reaches the database as an overflow rather than a
   * validation message.
   */
  integer?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-[11px] block mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
        {required && <span style={{ color: "var(--text-danger)" }}> *</span>}
      </label>
      <input
        type={integer ? "text" : type}
        inputMode={integer ? "numeric" : undefined}
        pattern={integer ? "[0-9]*" : undefined}
        maxLength={integer ? 9 : undefined}
        autoComplete={integer ? "off" : undefined}
        value={value}
        onChange={(e) => onChange(integer ? e.target.value.replace(/[^0-9]/g, "") : e.target.value)}
        className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
        style={{
          background: "var(--bg-subtle)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-card)",
        }}
      />
      {hint && (
        <p className="text-[10.5px] mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** A number the system owns. Shown, never typed. */
function DerivedField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p
        className="text-[11px] mb-1 flex items-center gap-1"
        style={{ color: "var(--text-muted)" }}
      >
        <Lock size={9} />
        {label}
      </p>
      <p
        className="text-[13px] font-bold rounded-lg px-3 py-2"
        style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)" }}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[10.5px] mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function RewardSettings() {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandCode, setBrandCode] = useState("");

  useEffect(() => {
    fetch("/api/request/reward/options/brands")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const list = (json.data ?? []) as BrandOption[];
        setBrands(list);
        if (list.length > 0) setBrandCode((prev) => prev || list[0].brandCode);
      })
      .catch(() => {});
  }, []);

  const { data, error, isLoading, mutate } = useSWR(
    brandCode ? `/api/request/reward/settings/rewards?brand=${encodeURIComponent(brandCode)}` : null,
    fetcher,
  );

  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  /** Reward ids with an isActive PATCH in flight — one spinner per row. */
  const [togglingIds, setTogglingIds] = useState<number[]>([]);

  const editing = useMemo(
    () => (form.id ? (data ?? []).find((r) => r.id === form.id) ?? null : null),
    [form.id, data],
  );

  function openNew() {
    setForm({ ...EMPTY_FORM });
    setPanelOpen(true);
  }

  function openEdit(r: RewardOption) {
    setForm({
      id: r.id,
      code: r.code,
      name: r.name,
      qty: String(r.qty),
      unitActualValue: r.unitActualValue == null ? "" : String(r.unitActualValue),
      unitBookValue: r.unitBookValue == null ? "" : String(r.unitBookValue),
      startDate: r.startDate ?? "",
      expireDate: r.expireDate ?? "",
      poNo: r.poNo ?? "",
      pinNo: r.pinNo ?? "",
      prepaymentNo: r.prepaymentNo ?? "",
      isActive: r.isActive,
    });
    setPanelOpen(true);
  }

  async function save() {
    // Blank is now the starting state, so it has to be rejected here: the field
    // is marked required but `TextField` only draws the asterisk, and
    // `Number("")` is 0 — a reward saved with no stock typed at all, which
    // reads back as a deliberate zero.
    if (form.qty === "") {
      toast.error("กรุณากรอก Qty (จำนวนที่รับเข้า)");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/request/reward/settings/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          brandCode,
          code: form.code,
          name: form.name,
          qty: Number(form.qty),
          unitActualValue: form.unitActualValue === "" ? null : Number(form.unitActualValue),
          unitBookValue: form.unitBookValue === "" ? null : Number(form.unitBookValue),
          startDate: form.startDate || null,
          expireDate: form.expireDate || null,
          poNo: form.poNo || null,
          pinNo: form.pinNo || null,
          prepaymentNo: form.prepaymentNo || null,
          isActive: form.isActive,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        // 409 is the interesting one — a Qty below committed stock, or a
        // duplicate code. The message names the shortfall.
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกแล้ว");
      setPanelOpen(false);
      mutate();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(r: RewardOption) {
    // Two clicks on one row are two PATCHes whose order nobody controls, and
    // the second one lands on a value the first has already flipped. The switch
    // reads this to show a spinner rather than looking inert.
    if (togglingIds.includes(r.id)) return;
    setTogglingIds((ids) => ids.concat(r.id));
    try {
      const res = await fetch("/api/request/reward/settings/rewards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, isActive: !r.isActive }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "เปลี่ยนสถานะไม่สำเร็จ");
        return;
      }
      mutate();
    } catch {
      toast.error("เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setTogglingIds((ids) => ids.filter((id) => id !== r.id));
    }
  }

  const rows = data ?? [];

  /**
   * The catalogue table, by column.
   *
   * Only what a person scans: the two names, the stock numbers, and whether the
   * reward is open. The money, the dates and the document numbers were columns
   * here too — fourteen in all, which pushed the table into a horizontal scroll
   * on any screen narrower than a desktop and left the edit button off the
   * right-hand edge. Every one of them is on the edit panel, which is the only
   * place they can be changed anyway, so the table costs a click and no
   * information.
   *
   * Driving header and body from one array rather than two parallel blocks of
   * JSX is what keeps a hidden column from leaving its header behind — the bug
   * that shape invites every time.
   */
  const COLUMNS: Column[] = [
    { key: "code", header: "Code", tdClass: "font-bold whitespace-nowrap", cell: (r) => r.code },
    {
      key: "name",
      header: "Name",
      tdStyle: () => ({ color: "var(--text-primary)" }),
      cell: (r) => r.name,
    },
    { key: "qty", header: "Qty", numeric: true, tdClass: "text-right tabular-nums", cell: (r) => r.qty },
    {
      key: "request",
      header: "Request",
      numeric: true,
      tdClass: "text-right tabular-nums",
      tdStyle: () => ({ color: "var(--text-muted)" }),
      cell: (r) => r.requestQty,
    },
    {
      key: "balance",
      header: "Balance",
      numeric: true,
      tdClass: "text-right tabular-nums font-extrabold",
      tdStyle: (r) => ({ color: r.balanceQty > 0 ? "var(--text-primary)" : "var(--text-danger)" }),
      cell: (r) => r.balanceQty,
    },
    {
      key: "status",
      header: "สถานะ",
      cell: (r) => (
        <Switch
          checked={r.isActive}
          onChange={() => toggleActive(r)}
          label={`สถานะการใช้งานของ ${r.name}`}
          onText="ใช้งาน"
          offText="ปิด"
          pending={togglingIds.includes(r.id)}
        />
      ),
    },
    {
      key: "edit",
      header: "",
      stickyRight: true,
      cell: (r) => (
        <button
          type="button"
          onClick={() => openEdit(r)}
          className="p-1 rounded-md"
          style={{ color: "var(--text-muted)" }}
          aria-label={`แก้ไข ${r.name}`}
        >
          <Pencil size={14} />
        </button>
      ),
    },
  ];


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BrandChips
          brands={brands}
          isActive={(code) => brandCode === code}
          onSelect={setBrandCode}
          className="flex flex-wrap items-center gap-2 flex-1"
        />
        <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={openNew}>
          เพิ่มของรางวัล
        </Button>
      </div>

      <section
        className="rounded-[14px] overflow-hidden"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
      >
        {isLoading ? (
          <div
            className="p-6 flex items-center gap-2 text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 size={15} className="animate-spin" />
            กำลังโหลด...
          </div>
        ) : error ? (
          <p className="p-6 text-[13px]" style={{ color: "var(--text-danger)" }}>
            {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-[13px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีของรางวัลในบริษัทนี้
          </p>
        ) : (
          <div className="overflow-x-auto acc-scroll-x">
            <table className="w-full min-w-max text-[12.5px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)" }}>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`font-bold px-3 py-2 whitespace-nowrap ${c.numeric ? "text-right" : "text-left"}`}
                      style={{
                        color: "var(--text-secondary)",
                        // The pinned cell needs its own opaque background, or
                        // the columns scrolling underneath show through it.
                        ...(c.stickyRight ? { ...STICKY_RIGHT, background: "var(--bg-subtle)" } : null),
                      }}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                    {COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 ${c.tdClass ?? ""}`}
                        style={{
                          ...(c.tdStyle ? c.tdStyle(r) : null),
                          ...(c.stickyRight ? { ...STICKY_RIGHT, background: "var(--bg-card)" } : null),
                        }}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)}>
        <SidePanelClose onClick={() => setPanelOpen(false)} />
        <div className="p-4 sm:p-5 space-y-4">
          <h2 className="text-[15px] font-extrabold" style={{ color: "var(--text-primary)" }}>
            {form.id ? "แก้ไขของรางวัล" : "เพิ่มของรางวัล"}
          </h2>

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <TextField label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} required />
            <TextField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <TextField
              label="Qty (จำนวนที่รับเข้า)"
              integer
              value={form.qty}
              onChange={(v) => setForm({ ...form, qty: v })}
              required
              hint={
                editing && editing.requestQty > 0
                  ? `ลดต่ำกว่า ${editing.requestQty} ไม่ได้ — มีการล็อก/จ่ายไปแล้ว`
                  : undefined
              }
            />
            <div />

            {editing && (
              <>
                <DerivedField label="Request (ล็อก + จ่ายแล้ว)" value={String(editing.requestQty)} />
                <DerivedField label="Expire" value={String(editing.expiredQty)} />
                <DerivedField
                  label="Balance"
                  value={String(editing.balanceQty)}
                  hint="จำนวนที่ยังขอเบิกได้"
                />
                <div />
              </>
            )}

            <TextField
              label="มูลค่าจริงตาม Reward ต่อหน่วย"
              type="number"
              value={form.unitActualValue}
              onChange={(v) => setForm({ ...form, unitActualValue: v })}
            />
            <DerivedField
              label="มูลค่าจริงตาม Voucher (รวม)"
              value={money(
                form.unitActualValue === "" ? null : Number(form.unitActualValue) * Number(form.qty || 0),
              )}
              hint="คำนวณจาก ต่อหน่วย × Qty"
            />
            <TextField
              label="มูลค่าตามบัญชีต่อหน่วย"
              type="number"
              value={form.unitBookValue}
              onChange={(v) => setForm({ ...form, unitBookValue: v })}
            />
            <DerivedField
              label="มูลค่าตามบัญชี (รวม)"
              value={money(
                form.unitBookValue === "" ? null : Number(form.unitBookValue) * Number(form.qty || 0),
              )}
              hint="คำนวณจาก ต่อหน่วย × Qty"
            />

            <TextField
              label="Start date"
              type="date"
              value={form.startDate}
              onChange={(v) => setForm({ ...form, startDate: v })}
            />
            <TextField
              label="Expire date"
              type="date"
              value={form.expireDate}
              onChange={(v) => setForm({ ...form, expireDate: v })}
            />
            <TextField label="PO No" value={form.poNo} onChange={(v) => setForm({ ...form, poNo: v })} />
            <TextField label="PIN No" value={form.pinNo} onChange={(v) => setForm({ ...form, pinNo: v })} />
            <TextField
              label="Prepayment No"
              value={form.prepaymentNo}
              onChange={(v) => setForm({ ...form, prepaymentNo: v })}
            />
            <div>
              <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
                สถานะ
              </p>
              <Toggle
                checked={form.isActive}
                onChange={(v) => setForm({ ...form, isActive: v })}
                label={form.isActive ? "ใช้งาน" : "ปิด"}
                description="ปิดแล้วของรางวัลนี้จะไม่ขึ้นในหน้าเบิกของทีม OP"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="primary" size="lg" loading={saving} onClick={save}>
              บันทึก
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setPanelOpen(false)}>
              ยกเลิก
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
