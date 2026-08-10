"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

export interface ErpDeptOption {
  code: string;
  displayName: string | null;
}

export function ErpDeptFixDialog({
  open,
  onOpenChange,
  targetBrandName,
  targetBrandCode,
  branchCode,
  initialCode,
  departmentOptions,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetBrandName: string;
  targetBrandCode: string;
  branchCode: string;
  initialCode: string;
  departmentOptions: ErpDeptOption[];
  onConfirm: (erpDeptCode: string) => void;
}) {
  const [selected, setSelected] = useState(initialCode);

  useEffect(() => {
    if (!open) return;
    const branch = branchCode.trim().toUpperCase();
    if (initialCode.trim()) {
      setSelected(initialCode.trim());
      return;
    }
    if (branch) {
      for (const opt of departmentOptions) {
        if (opt.code.trim().toUpperCase() === branch) {
          setSelected(opt.code);
          return;
        }
      }
    }
    setSelected("");
  }, [open, initialCode, branchCode, departmentOptions]);

  const selectOptions = useMemo(
    () => departmentOptions.map((o) => ({
      value: o.code,
      label: o.code,
      subLabel: o.displayName ?? undefined,
    })),
    [departmentOptions],
  );

  const branchHint = branchCode.trim();
  const branchInErp = branchHint
    ? departmentOptions.some((o) => o.code.trim().toUpperCase() === branchHint.toUpperCase())
    : false;

  const selectedOpt = useMemo(() => {
    const key = selected.trim().toUpperCase();
    if (!key) return null;
    for (const opt of departmentOptions) {
      if (opt.code.trim().toUpperCase() === key) return opt;
    }
    return null;
  }, [selected, departmentOptions]);

  const handleConfirm = () => {
    const code = selected.trim();
    if (!code) return;
    onConfirm(code);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Fix Dept — ${targetBrandCode}`}
      contentClassName="max-w-lg"
      uniformSurface
    >
      <div className="space-y-4">
        <div
          className="rounded-xl px-3.5 py-3"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
          }}
        >
          <p className="text-[12px] font-semibold m-0" style={{ color: "var(--text-primary)" }}>
            {targetBrandName}
          </p>
          <p className="text-[11px] m-0 mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            เลือกรหัสแผนก ERP ที่ต้องการใช้แทน Dept จาก HR mapping
            {branchHint ? (
              <>
                {" "}
                · Branch{" "}
                <span className="font-mono font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {branchHint}
                </span>
              </>
            ) : null}
          </p>
        </div>

        {branchHint && !branchInErp ? (
          <div
            className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{
              background: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
              color: "var(--color-warning)",
              border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
            }}
          >
            ไม่พบรหัส Branch &quot;{branchHint}&quot; ในรายการ Dept ERP — เลือกรหัสที่ถูกต้องจากรายการด้านล่าง
          </div>
        ) : null}

        {departmentOptions.length === 0 ? (
          <div
            className="rounded-lg px-3 py-2 text-[11px]"
            style={{
              background: "var(--bg-info-yellow)",
              color: "var(--text-info-yellow)",
              border: "1px solid var(--border-info-yellow)",
            }}
          >
            ยังไม่มีรายการ Dept จาก ERP — กด Sync ERP ที่แท็บ Department ก่อน
          </div>
        ) : (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-faint)" }}>
              แผนก ERP (Dept)
            </p>
            <SearchableSelect
              value={selected}
              onChange={setSelected}
              options={selectOptions}
              placeholder="— เลือกรหัส Dept —"
              emptyLabel="— เลือกรหัส Dept —"
              searchPlaceholder="ค้นหารหัส / ชื่อแผนก..."
              triggerBackground="var(--bg-card)"
            />
            {selectedOpt ? (
              <div
                className="mt-2.5 flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                style={{
                  background: "color-mix(in srgb, var(--text-info-green) 10%, var(--bg-card))",
                  border: "1px solid color-mix(in srgb, var(--text-info-green) 28%, transparent)",
                }}
              >
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-green)" }} />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-info-green)" }}>
                    Preview
                  </p>
                  <p className="text-[12px] font-semibold m-0 mt-0.5 font-mono" style={{ color: "var(--text-primary)" }}>
                    {selectedOpt.code}
                  </p>
                  {selectedOpt.displayName ? (
                    <p className="text-[11px] m-0 mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                      {selectedOpt.displayName}
                    </p>
                  ) : null}
                  <p className="text-[10px] m-0 mt-1.5 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                    <GitBranch size={10} className="shrink-0" />
                    Journal จะใช้ Dept นี้แทน HR mapping
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={!selected.trim() || departmentOptions.length === 0}
          >
            ยืนยัน
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
