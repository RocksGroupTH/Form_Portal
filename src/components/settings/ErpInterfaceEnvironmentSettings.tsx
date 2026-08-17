"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FlaskConical,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

const API_URL = "/api/settings/erp-interface";

const INPUT_CLS =
  "w-full text-[12px] px-2.5 py-2 rounded-lg border-none outline-none transition-shadow focus:ring-2";

interface BcConnectionOption {
  id: number;
  code: string;
  name: string;
}

interface UatRow {
  brandCode: string;
  descriptionPrefix: string | null;
  bcUatId: string | null;
  bcUatName: string | null;
  bcUatConnectionId: number | null;
}

interface ProdTarget {
  brandCode: string;
  brandName: string;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
}

interface SettingsData {
  effectiveEnvironment: ErpBcEnvironment;
  uatSettings: UatRow[];
  prodTargets: ProdTarget[];
  bcConnections: BcConnectionOption[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดการตั้งค่าไม่สำเร็จ");
  }
  return json as { ok: boolean; data: SettingsData };
};

function decodeDisplay(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function isUatRowComplete(row: UatRow): boolean {
  return !!(row.bcUatId?.trim() && row.bcUatName?.trim() && row.bcUatConnectionId);
}

function ProdCell({ target }: { target: ProdTarget | undefined }) {
  if (!target?.bcName?.trim() && !target?.bcConnectionCode?.trim() && !target?.bcId?.trim()) {
    return (
      <span className="text-[11px] italic" style={{ color: "var(--text-faint)" }}>
        ยังไม่ตั้งค่า
      </span>
    );
  }

  const name = decodeDisplay(target.bcName);
  const conn = target.bcConnectionCode?.trim() || target.bcConnectionName?.trim() || null;
  const id = target.bcId?.trim() || null;

  return (
    <div className="space-y-1 min-w-0">
      {name && (
        <p className="text-[12px] font-semibold m-0 truncate" style={{ color: "var(--text-heading)" }}>
          {name}
        </p>
      )}
      {conn && (
        <p className="text-[11px] m-0 truncate" style={{ color: "var(--text-secondary)" }}>
          {conn}
        </p>
      )}
      {id && (
        <p
          className="text-[10px] m-0 truncate font-mono"
          style={{ color: "var(--text-muted)" }}
          title={id}
        >
          {id.length > 28 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id}
        </p>
      )}
    </div>
  );
}

function UatBrandRow({
  brandCode,
  brandName,
  prodTarget,
  row,
  connections,
  onSaved,
}: {
  brandCode: string;
  brandName: string;
  prodTarget: ProdTarget | undefined;
  row: UatRow;
  connections: BcConnectionOption[];
  onSaved: () => void;
}) {
  const [bcUatId, setBcUatId] = useState(row.bcUatId ?? "");
  const [bcUatName, setBcUatName] = useState(row.bcUatName ?? "");
  const [bcUatConnectionId, setBcUatConnectionId] = useState<number | null>(
    row.bcUatConnectionId,
  );
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const complete = isUatRowComplete({
    ...row,
    bcUatId,
    bcUatName,
    bcUatConnectionId,
  });

  useEffect(() => {
    setBcUatId(row.bcUatId ?? "");
    setBcUatName(row.bcUatName ?? "");
    setBcUatConnectionId(row.bcUatConnectionId);
  }, [row.bcUatId, row.bcUatName, row.bcUatConnectionId]);

  const save = useCallback(
    async (patch: {
      bcUatId?: string;
      bcUatName?: string;
      bcUatConnectionId?: number | null;
    }) => {
      setSaving(true);
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uatSettings: [
              {
                brandCode,
                bcUatId: patch.bcUatId !== undefined ? patch.bcUatId : bcUatId,
                bcUatName: patch.bcUatName !== undefined ? patch.bcUatName : bcUatName,
                bcUatConnectionId:
                  patch.bcUatConnectionId !== undefined
                    ? patch.bcUatConnectionId
                    : bcUatConnectionId,
              },
            ],
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(typeof json.error === "string" ? json.error : "บันทึกไม่สำเร็จ");
        }
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      } finally {
        setSaving(false);
      }
    },
    [brandCode, bcUatId, bcUatName, bcUatConnectionId, onSaved],
  );

  const scheduleTextSave = useCallback(
    (field: "bcUatId" | "bcUatName", value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void save({ [field]: value });
      }, 600);
    },
    [save],
  );

  const connOptions = connections.map((c) => ({
    value: String(c.id),
    label: `${c.code} — ${c.name}`,
  }));

  const fieldStyle = {
    background: "var(--bg-card-alt)",
    color: "var(--text-primary)",
  } as const;

  return (
    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2.5 min-w-[120px]">
          <img
            src={`/brandlogo/${brandCode.toLowerCase()}-200.png`}
            alt=""
            className="w-8 h-8 rounded-lg object-contain shrink-0"
            style={{ background: "var(--bg-badge)" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              {brandCode}
            </p>
            <p className="text-[10px] m-0 truncate" style={{ color: "var(--text-muted)" }}>
              {brandName}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 align-top max-w-[200px]">
        <ProdCell target={prodTarget} />
      </td>
      <td className="px-3 py-3 align-top">
        <label className="block">
          <span className="sr-only">UAT Company Id — {brandCode}</span>
          <input
            type="text"
            value={bcUatId}
            onChange={(e) => {
              setBcUatId(e.target.value);
              scheduleTextSave("bcUatId", e.target.value);
            }}
            placeholder="Company Id"
            className={INPUT_CLS}
            style={{
              ...fieldStyle,
              minWidth: 120,
            }}
          />
        </label>
      </td>
      <td className="px-3 py-3 align-top">
        <label className="block">
          <span className="sr-only">UAT Company Name — {brandCode}</span>
          <input
            type="text"
            value={bcUatName}
            onChange={(e) => {
              setBcUatName(e.target.value);
              scheduleTextSave("bcUatName", e.target.value);
            }}
            placeholder="Company Name"
            className={INPUT_CLS}
            style={{
              ...fieldStyle,
              minWidth: 140,
            }}
          />
        </label>
      </td>
      <td className="px-3 py-3 align-top min-w-[200px]">
        <SearchableSelect
          value={bcUatConnectionId != null ? String(bcUatConnectionId) : ""}
          onChange={(v) => {
            const id = v ? Number(v) : null;
            setBcUatConnectionId(id);
            void save({ bcUatConnectionId: id });
          }}
          options={[{ value: "", label: "— ไม่ระบุ —" }, ...connOptions]}
          placeholder="เลือก BC Connection"
          triggerBackground="var(--bg-card-alt)"
        />
      </td>
      <td className="px-3 py-3 align-top text-center w-16">
        {saving ? (
          <Loader2 size={15} className="animate-spin mx-auto" style={{ color: "var(--text-muted)" }} />
        ) : complete ? (
          <CheckCircle2
            size={16}
            className="mx-auto"
            style={{ color: "var(--text-info-green)" }}
            aria-label="ตั้งค่า UAT ครบ"
          />
        ) : (
          <Circle size={14} className="mx-auto" style={{ color: "var(--text-faint)" }} aria-hidden />
        )}
      </td>
    </tr>
  );
}

export function ErpInterfaceEnvironmentSettings() {
  const { data, error, isLoading, mutate } = useSWR(API_URL, fetcher);

  const settings = data?.data;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
          กำลังโหลดการตั้งค่า...
        </p>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div
        className="rounded-xl px-4 py-8 text-center"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
      >
        <p className="text-[13px] m-0" style={{ color: "var(--text-danger)" }}>
          {error instanceof Error ? error.message : "โหลดการตั้งค่าไม่สำเร็จ"}
        </p>
      </div>
    );
  }

  const prodByCode = new Map(
    settings.prodTargets.map((t) => [t.brandCode.toUpperCase(), t]),
  );
  const uatByCode = new Map(settings.uatSettings.map((r) => [r.brandCode, r]));
  const uatCompleteCount = settings.uatSettings.filter(isUatRowComplete).length;

  return (
    <div className="space-y-5">
      {/* Section 2 — UAT mapping */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div
          className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}
        >
          <div>
            <h2 className="text-[14px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              บริษัท BC ต่อกลุ่ม Interface
            </h2>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              Production จาก Brand Configuration · UAT กรอกด้านล่าง · บันทึกอัตโนมัติ
            </p>
            <p className="text-[12px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
              ฟอร์มที่ตั้งเป็น UAT ที่ Settings → Form Environment จะใช้การตั้งค่า UAT ด้านล่างนี้
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              UAT พร้อมใช้ {uatCompleteCount}/{ERP_INTERFACE_BRANDS.length} กลุ่ม
            </span>
            <Link
              href="/settings/brand-config"
              className="inline-flex items-center gap-1 text-[11px] font-semibold no-underline"
              style={{ color: "var(--nav-active-text)" }}
            >
              Brand Config
              <ExternalLink size={11} />
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[880px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                <th
                  className="text-left px-4 py-2.5 font-semibold w-[130px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  กลุ่ม
                </th>
                <th
                  className="text-left px-3 py-2.5 font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck size={12} style={{ color: "var(--text-info-green)" }} />
                    Production
                  </span>
                </th>
                <th
                  className="text-left px-3 py-2.5 font-semibold"
                  colSpan={3}
                  style={{
                    color: "var(--text-secondary)",
                    background: "color-mix(in srgb, var(--text-warning) 6%, transparent)",
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <FlaskConical size={12} style={{ color: "var(--text-warning)" }} />
                    UAT (Sandbox)
                  </span>
                </th>
                <th
                  className="text-center px-3 py-2.5 font-semibold w-16"
                  style={{ color: "var(--text-secondary)" }}
                >
                  สถานะ
                </th>
              </tr>
              <tr
                style={{
                  borderBottom: "1px solid var(--border-light)",
                  background: "var(--bg-card-alt)",
                }}
              >
                <th colSpan={2} />
                <th
                  className="text-left px-3 py-1.5 text-[10px] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Company Id
                </th>
                <th
                  className="text-left px-3 py-1.5 text-[10px] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Company Name
                </th>
                <th
                  className="text-left px-3 py-1.5 text-[10px] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  BC Connection
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ERP_INTERFACE_BRANDS.map((b) => {
                const code = b.id.toUpperCase();
                const row = uatByCode.get(code) ?? {
                  brandCode: code,
                  descriptionPrefix: null,
                  bcUatId: null,
                  bcUatName: null,
                  bcUatConnectionId: null,
                };
                return (
                  <UatBrandRow
                    key={code}
                    brandCode={code}
                    brandName={b.name}
                    prodTarget={prodByCode.get(code)}
                    row={row}
                    connections={settings.bcConnections}
                    onSaved={() => void mutate()}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
