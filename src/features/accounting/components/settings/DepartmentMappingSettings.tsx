"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ChevronRight,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  ErpAccountSyncPopup,
  type ErpSyncPopupState,
} from "@/features/accounting/components/settings/ErpAccountSyncPopup";
import { useAccSettingsDeepLink } from "@/features/accounting/lib/use-acc-settings-deep-link";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";
import { DepartmentMappingDialog } from "./DepartmentMappingDialog";
import {
  isBrandMapDirty,
  mappingsToErpMap,
  type ClaimBrandRef,
  type DepartmentMappingPageData,
  type MapFilter,
  type TargetGroup,
} from "./department-mapping-shared";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtSyncTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

interface PageData extends DepartmentMappingPageData {}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const empty = !value.trim() || value === "—";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p
        className="text-[12px] m-0 truncate"
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }}
        title={value}
      >
        {empty ? "—" : value}
      </p>
    </div>
  );
}

function ClaimBrandsSummary({ claims }: { claims: ClaimBrandRef[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>
        แบรนด์เบิก
      </p>
      {claims.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>—</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {claims.map((claim) => (
            <span
              key={claim.claimBrandCode}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium max-w-full"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                color: "var(--text-secondary)",
              }}
              title={`${claim.brandName} (${claim.claimBrandCode})`}
            >
              {claim.brandLogo && (
                <img
                  src={claim.brandLogo}
                  alt=""
                  className="h-3.5 w-auto object-contain shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <span className="truncate">{claim.brandName}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TargetDeptSummaryCard({
  group,
  erpByCode,
  savedErpByCode,
  disabled,
  onClick,
}: {
  group: TargetGroup;
  erpByCode: Record<string, string>;
  savedErpByCode: Record<string, string>;
  disabled: boolean;
  onClick: () => void;
}) {
  const codes = group.mappings.map((m) => m.departmentCode);
  const isDirty = isBrandMapDirty(erpByCode, savedErpByCode, codes);
  const savedMapped = codes.filter((id) => (savedErpByCode[id]?.trim() ?? "") !== "").length;
  const rowComplete = group.totalCount > 0 && savedMapped === group.totalCount && !isDirty;

  const cardBorder = rowComplete
    ? "var(--border-info-green)"
    : isDirty
      ? "var(--border-info-yellow)"
      : "var(--border-card)";

  const cardBg = rowComplete
    ? "var(--bg-info-green)"
    : isDirty
      ? "var(--bg-info-yellow)"
      : "var(--bg-card-alt)";

  const syncLabel = group.lastSync
    ? fmtSyncTime(group.lastSync.finishedAt ?? group.lastSync.startedAt)
    : "—";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left rounded-xl px-4 py-4 transition-all"
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        boxShadow: rowComplete ? "0 0 0 1px rgba(79, 163, 122, 0.08)" : undefined,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {group.targetBrandLogo && (
            <img
              src={group.targetBrandLogo}
              alt=""
              className="h-8 w-auto object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
              {group.targetBrandName ?? group.targetBrandCode}
            </p>
            <p className="text-[10px] m-0 font-mono" style={{ color: "var(--text-muted)" }}>
              {group.targetBrandCode}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rowComplete && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(79, 163, 122, 0.15)", color: "var(--text-info-green)" }}
            >
              ครบแล้ว
            </span>
          )}
          {isDirty && !rowComplete && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
            >
              รอบันทึก
            </span>
          )}
          {!rowComplete && !isDirty && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
            >
              ยังไม่ครบ
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
            style={{ color: "var(--nav-active-text)", background: "var(--nav-active-bg)" }}
          >
            <Pencil size={12} />
            แก้ไข
          </span>
          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
        </div>
      </div>

      <div
        className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 mt-3 pt-3"
        style={{ borderTop: "1px solid var(--border-light)" }}
      >
        <ClaimBrandsSummary claims={group.claimBrands} />
        <SummaryRow label="Dimension" value={group.dimensionCode} />
        <SummaryRow label="ERP Options" value={String(group.erpOptions.length)} />
        <SummaryRow label="Map แล้ว" value={`${savedMapped}/${group.totalCount}`} />
        <SummaryRow label="Sync ล่าสุด" value={syncLabel} />
        <SummaryRow
          label="แผนก HR"
          value={group.totalCount > 0 ? String(group.totalCount) : "—"}
        />
      </div>
    </button>
  );
}

export function DepartmentMappingSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data?: PageData; error?: string }>(
    "/api/request/accounting/settings/departments",
    fetcher,
  );

  const page = data?.data;
  const groups = useMemo(() => page?.groups ?? [], [page?.groups]);
  const unassignedClaims = useMemo(() => page?.unassignedClaims ?? [], [page?.unassignedClaims]);

  const [erpByTarget, setErpByTarget] = useState<Record<string, Record<string, string>>>({});
  const [savedErpByTarget, setSavedErpByTarget] = useState<Record<string, Record<string, string>>>({});
  const [initialized, setInitialized] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /**
   * The `departments` grant opens the list and the save, but not
   * `settings/departments/sync` — that pulls DEPT dimension values out of
   * Business Central into the ERP reporting database shared with the Rocks Fast
   * sibling, so it stayed admin-only. Hide the control rather than offer it and
   * answer 403. Same SWR key the settings page already loaded, so this is a
   * cache hit and nothing flashes.
   */
  const { isAdmin: canSyncErp } = useAccountingAccess();
  const [syncPopup, setSyncPopup] = useState<ErpSyncPopupState>({
    open: false,
    brandCode: "",
    part: "",
    percent: 0,
    status: "running",
  });
  const [editTargetCode, setEditTargetCode] = useState<string | null>(null);
  const [deptDialogMapFilter, setDeptDialogMapFilter] = useState<MapFilter>("all");

  const syncStateFromServer = useCallback(() => {
    const nextDraft: Record<string, Record<string, string>> = {};
    const nextSaved: Record<string, Record<string, string>> = {};
    for (const g of groups) {
      const map = mappingsToErpMap(g.mappings);
      nextDraft[g.targetBrandCode] = { ...map };
      nextSaved[g.targetBrandCode] = { ...map };
    }
    setErpByTarget(nextDraft);
    setSavedErpByTarget(nextSaved);
  }, [groups]);

  useEffect(() => {
    if (!page || initialized) return;
    syncStateFromServer();
    setInitialized(true);
  }, [page, initialized, syncStateFromServer]);

  useAccSettingsDeepLink({
    ready: initialized,
    onOpenDepartmentGroup: (iface) => {
      setEditTargetCode(iface);
      setDeptDialogMapFilter("unmapped");
    },
  });

  const completeGroups = useMemo(
    () => groups.filter((g) => {
      const saved = savedErpByTarget[g.targetBrandCode] ?? {};
      const mapped = Object.values(saved).filter((v) => v?.trim()).length;
      const draft = erpByTarget[g.targetBrandCode] ?? {};
      const dirty = isBrandMapDirty(draft, saved, g.mappings.map((m) => m.departmentCode));
      return mapped === g.totalCount && g.totalCount > 0 && !dirty;
    }).length,
    [groups, savedErpByTarget, erpByTarget],
  );
  const totalClaimBrands = groups.reduce((sum, g) => sum + g.claimBrands.length, 0) + unassignedClaims.length;

  const sortedGroups = useMemo(() => {
    const order = ERP_INTERFACE_BRANDS.map((b) => b.id);
    return [...groups].sort((a, b) => {
      const ai = order.indexOf(a.targetBrandCode);
      const bi = order.indexOf(b.targetBrandCode);
      if (ai === -1 && bi === -1) return a.targetBrandCode.localeCompare(b.targetBrandCode);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [groups]);

  const handleSync = async () => {
    const totalSteps = ERP_INTERFACE_BRANDS.length;
    let doneSteps = 0;
    let totalRows = 0;
    const errors: string[] = [];
    const partLabel = `Dimension ${page?.dimensionCode ?? "DEPT"}`;

    setSyncing(true);
    setSyncPopup({
      open: true,
      brandCode: "",
      part: "เตรียมข้อมูล",
      percent: 0,
      status: "running",
    });

    try {
      for (const brand of ERP_INTERFACE_BRANDS) {
        setSyncPopup({
          open: true,
          brandCode: brand.id,
          part: partLabel,
          percent: totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0,
          status: "running",
        });

        try {
          const res = await fetch("/api/request/accounting/settings/departments/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ brandCode: brand.id }),
          });
          const json = await res.json();
          if (!json.ok) {
            errors.push(`${brand.id}: ${json.error ?? "Sync failed"}`);
          } else {
            totalRows += json.data?.rowsUpserted ?? 0;
          }
        } catch {
          errors.push(`${brand.id}: Sync failed`);
        }

        doneSteps += 1;
        setSyncPopup({
          open: true,
          brandCode: brand.id,
          part: partLabel,
          percent: Math.round((doneSteps / totalSteps) * 100),
          status: "running",
        });
      }

      setInitialized(false);
      await mutate();

      if (errors.length > 0) {
        setSyncPopup({
          open: true,
          brandCode: "",
          part: "",
          percent: 100,
          status: "error",
          detail: errors.slice(0, 3).join(" · "),
        });
        toast.warning(
          `Sync บางแบรนด์ไม่สำเร็จ (${errors.length}) — ดึงได้ ${totalRows} รายการ`,
        );
      } else {
        setSyncPopup({
          open: true,
          brandCode: "",
          part: "",
          percent: 100,
          status: "done",
          detail: `ดึงข้อมูลสำเร็จ ${totalRows} รายการ — ${ERP_INTERFACE_BRANDS.length} แบรนด์`,
        });
        toast.success(`Sync ERP สำเร็จ — ${totalRows} รายการ (${ERP_INTERFACE_BRANDS.length} แบรนด์)`);
      }

      window.setTimeout(() => {
        setSyncPopup((prev) => ({ ...prev, open: false }));
      }, errors.length > 0 ? 3500 : 1800);
    } catch {
      setSyncPopup({
        open: true,
        brandCode: "",
        part: "",
        percent: 0,
        status: "error",
        detail: "Sync ERP ไม่สำเร็จ",
      });
      toast.error("Sync ERP ไม่สำเร็จ");
      window.setTimeout(() => {
        setSyncPopup((prev) => ({ ...prev, open: false }));
      }, 2500);
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl animate-pulse"
            style={{ background: "var(--bg-card-alt)" }}
          />
        ))}
      </div>
    );
  }

  if (!data?.ok || !page) {
    return (
      <p className="text-[13px]" style={{ color: "var(--color-danger)" }}>
        {data?.error ?? "โหลดข้อมูลไม่สำเร็จ"}
      </p>
    );
  }


  return (
    <div>
      <ErpAccountSyncPopup state={syncPopup} />

      <div
        className="rounded-xl px-4 py-3 mb-4 flex flex-wrap items-start justify-between gap-3"
        style={{
          background: "var(--nav-active-bg)",
          border: "1px solid var(--border-card)",
        }}
      >
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
            Map แผนก HR ↔ ERP
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            กำหนดแผนก HR → ERP ตามกลุ่มแบรนด์ปลายทาง — คลิกกลุ่มเพื่อแก้ไข · Sync ERP ก่อนเลือกแผนก
          </p>
          <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-faint)" }}>
            ตั้งค่าครบ {completeGroups}/{groups.length} กลุ่ม · {totalClaimBrands} แบรนด์เบิก · Dimension {page.dimensionCode}
          </p>
        </div>
        {canSyncErp ? (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              icon={<RefreshCw size={15} className={syncing ? "animate-spin" : ""} />}
              onClick={() => void handleSync()}
              loading={syncing}
            >
              Sync ERP
            </Button>
          </div>
        ) : (
          <p className="text-[10px] m-0 shrink-0 max-w-[190px]" style={{ color: "var(--text-faint)" }}>
            การ Sync ข้อมูลจาก Business Central สงวนไว้สำหรับผู้ดูแลระบบ
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-[11px]">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-info-green)" }} />
          ตั้งค่าครบแล้ว
        </span>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-info-yellow)" }} />
          ยังไม่ครบ / รอบันทึก
        </span>
      </div>

      {groups.length === 0 && unassignedClaims.length === 0 ? (
        <div
          className="rounded-xl py-12 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีแบรนด์ที่เปิดเบิกได้
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedGroups.map((group) => (
            <TargetDeptSummaryCard
              key={group.targetBrandCode}
              group={group}
              erpByCode={erpByTarget[group.targetBrandCode] ?? {}}
              savedErpByCode={savedErpByTarget[group.targetBrandCode] ?? {}}
              disabled={syncing}
              onClick={() => setEditTargetCode(group.targetBrandCode)}
            />
          ))}
          {unassignedClaims.length > 0 && (
            <div
              className="rounded-xl px-4 py-3 text-[12px]"
              style={{
                background: "var(--bg-info-yellow)",
                color: "var(--text-info-yellow)",
                border: "1px solid var(--border-info-yellow)",
              }}
            >
              แบรนด์ที่ยังไม่ตั้งปลายทาง: {unassignedClaims.map((c) => c.brandName).join(", ")} — ตั้งที่แท็บ Interface ERP
            </div>
          )}
        </div>
      )}

      <DepartmentMappingDialog
        open={editTargetCode != null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTargetCode(null);
            setDeptDialogMapFilter("all");
            void mutate().then(() => setInitialized(false));
          }
        }}
        targetBrandCode={editTargetCode}
        initialMapFilter={deptDialogMapFilter}
        onSaved={() => setInitialized(false)}
      />
    </div>
  );
}
