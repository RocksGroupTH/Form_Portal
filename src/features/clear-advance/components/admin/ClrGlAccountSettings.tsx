"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";
import { useBrand } from "@/components/BrandProvider";
import {
  fetchList,
  postJson,
  ForbiddenState,
  LoadingRow,
  EmptyRow,
} from "./shared";

interface ErpGlOption { accountNo: string; displayName: string | null }

type DimensionType = "Employee" | "Branch" | "Both";
const DIMENSIONS: DimensionType[] = ["Employee", "Branch", "Both"];
const DIM_LABEL: Record<DimensionType, string> = {
  Employee: "พนักงาน (Employee)",
  Branch: "สาขา (Branch)",
  Both: "ทั้งสอง (Both)",
};
const DIM_COLOR: Record<DimensionType, string> = {
  Employee: "#3b82f6",
  Branch: "#8b5cf6",
  Both: "#0ea5a4",
};

interface GlAccountRow {
  id: number;
  glAccountNo: string;
  nameTh: string | null;
  nameEn: string | null;
  dimensionType: DimensionType;
  isActive: boolean;
  sortOrder: number;
}

const GL_URL = "/api/request/clear-advance/settings/gl-accounts";

/** Add-account dialog (glAccountNo, nameTh, nameEn, dimensionType). */
function AddGlDialog({
  busy,
  onClose,
  onAdd,
}: {
  busy: boolean;
  onClose: () => void;
  onAdd: (input: {
    glAccountNo: string;
    nameTh: string;
    nameEn: string;
    dimensionType: DimensionType;
  }) => void | Promise<void>;
}) {
  const [glAccountNo, setGlAccountNo] = useState("");
  const [nameTh, setNameTh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [dimensionType, setDimensionType] = useState<DimensionType>("Employee");

  // GL accounts pulled from Rocks_ERP_Data.dbo.ErpAccounts for the CURRENT brand
  // (the header/env brand context) — no per-dialog brand picker needed.
  const { brand } = useBrand();
  const [glOptions, setGlOptions] = useState<ErpGlOption[]>([]);
  const [glLoading, setGlLoading] = useState(false);

  useEffect(() => {
    if (!brand) { setGlOptions([]); return; }
    let cancelled = false;
    setGlLoading(true);
    fetch(`/api/request/clear-advance/settings/erp-gl-accounts?brand=${encodeURIComponent(brand)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ok) setGlOptions(j.data ?? []); })
      .catch(() => { if (!cancelled) setGlOptions([]); })
      .finally(() => { if (!cancelled) setGlLoading(false); });
    return () => { cancelled = true; };
  }, [brand]);
  const glSelectOptions = useMemo(
    () => glOptions.map((o) => ({ value: o.accountNo, label: o.accountNo, subLabel: o.displayName ?? undefined })),
    [glOptions],
  );

  const inputStyle = {
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-input)",
  } as const;

  async function submit() {
    if (!glAccountNo.trim()) {
      toast.error("กรุณากรอกเลขที่บัญชี G/L");
      return;
    }
    await onAdd({
      glAccountNo: glAccountNo.trim(),
      nameTh: nameTh.trim(),
      nameEn: nameEn.trim(),
      dimensionType,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--overlay-bg)" }}
    >
      <div
        className="rounded-2xl w-[480px] max-w-[95vw] overflow-hidden"
        style={{
          background: "var(--bg-card)",
          boxShadow: "var(--shadow-modal)",
          border: "1px solid var(--border-card)",
        }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>
              เพิ่มหมวดบัญชี G/L
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              AP-3.2 · หมวดบัญชีสำหรับเคลียร์เงินทดรอง
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
              เลขที่บัญชี G/L *
              {brand && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                  ผังบัญชี {brand}
                </span>
              )}
            </label>
            <SearchableSelect
              value={glAccountNo}
              onChange={(v) => {
                setGlAccountNo(v);
                const opt = glOptions.find((o) => o.accountNo === v);
                if (opt?.displayName && !nameTh.trim()) setNameTh(opt.displayName);
              }}
              options={glSelectOptions}
              disabled={!brand || glLoading}
              placeholder={!brand ? "ยังไม่ได้เลือกแบรนด์ที่ header" : glLoading ? "กำลังโหลดบัญชี..." : "ค้นหา/เลือกเลขที่บัญชี G/L"}
              emptyLabel="— เลือก —"
            />
            {brand && !glLoading && glOptions.length === 0 && (
              <span className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
                ไม่พบผังบัญชีของแบรนด์ {brand} ใน ERP (sync ErpAccounts ก่อน)
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              ชื่อบัญชี (ไทย)
            </label>
            <input
              value={nameTh}
              onChange={(e) => setNameTh(e.target.value)}
              placeholder="ชื่อภาษาไทย"
              className="text-[13px] px-3 py-2 rounded-lg outline-none"
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              ชื่อบัญชี (อังกฤษ)
            </label>
            <input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="English name"
              className="text-[13px] px-3 py-2 rounded-lg outline-none"
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              ประเภท Dimension
            </label>
            <select
              value={dimensionType}
              onChange={(e) => setDimensionType(e.target.value as DimensionType)}
              className="text-[13px] px-3 py-2 rounded-lg outline-none"
              style={inputStyle}
            >
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {DIM_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="px-5 py-4 flex items-center justify-end gap-2"
          style={{ borderTop: "1px solid var(--border-card)" }}
        >
          <button
            onClick={onClose}
            className="text-[12px] font-medium px-4 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
          >
            ยกเลิก
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="text-[12px] font-bold px-4 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }}
          >
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClrGlAccountSettings() {
  const [rows, setRows] = useState<GlAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, forbidden } = await fetchList<GlAccountRow>(GL_URL);
    setForbidden(forbidden);
    setRows(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function toggleActive(row: GlAccountRow, isActive: boolean) {
    setBusy(true);
    try {
      await postJson(GL_URL, {
        id: row.id,
        glAccountNo: row.glAccountNo,
        nameTh: row.nameTh,
        nameEn: row.nameEn,
        dimensionType: row.dimensionType,
        isActive,
        sortOrder: row.sortOrder,
      });
      toast.success(isActive ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function add(input: {
    glAccountNo: string;
    nameTh: string;
    nameEn: string;
    dimensionType: DimensionType;
  }) {
    setBusy(true);
    try {
      await postJson(GL_URL, {
        glAccountNo: input.glAccountNo,
        nameTh: input.nameTh || null,
        nameEn: input.nameEn || null,
        dimensionType: input.dimensionType,
      });
      toast.success("เพิ่มหมวดบัญชีแล้ว");
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.glAccountNo.toLowerCase().includes(q) ||
        (r.nameTh ?? "").toLowerCase().includes(q) ||
        (r.nameEn ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows]);

  if (forbidden) return <ForbiddenState />;
  if (loading) return <LoadingRow />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          หมวดบัญชี G/L (AP-3.2)
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          รายการบัญชีแยกประเภทที่เลือกได้ตอนเคลียร์เงินทดรอง · ปิด/เปิดใช้งานหรือเพิ่มหมวดใหม่ได้
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-faint)" }}>
          {activeCount} หมวดที่ใช้งานอยู่ / {rows.length} หมวดทั้งหมด
        </p>
      </div>

      {/* Toolbar: search + add */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเลขบัญชี / ชื่อ..."
            className="flex-1 text-[13px] outline-none bg-transparent"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none shrink-0"
          style={{ background: "var(--color-action)", color: "#fff" }}
        >
          <Plus size={13} /> เพิ่มหมวดบัญชี
        </button>
      </div>

      {/* Table */}
      <div
        className="rounded-xl overflow-x-auto"
        style={{ border: "1px solid var(--border-card)" }}
      >
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ background: "var(--bg-badge)" }}>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                เลขที่บัญชี
              </th>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                ชื่อ (ไทย)
              </th>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                ชื่อ (อังกฤษ)
              </th>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                Dimension
              </th>
              <th className="text-center font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                ใช้งาน
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyRow label="— ไม่พบหมวดบัญชี —" />
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: "1px solid var(--border-card)",
                    opacity: r.isActive ? 1 : 0.55,
                  }}
                >
                  <td
                    className="px-3 py-2.5 font-bold whitespace-nowrap"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {r.glAccountNo}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-primary)" }}>
                    {r.nameTh ?? "—"}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {r.nameEn ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge
                      label={DIM_LABEL[r.dimensionType]}
                      color={DIM_COLOR[r.dimensionType]}
                      small
                    />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      disabled={busy}
                      onChange={(e) => toggleActive(r, e.target.checked)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialogOpen && (
        <AddGlDialog busy={busy} onClose={() => setDialogOpen(false)} onAdd={add} />
      )}
    </div>
  );
}
