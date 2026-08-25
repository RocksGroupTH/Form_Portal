"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Plus, Trash2, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import {
  fetchList,
  postJson,
  deleteJson,
  ForbiddenState,
  LoadingRow,
} from "./shared";

type Role = "ACCOUNT" | "HEAD";

const ROLES: Role[] = ["ACCOUNT", "HEAD"];
const ROLE_LABEL: Record<Role, string> = {
  ACCOUNT: "บัญชี (Account Office)",
  HEAD: "หัวหน้าบัญชี (Head Accounting)",
};
const ROLE_HINT: Record<Role, string> = {
  ACCOUNT: "ขั้นอนุมัติที่ 2 · ตรวจเอกสาร/บัญชี",
  HEAD: "ขั้นอนุมัติที่ 3 · อนุมัติขั้นสุดท้าย",
};

interface ClrApprover {
  id: number;
  role: Role;
  email: string;
  staffId: number | null;
  displayName: string | null;
  isActive: boolean;
}

const APPROVERS_URL = "/api/request/clear-advance/settings/approvers";

interface AdUser {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  photo: string | null;
}

/** Add-approver picker that searches Azure AD (via /api/users/search), like AP-2. */
function AddApproverForm({
  role,
  busy,
  onAdd,
}: {
  role: Role;
  busy: boolean;
  onAdd: (email: string) => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AdUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  // Anchor the results popup to the input box in viewport coords (position: fixed)
  // so it floats above the page chrome and flips upward near the bottom edge.
  const place = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < 300 && r.top > spaceBelow;
    setPos({ top: above ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width, above });
  };

  // Debounced Azure AD search.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((j: { ok: boolean; data?: AdUser[] }) => setResults(j.ok ? j.data ?? [] : []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Position + close on outside click; reposition on scroll/resize.
  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = () => place();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  async function pick(u: AdUser) {
    if (!u.email) { toast.error("ผู้ใช้นี้ไม่มีอีเมลใน Azure AD"); return; }
    await onAdd(u.email);
    setQ(""); setResults([]); setOpen(false);
  }

  return (
    <div className="mt-1" ref={boxRef}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
        <Search size={14} style={{ color: "var(--text-muted)" }} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={`ค้นหาจาก Azure AD (ชื่อ/อีเมล) เพื่อเพิ่ม ${ROLE_LABEL[role]}...`}
          className="flex-1 text-[13px] outline-none bg-transparent"
          style={{ color: "var(--text-primary)" }}
        />
        {searching && <span className="text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>กำลังค้นหา…</span>}
      </div>
      {open && pos && q.trim().length >= 2 && createPortal(
        <div ref={popRef} className="fixed z-[70] rounded-xl overflow-hidden"
          style={{
            top: pos.above ? undefined : pos.top,
            bottom: pos.above ? window.innerHeight - pos.top : undefined,
            left: pos.left, width: pos.width,
            background: "var(--bg-dropdown, var(--bg-card))",
            border: "1px solid var(--border-card)", boxShadow: "var(--shadow-dropdown)",
          }}>
          <div className="max-h-64 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
                {searching ? "กำลังค้นหา…" : "ไม่พบผู้ใช้ใน Azure AD"}
              </p>
            ) : results.map((u) => (
              <button key={u.id} type="button" disabled={busy} onClick={() => pick(u)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer border-none bg-transparent hover:opacity-80 disabled:cursor-not-allowed">
                <Avatar name={u.name || u.email} size={30} photo={u.photo ?? undefined} color="var(--nav-active-text)" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold truncate m-0" style={{ color: "var(--text-heading)" }}>{u.name}</p>
                  <p className="text-[11px] truncate m-0" style={{ color: "var(--text-muted)" }}>
                    {u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ""}{u.department ? ` · ${u.department}` : ""}
                  </p>
                </div>
                <Plus size={14} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ClrApproverSettings() {
  const [rows, setRows] = useState<ClrApprover[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, forbidden } = await fetchList<ClrApprover>(APPROVERS_URL);
    setForbidden(forbidden);
    setRows(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function add(role: Role, email: string) {
    setBusy(true);
    try {
      await postJson(APPROVERS_URL, { role, email });
      toast.success("เพิ่มผู้อนุมัติแล้ว");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: ClrApprover, isActive: boolean) {
    setBusy(true);
    try {
      // Toggle requires the full identity per the API contract (id, role, email).
      await postJson(APPROVERS_URL, { id: a.id, role: a.role, email: a.email, isActive });
      toast.success(isActive ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: ClrApprover) {
    if (!window.confirm(`ลบผู้อนุมัติ ${a.displayName ?? a.email}?`)) return;
    setBusy(true);
    try {
      await deleteJson(`${APPROVERS_URL}?id=${a.id}`);
      toast.success("ลบแล้ว");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows]);

  if (forbidden) return <ForbiddenState />;
  if (loading) return <LoadingRow />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          ผู้อนุมัติ AP-3
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          กำหนดผู้อนุมัติขั้น <b>บัญชี</b> และ <b>หัวหน้าบัญชี</b> · ขั้นผู้จัดการมาจาก HR
          (ไม่ตั้งค่าที่นี่) · ข้อมูลชื่อ/รหัสพนักงานเติมอัตโนมัติจากอีเมล
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-faint)" }}>
          {activeCount} คนที่ใช้งานอยู่ / {rows.length} คนทั้งหมด
        </p>
      </div>

      {ROLES.map((role) => {
        const list = rows.filter((r) => r.role === role);
        return (
          <div key={role} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h4 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                {ROLE_LABEL[role]}
              </h4>
              <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                {ROLE_HINT[role]}
              </span>
            </div>

            {list.length === 0 ? (
              <p className="text-[12px] px-1" style={{ color: "var(--text-muted)" }}>
                — ยังไม่มี —
              </p>
            ) : (
              list.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{
                    border: "1px solid var(--border-card)",
                    background: "var(--bg-card)",
                    opacity: a.isActive ? 1 : 0.55,
                  }}
                >
                  <Avatar
                    name={a.displayName || a.email}
                    size={36}
                    color="var(--nav-active-text)"
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[13px] font-bold truncate"
                      style={{ color: "var(--text-heading)" }}
                    >
                      {a.displayName ?? a.email}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {a.email}
                      {a.staffId ? ` · #${a.staffId}` : ""}
                    </p>
                  </div>
                  <label
                    className="flex items-center gap-1.5 text-[11px] cursor-pointer"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <input
                      type="checkbox"
                      checked={a.isActive}
                      disabled={busy}
                      onChange={(e) => toggleActive(a, e.target.checked)}
                    />
                    ใช้งาน
                  </label>
                  <button
                    onClick={() => remove(a)}
                    disabled={busy}
                    className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent"
                    style={{ color: "var(--text-danger, #dc2626)" }}
                    title="ลบ"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}

            <AddApproverForm role={role} busy={busy} onAdd={(email) => add(role, email)} />
          </div>
        );
      })}
    </div>
  );
}
