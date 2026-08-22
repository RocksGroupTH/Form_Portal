"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { Check, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { SettingsFilterBar } from "./SettingsFilterBar";
import { ApproverInterfaceBrandTable } from "./ApproverInterfaceBrandTable";
import { GRANTABLE_SETTINGS_TABS } from "@/lib/acc/settings-tabs";
import type { AccApproverRow } from "@/features/accounting/types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  }
  return json;
};

/* ── AD Search Modal ── */
interface ADResult {
  email: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  photo?: string | null;
  id?: string | null;
}

function ADSearchModal({
  onClose,
  onSelect,
  existingEmails,
}: {
  onClose: () => void;
  onSelect: (user: ADResult) => void;
  existingEmails?: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ADResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        setError(null);
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        if (json.ok) setResults(json.data ?? []);
        else throw new Error(json.error || "Search failed");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const existing = new Set((existingEmails ?? []).map((e) => e.toLowerCase()));

  return (
    <div
      className="app-overlay fixed inset-0 z-50 flex items-center justify-center"
     
    >
      <div
        className="rounded-2xl w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-card)",
          boxShadow: "var(--shadow-modal)",
          border: "1px solid var(--border-card)",
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>
              เพิ่มผู้อนุมัติบัญชี
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              ค้นหาจาก Microsoft Entra ID
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
          >
            <span className="text-[14px]">✕</span>
          </button>
        </div>

        {/* Search input */}
        <div className="px-5 py-3 shrink-0">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}
          >
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์ชื่อหรืออีเมล..."
              className="flex-1 text-[13px] outline-none bg-transparent"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {query.trim().length < 2 ? (
            <div className="py-10 text-center">
              <p className="text-[20px] mb-2">☁️</p>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา
              </p>
            </div>
          ) : searching ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                กำลังค้นหา...
              </p>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>
                {error}
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                ไม่พบผู้ใช้งานสำหรับ &quot;{query}&quot;
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: "var(--text-faint)" }}
              >
                {results.length} รายการ
              </p>
              {results.map((u) => {
                const added = existing.has(u.email.toLowerCase());
                return (
                  <div
                    key={u.email}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{
                      border: `1px solid ${added ? "#4fa37a30" : "var(--border-card)"}`,
                      background: added ? "#e4f4ea08" : "var(--bg-card)",
                    }}
                  >
                    {u.photo ? (
                      <img
                        src={u.photo}
                        alt={u.name}
                        className="w-9 h-9 rounded-full shrink-0 object-cover"
                      />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                        style={{
                          background: added ? "#e4f4ea" : "var(--nav-active-bg)",
                          color: added ? "#4fa37a" : "var(--nav-active-text)",
                        }}
                      >
                        {u.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                        {u.name}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {u.email}
                        {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                        {u.department ? ` · ${u.department}` : ""}
                      </p>
                    </div>
                    {added ? (
                      <span
                        className="text-[10px] font-bold px-2 py-1 rounded-lg"
                        style={{ color: "#4fa37a", background: "#e4f4ea" }}
                      >
                        เพิ่มแล้ว
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          onSelect(u);
                          onClose();
                        }}
                        className="text-[11px] font-bold px-3 py-1 rounded-lg cursor-pointer border-none"
                        style={{
                          background: "var(--btn-primary-bg)",
                          color: "var(--btn-primary-text)",
                        }}
                      >
                        + เพิ่ม
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Settings-tab grants ──
 *
 * One row per approver, one column per grantable tab. The columns come from
 * GRANTABLE_SETTINGS_TABS rather than from a list retyped here, so the tab that
 * hands out access (`approvers`) can never appear among them — a non-admin who
 * could open it would grant themselves the rest.
 */
function TabGrantCheckbox({
  checked,
  saving,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  saving: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={saving}
      aria-label={ariaLabel}
      disabled={saving}
      onClick={() => {
        if (!saving) onChange();
      }}
      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center mx-auto border-none p-0 transition-all"
      style={{
        background: checked ? "var(--text-info-green)" : "var(--bg-card)",
        boxShadow: checked
          ? "0 0 0 2px color-mix(in srgb, var(--text-info-green) 28%, transparent)"
          : "inset 0 0 0 1.5px var(--border-card)",
        opacity: saving ? 0.6 : 1,
        cursor: saving ? "not-allowed" : "pointer",
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

function ApproverTabGrantCells({
  approver,
  onSaved,
}: {
  approver: AccApproverRow;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(approver.settingsTabs));
  const [saving, setSaving] = useState(false);

  // The server's answer is the truth; re-seed whenever SWR brings a new one.
  useEffect(() => {
    setChecked(new Set(approver.settingsTabs));
  }, [approver.id, approver.settingsTabs]);

  const toggle = async (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
    setSaving(true);
    try {
      const res = await fetch("/api/request/accounting/settings/approvers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: approver.id,
          email: approver.email,
          // Posted in GRANTABLE_SETTINGS_TABS order, so what is stored never
          // depends on the order the boxes happened to be ticked.
          settingsTabs: GRANTABLE_SETTINGS_TABS.filter((t) => next.has(t.key)).map((t) => t.key),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSaved();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        setChecked(new Set(approver.settingsTabs));
      }
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
      setChecked(new Set(approver.settingsTabs));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {GRANTABLE_SETTINGS_TABS.map((tab) => (
        <td key={tab.key} className="px-3 py-2.5 text-center">
          <TabGrantCheckbox
            checked={checked.has(tab.key)}
            saving={saving}
            onChange={() => void toggle(tab.key)}
            ariaLabel={`${approver.displayName ?? approver.email} — ${tab.label}`}
          />
        </td>
      ))}
    </>
  );
}

function ApproverTabGrantTable({
  approvers,
  onSaved,
}: {
  approvers: AccApproverRow[];
  onSaved: () => void;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-[13px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>
        สิทธิ์เข้าถึงแท็บตั้งค่า
      </h3>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
        <p
          className="text-[11px] px-4 py-2.5 m-0"
          style={{ color: "var(--text-muted)", background: "var(--bg-card-alt)" }}
        >
          ผู้อนุมัติที่ไม่ใช่แอดมินจะเห็นเฉพาะแท็บที่ติ๊กให้
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[860px]">
            <thead>
              <tr
                style={{
                  background: "var(--bg-card-alt)",
                  borderBottom: "1px solid var(--border-light)",
                }}
              >
                <th
                  className="text-left px-4 py-2.5 font-semibold whitespace-nowrap min-w-[220px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  ผู้อนุมัติ
                </th>
                {GRANTABLE_SETTINGS_TABS.map((tab) => (
                  <th
                    key={tab.key}
                    className="text-center px-3 py-2.5 font-semibold whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {tab.label}
                  </th>
                ))}
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
                    <p
                      className="text-[13px] font-semibold m-0 truncate"
                      style={{ color: "var(--text-heading)" }}
                    >
                      {a.displayName ?? "—"}
                    </p>
                    <p
                      className="text-[10px] m-0 mt-0.5 truncate"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {a.email}
                    </p>
                  </td>
                  {a.isActive ? (
                    <ApproverTabGrantCells approver={a} onSaved={onSaved} />
                  ) : (
                    <td
                      className="px-3 py-2.5 text-center"
                      colSpan={GRANTABLE_SETTINGS_TABS.length}
                    >
                      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                        เปิดใช้งานเพื่อกำหนดสิทธิ์แท็บ
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ── */
export function ApproverSettings() {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: AccApproverRow[] }>(
    "/api/request/accounting/settings/approvers",
    fetcher,
  );
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const approvers = data?.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = approvers.filter((a) => {
    if (statusFilter === "active" && !a.isActive) return false;
    if (statusFilter === "inactive" && a.isActive) return false;
    if (!q) return true;
    return (
      (a.displayName ?? "").toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      String(a.staffId ?? "").includes(q)
    );
  });

  const postApprover = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/request/accounting/settings/approvers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("บันทึกสำเร็จ");
      await mutate();
    } else {
      toast.error(json.error ?? "บันทึกไม่สำเร็จ");
    }
  };

  const handleAddUser = async (user: ADResult) => {
    await postApprover({
      email: user.email,
      displayName: user.name,
      photoUrl: user.photo ?? null,
      isActive: true,
    });
  };

  const handleToggleActive = async (approver: AccApproverRow) => {
    setSaving(approver.id);
    await postApprover({ id: approver.id, isActive: !approver.isActive });
    setSaving(null);
  };

  return (
    <div>
      {/* Add button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {approvers.filter((a) => a.isActive).length} คนที่ใช้งานอยู่ / {approvers.length} คนทั้งหมด
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
          style={{ background: "var(--color-action)", color: "#fff" }}
        >
          <Plus size={13} /> เพิ่มผู้อนุมัติ
        </button>
      </div>

      {/* Search + filter */}
      {approvers.length > 0 && (
        <SettingsFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="ค้นหาชื่อ / อีเมล / รหัสพนักงาน..."
          groups={[
            {
              value: statusFilter,
              onChange: (v) => setStatusFilter(v as "all" | "active" | "inactive"),
              options: [
                { value: "all", label: "ทั้งหมด" },
                { value: "active", label: "ใช้งาน" },
                { value: "inactive", label: "ปิด" },
              ],
            },
          ]}
        />
      )}

      {/* List */}
      {isLoading ? (
        <div
          className="rounded-xl py-10 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            กำลังโหลด...
          </p>
        </div>
      ) : error ? (
        <div
          className="rounded-xl py-10 text-center px-4"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[13px] font-medium" style={{ color: "var(--color-danger)" }}>
            โหลดรายชื่อผู้อนุมัติไม่สำเร็จ
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
            {error instanceof Error ? error.message : "เกิดข้อผิดพลาด"}
          </p>
        </div>
      ) : approvers.length === 0 ? (
        <div
          className="rounded-xl py-10 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีผู้อนุมัติ
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-faint)" }}>
            กด "เพิ่มผู้อนุมัติ" เพื่อเพิ่มรายชื่อ
          </p>
        </div>
      ) : (
        <>
          <ApproverInterfaceBrandTable
            approvers={filtered}
            savingId={saving}
            onSaved={() => mutate()}
            onToggleActive={handleToggleActive}
          />
          {filtered.length > 0 && (
            <ApproverTabGrantTable approvers={filtered} onSaved={() => mutate()} />
          )}
        </>
      )}

      {/* AD Modal */}
      {showModal && (
        <ADSearchModal
          onClose={() => setShowModal(false)}
          onSelect={handleAddUser}
          existingEmails={approvers.map((a) => a.email)}
        />
      )}
    </div>
  );
}
