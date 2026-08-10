"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { SettingsFilterBar } from "@/features/accounting/components/settings/SettingsFilterBar";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";
import { erpDescriptionFromGlOption } from "@/lib/acc/erp-description";
import {
  deptInitials,
  erpLabel,
  isBrandMapDirty,
  mappingsToErpMap,
  mappingsToGlDescMap,
  mappingsToGlMap,
  type DepartmentMappingPageData,
  type MapFilter,
  type ErpOption,
  type TargetGroup,
} from "@/features/accounting/components/settings/department-mapping-shared";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface DepartmentMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetBrandCode: string | null;
  /** When set (Dept = Branch flow), pre-fills search and shows guidance banner. */
  branchCode?: string | null;
  claimBrandCode?: string | null;
  initialMapFilter?: MapFilter;
  onSaved?: () => void;
}

export function DepartmentMappingDialog({
  open,
  onOpenChange,
  targetBrandCode,
  branchCode,
  claimBrandCode,
  initialMapFilter = "all",
  onSaved,
}: DepartmentMappingDialogProps) {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data?: DepartmentMappingPageData; error?: string }>(
    open ? "/api/request/accounting/settings/departments" : null,
    fetcher,
  );

  const groups = useMemo(() => data?.data?.groups ?? [], [data?.data?.groups]);
  const editGroup = targetBrandCode
    ? groups.find((g) => g.targetBrandCode === targetBrandCode.toUpperCase())
    : undefined;

  const [erpByCode, setErpByCode] = useState<Record<string, string>>({});
  const [savedErpByCode, setSavedErpByCode] = useState<Record<string, string>>({});
  const [glByCode, setGlByCode] = useState<Record<string, string>>({});
  const [savedGlByCode, setSavedGlByCode] = useState<Record<string, string>>({});
  const [glDescByCode, setGlDescByCode] = useState<Record<string, string>>({});
  const [savedGlDescByCode, setSavedGlDescByCode] = useState<Record<string, string>>({});
  const [hydratedTarget, setHydratedTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [mapFilter, setMapFilter] = useState<MapFilter>(initialMapFilter);

  useEffect(() => {
    if (!open) {
      setHydratedTarget(null);
      setSearch("");
      setMapFilter(initialMapFilter);
      return;
    }
    if (branchCode?.trim()) {
      setSearch(branchCode.trim());
    }
    setMapFilter(initialMapFilter);
  }, [open, branchCode, initialMapFilter]);

  useEffect(() => {
    if (!open || !editGroup) return;
    if (hydratedTarget === editGroup.targetBrandCode) return;
    const map = mappingsToErpMap(editGroup.mappings);
    setErpByCode({ ...map });
    setSavedErpByCode({ ...map });
    const glMap = mappingsToGlMap(editGroup.mappings);
    setGlByCode({ ...glMap });
    setSavedGlByCode({ ...glMap });
    const glDescMap = mappingsToGlDescMap(editGroup.mappings);
    setGlDescByCode({ ...glDescMap });
    setSavedGlDescByCode({ ...glDescMap });
    setHydratedTarget(editGroup.targetBrandCode);
  }, [open, editGroup, hydratedTarget]);

  const codes = useMemo(
    () => editGroup?.mappings.map((m) => m.departmentCode) ?? [],
    [editGroup],
  );

  const editIsDirty = editGroup
    ? isBrandMapDirty(erpByCode, savedErpByCode, codes)
      || isBrandMapDirty(glByCode, savedGlByCode, codes)
      || isBrandMapDirty(glDescByCode, savedGlDescByCode, codes)
    : false;

  const glSelectOptions = useMemo(
    () => (editGroup?.glOptions ?? []).map((g) => ({
      value: g.accountNo,
      label: g.accountNo,
      subLabel: g.displayName?.trim() || undefined,
    })),
    [editGroup],
  );

  const editMappedCount = editGroup
    ? editGroup.mappings.filter((m) => (savedErpByCode[m.departmentCode]?.trim() ?? "") !== "").length
    : 0;

  const erpOptionByCode = useMemo(() => {
    const map = new Map<string, ErpOption>();
    if (!editGroup) return map;
    for (const o of editGroup.erpOptions) {
      map.set(o.code, o);
    }
    return map;
  }, [editGroup]);

  const branchHint = branchCode?.trim() ?? "";
  const branchExistsInErp = branchHint && editGroup
    ? editGroup.erpOptions.some((o) => o.code.trim().toUpperCase() === branchHint.toUpperCase())
    : false;

  const filteredMappings = useMemo(() => {
    if (!editGroup) return [];
    const q = search.trim().toLowerCase();

    return editGroup.mappings.filter((m) => {
      const erpCode = erpByCode[m.departmentCode]?.trim() ?? "";
      const erpOpt = erpCode ? erpOptionByCode.get(erpCode) : null;
      const isMapped = Boolean(erpCode);

      if (mapFilter === "mapped" && !isMapped) return false;
      if (mapFilter === "unmapped" && isMapped) return false;

      if (!q) return true;

      const haystack = [
        m.departmentName,
        m.departmentCode,
        erpCode,
        erpOpt?.displayName,
        erpOpt ? erpLabel(erpOpt) : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [editGroup, search, mapFilter, erpByCode, erpOptionByCode]);

  const saveTargetMappings = useCallback(async (group: TargetGroup): Promise<boolean> => {
    const code = group.targetBrandCode;
    const draft = erpByCode;
    const saved = savedErpByCode;
    const draftGl = glByCode;
    const savedGl = savedGlByCode;
    const draftGlDesc = glDescByCode;
    const savedGlDesc = savedGlDescByCode;
    const ids = group.mappings.map((m) => m.departmentCode);

    const dirty = isBrandMapDirty(draft, saved, ids)
      || isBrandMapDirty(draftGl, savedGl, ids)
      || isBrandMapDirty(draftGlDesc, savedGlDesc, ids);
    if (!dirty) return true;

    setSaving(true);
    try {
      const changedItems = group.mappings
        .filter((m) => {
          const id = m.departmentCode;
          return (draft[id]?.trim() ?? "") !== (saved[id]?.trim() ?? "")
            || (draftGl[id]?.trim() ?? "") !== (savedGl[id]?.trim() ?? "")
            || (draftGlDesc[id]?.trim() ?? "") !== (savedGlDesc[id]?.trim() ?? "");
        })
        .map((m) => ({
          departmentCode: m.departmentCode,
          departmentName: m.departmentName,
          erpCode: draft[m.departmentCode]?.trim() || null,
          erpDimensionCode: group.dimensionCode,
          fixedGlAccountNo: draftGl[m.departmentCode]?.trim() || null,
          fixedGlDescription: draftGlDesc[m.departmentCode]?.trim() || null,
        }));

      const res = await fetch("/api/request/accounting/settings/departments/map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBrandCode: code,
          legacyClaimCodes: group.claimBrands.map((c) => c.claimBrandCode),
          mappings: changedItems,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? `บันทึก ${code} ไม่สำเร็จ`);
        return false;
      }

      setSavedErpByCode({ ...draft });
      setSavedGlByCode({ ...draftGl });
      setSavedGlDescByCode({ ...draftGlDesc });
      toast.success(`บันทึก ${code} แล้ว`);
      await mutate();
      onSaved?.();
      return true;
    } catch {
      toast.error(`บันทึก ${code} ไม่สำเร็จ`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [erpByCode, savedErpByCode, glByCode, savedGlByCode, glDescByCode, savedGlDescByCode, mutate, onSaved]);

  const handleClose = async () => {
    if (!editGroup) {
      onOpenChange(false);
      return;
    }
    if (editIsDirty) {
      const ok = await saveTargetMappings(editGroup);
      if (!ok) return;
    }
    onOpenChange(false);
  };

  const title = editGroup
    ? `${editGroup.targetBrandName ?? editGroup.targetBrandCode} — Map แผนก`
    : "Map แผนก HR ↔ ERP";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void handleClose();
        else onOpenChange(true);
      }}
      title={title}
      contentClassName="max-w-3xl max-h-[90vh]"
      scrollable={false}
      uniformSurface
      hideTitle
    >
      <div className="flex flex-col min-h-0 max-h-[90vh]">
        {isLoading || !editGroup ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
              {isLoading ? "กำลังโหลด..." : "ไม่พบกลุ่มแบรนด์ปลายทาง"}
            </p>
          </div>
        ) : (
          <>
            <div
              className="shrink-0 px-6 pt-6 pb-4 pr-14"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              <div className="flex items-start gap-3">
                {editGroup.targetBrandLogo && (
                  <img
                    src={editGroup.targetBrandLogo}
                    alt=""
                    className="h-10 w-auto object-contain shrink-0 mt-0.5"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-bold m-0 leading-snug" style={{ color: "var(--text-heading)" }}>
                    {editGroup.targetBrandName ?? editGroup.targetBrandCode} — Map แผนก HR ↔ ERP
                  </p>
                  <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
                    Dimension {editGroup.dimensionCode}
                    <span className="mx-1.5" style={{ color: "var(--text-faint)" }}>·</span>
                    {editGroup.totalCount} แผนก
                    <span className="mx-1.5" style={{ color: "var(--text-faint)" }}>·</span>
                    map แล้ว {editMappedCount}/{editGroup.totalCount}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <span className="text-[10px] font-semibold uppercase shrink-0" style={{ color: "var(--text-faint)" }}>
                      แบรนด์เบิก
                    </span>
                    {editGroup.claimBrands.map((claim) => (
                      <span
                        key={claim.claimBrandCode}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{
                          background: claimBrandCode?.toUpperCase() === claim.claimBrandCode.toUpperCase()
                            ? "var(--nav-active-bg)"
                            : "var(--bg-card-alt)",
                          border: "1px solid var(--border-light)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {claim.brandLogo && (
                          <img
                            src={claim.brandLogo}
                            alt=""
                            className="h-3.5 w-auto object-contain shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                        {claim.brandName}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 px-6 pt-3 pb-1">
              {branchHint ? (
                <div
                  className="rounded-lg px-3 py-2 mb-2 text-[11px]"
                  style={{
                    background: branchExistsInErp
                      ? "var(--bg-info-green)"
                      : "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                    color: branchExistsInErp ? "var(--text-info-green)" : "var(--color-danger)",
                    border: `1px solid ${branchExistsInErp ? "var(--border-info-green)" : "color-mix(in srgb, var(--color-danger) 30%, transparent)"}`,
                  }}
                >
                  {branchExistsInErp
                    ? `ปรับ Dept เป็น Branch (${branchHint}) — map แผนก HR ให้ชี้ไปที่รหัส ERP "${branchHint}" ตามต้องการ`
                    : `ไม่พบแผนก ERP รหัส "${branchHint}" — Sync ERP หรือสร้าง Dept ใน BC ก่อน แล้ว map แผนก HR ให้ตรง`}
                </div>
              ) : null}

              {!editGroup.bcConfigReady && (
                <div
                  className="rounded-lg px-3 py-2 mb-2 text-[11px]"
                  style={{
                    background: "var(--bg-info-yellow)",
                    color: "var(--text-info-yellow)",
                    border: "1px solid var(--border-info-yellow)",
                  }}
                >
                  ต้องตั้งค่า {editGroup.targetBrandCode} + BC Connection ใน Brand Config ก่อน Sync ข้อมูล ERP
                </div>
              )}

              {editGroup.erpOptions.length === 0 && (
                <div
                  className="rounded-lg px-3 py-2 mb-2 text-[11px]"
                  style={{
                    background: "var(--bg-info-yellow)",
                    color: "var(--text-info-yellow)",
                    border: "1px solid var(--border-info-yellow)",
                  }}
                >
                  กด Sync ERP ที่แท็บ Department เพื่อดึงรายการแผนกจาก {editGroup.targetBrandCode}
                </div>
              )}

              {editGroup.totalCount > 0 && (
                <SettingsFilterBar
                  search={search}
                  onSearch={setSearch}
                  placeholder="ค้นหาแผนก HR / รหัส / แผนก ERP..."
                  groups={[
                    {
                      value: mapFilter,
                      onChange: (v) => setMapFilter(v as MapFilter),
                      options: [
                        { value: "all", label: "ทั้งหมด" },
                        { value: "mapped", label: "Map แล้ว" },
                        { value: "unmapped", label: "ยังไม่ map" },
                      ],
                    },
                  ]}
                />
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto dialog-scroll px-6">
              {editGroup.totalCount === 0 ? (
                <div className="rounded-xl py-10 text-center" style={{ background: "var(--bg-card-alt)" }}>
                  <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>ไม่พบแผนกใน HR</p>
                </div>
              ) : filteredMappings.length === 0 ? (
                <div className="rounded-xl py-10 text-center" style={{ background: "var(--bg-card-alt)" }}>
                  <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>ไม่พบรายการที่ตรงกับการค้นหา</p>
                </div>
              ) : (
                <>
                  <div
                    className="hidden sm:grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] gap-3 px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: "var(--text-faint)" }}
                  >
                    <span>แผนก HR</span>
                    <span />
                    <span>แผนก ERP</span>
                  </div>
                  <div className="flex flex-col gap-1.5 pb-2">
                    {filteredMappings.map((m) => {
                      const erpCode = erpByCode[m.departmentCode]?.trim() ?? "";
                      const savedCode = savedErpByCode[m.departmentCode]?.trim() ?? "";
                      const isDirty = erpCode !== savedCode;
                      const isSavedMapped = Boolean(savedCode) && !isDirty;
                      const matchesBranchHint = branchHint
                        && erpCode.toUpperCase() === branchHint.toUpperCase();
                      const selectDisabled = saving || editGroup.erpOptions.length === 0;

                      const glCode = glByCode[m.departmentCode]?.trim() ?? "";
                      const savedGlCode = savedGlByCode[m.departmentCode]?.trim() ?? "";
                      const glIsDirty = glCode !== savedGlCode;

                      const glDesc = glDescByCode[m.departmentCode]?.trim() ?? "";
                      const savedGlDesc = savedGlDescByCode[m.departmentCode]?.trim() ?? "";
                      const glDescIsDirty = glDesc !== savedGlDesc;

                      // Fixed G/L only posts if this row also has an ERP-dept mapping —
                      // computePrepIssues() marks the request incomplete otherwise, so
                      // buildPaymentBatch() silently skips it. Warn admins inline.
                      const glWithoutErpDept = Boolean(glCode) && !erpCode;

                      const rowIsDirty = isDirty || glIsDirty || glDescIsDirty;
                      const glSelectDisabled = saving || glSelectOptions.length === 0;

                      return (
                        <div
                          key={m.departmentCode}
                          className="flex flex-col gap-2 px-3 py-2.5 rounded-lg"
                          style={{
                            background: rowIsDirty
                              ? "var(--bg-info-yellow)"
                              : matchesBranchHint
                                ? "var(--bg-info-green)"
                                : "var(--bg-card-alt)",
                            border: `1px solid ${
                              rowIsDirty
                                ? "var(--border-info-yellow)"
                                : matchesBranchHint
                                  ? "var(--border-info-green)"
                                  : isSavedMapped
                                    ? "rgba(79, 163, 122, 0.35)"
                                    : "var(--border-card)"
                            }`,
                          }}
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] gap-2 sm:gap-3 items-center">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
                                style={{
                                  background: isSavedMapped ? "rgba(79, 163, 122, 0.12)" : "var(--nav-active-bg)",
                                  color: isSavedMapped ? "#4fa37a" : "var(--nav-active-text)",
                                }}
                              >
                                {deptInitials(m.departmentName ?? m.departmentCode)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-[12px] font-semibold m-0 truncate" style={{ color: "var(--text-heading)" }}>
                                    {m.departmentCode}
                                  </p>
                                  {isSavedMapped && <Badge label="Mapped" color="#4fa37a" small />}
                                  {matchesBranchHint && (
                                    <Badge label={`Branch ${branchHint}`} color="var(--nav-active-text)" small />
                                  )}
                                </div>
                                {m.departmentName && (
                                  <p className="text-[10px] m-0 mt-0.5 truncate" style={{ color: "var(--text-faint)" }}>
                                    {m.departmentName}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="hidden sm:flex items-center justify-center">
                              {isSavedMapped ? (
                                <CheckCircle2 size={14} style={{ color: "#4fa37a" }} />
                              ) : (
                                <ArrowRight size={14} style={{ color: "var(--text-faint)" }} />
                              )}
                            </div>

                            <div className="min-w-0 sm:pl-0 pl-[42px]">
                              <SearchableSelect
                                value={erpByCode[m.departmentCode] ?? ""}
                                onChange={(val) => {
                                  setErpByCode((prev) => ({
                                    ...prev,
                                    [m.departmentCode]: val,
                                  }));
                                }}
                                options={editGroup.erpOptions.map((o) => ({
                                  value: o.code,
                                  label: erpLabel(o),
                                }))}
                                placeholder="— ไม่ map —"
                                emptyLabel="— ไม่ map —"
                                searchPlaceholder="ค้นหารหัส / ชื่อแผนก ERP..."
                                disabled={selectDisabled}
                                borderColor={
                                  isDirty
                                    ? "var(--border-info-yellow)"
                                    : matchesBranchHint
                                      ? "var(--border-info-green)"
                                      : isSavedMapped
                                        ? "rgba(79, 163, 122, 0.4)"
                                        : undefined
                                }
                              />
                            </div>
                          </div>

                          <div
                            className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 pt-2 mt-0.5 sm:pl-0 pl-[42px]"
                            style={{ borderTop: "1px solid var(--border-light)" }}
                          >
                            <div className="min-w-0">
                              <p
                                className="text-[9px] font-bold uppercase tracking-wide m-0 mb-1"
                                style={{ color: "var(--text-faint)" }}
                              >
                                Fixed G/L
                              </p>
                              <SearchableSelect
                                value={glByCode[m.departmentCode] ?? ""}
                                onChange={(val) => {
                                  setGlByCode((prev) => ({
                                    ...prev,
                                    [m.departmentCode]: val,
                                  }));
                                  setGlDescByCode((prev) => ({
                                    ...prev,
                                    [m.departmentCode]: val
                                      ? erpDescriptionFromGlOption(val, glSelectOptions)
                                      : "",
                                  }));
                                }}
                                options={glSelectOptions}
                                placeholder="— ไม่ fix G/L —"
                                emptyLabel="— ไม่ fix G/L —"
                                searchPlaceholder="ค้นหา G/L..."
                                disabled={glSelectDisabled}
                                borderColor={glIsDirty ? "var(--border-info-yellow)" : undefined}
                              />
                              {glWithoutErpDept && (
                                <p
                                  className="text-[11px] m-0 mt-1 leading-snug"
                                  style={{ color: "var(--color-danger)" }}
                                >
                                  ⚠ ต้อง map ERP dept ของแผนกนี้ด้วย ไม่งั้น G/L ที่ fix จะไม่ถูกใช้ตอนโพสต์
                                </p>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p
                                className="text-[9px] font-bold uppercase tracking-wide m-0 mb-1"
                                style={{ color: "var(--text-faint)" }}
                              >
                                Description
                              </p>
                              <input
                                type="text"
                                value={glDescByCode[m.departmentCode] ?? ""}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setGlDescByCode((prev) => ({
                                    ...prev,
                                    [m.departmentCode]: next,
                                  }));
                                }}
                                disabled={saving || !glCode}
                                maxLength={500}
                                placeholder={!glCode ? "เลือก G/L ก่อน" : "คำอธิบาย Journal"}
                                className="w-full text-[12px] rounded-xl px-3 outline-none min-h-[38px] disabled:opacity-50"
                                style={{
                                  background: "var(--bg-input)",
                                  border: `1px solid ${glDescIsDirty ? "var(--border-info-yellow)" : "var(--border-input)"}`,
                                  color: glDesc ? "var(--text-primary)" : "var(--text-muted)",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div
              className="shrink-0 px-6 py-4 flex flex-wrap items-center justify-between gap-3"
              style={{ borderTop: "1px solid var(--border-light)" }}
            >
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                แสดง {filteredMappings.length} จาก {editGroup.totalCount} แผนก
                {editIsDirty && (
                  <span style={{ color: "var(--text-info-yellow)" }}> · มีการแก้ไขที่ยังไม่บันทึก</span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void saveTargetMappings(editGroup)}
                  loading={saving}
                  disabled={!editIsDirty}
                >
                  บันทึก
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleClose()}
                  loading={saving}
                >
                  ปิด
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
