"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AccSameDayBrandRow } from "@/features/accounting/types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  }
  return json;
};

interface ADResult {
  email: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  photo?: string | null;
}

function ADSearchModal({
  onClose, onSelect, existingEmails,
}: { onClose: () => void; onSelect: (u: ADResult) => void; existingEmails: string[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ADResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setError(null); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true); setError(null);
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        if (json.ok) setResults(json.data ?? []);
        else throw new Error(json.error || "Search failed");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const existing = new Set(existingEmails.map((e) => e.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--overlay-bg)" }}>
      <div className="rounded-2xl w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-modal)", border: "1px solid var(--border-card)" }}>
        <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>เพิ่มผู้เบิกวันซ้ำข้ามแบรนด์</h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>ค้นหาจาก Microsoft Entra ID</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}><span className="text-[14px]">✕</span></button>
        </div>
        <div className="px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="พิมพ์ชื่อหรืออีเมล..."
              className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: "var(--text-primary)" }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {query.trim().length < 2 ? (
            <div className="py-10 text-center"><p className="text-[12px]" style={{ color: "var(--text-muted)" }}>พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา</p></div>
          ) : searching ? (
            <div className="py-10 text-center"><p className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังค้นหา...</p></div>
          ) : error ? (
            <div className="py-10 text-center"><p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{error}</p></div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center"><p className="text-[12px]" style={{ color: "var(--text-muted)" }}>ไม่พบผู้ใช้งาน</p></div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {results.map((u) => {
                const added = existing.has(u.email.toLowerCase());
                return (
                  <div key={u.email} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ border: `1px solid ${added ? "#4fa37a30" : "var(--border-card)"}`, background: added ? "#e4f4ea08" : "var(--bg-card)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{u.name}</p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ""}</p>
                    </div>
                    {added ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ color: "#4fa37a", background: "#e4f4ea" }}>เพิ่มแล้ว</span>
                    ) : (
                      <button onClick={() => { onSelect(u); onClose(); }} className="text-[11px] font-bold px-3 py-1 rounded-lg cursor-pointer border-none"
                        style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }}>+ เพิ่ม</button>
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

export function SameDayBrandSettings() {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: AccSameDayBrandRow[] }>(
    "/api/request/accounting/settings/same-day-brand", fetcher,
  );
  const [showModal, setShowModal] = useState(false);
  const rows = data?.data ?? [];

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/request/accounting/settings/same-day-brand", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) { toast.success("บันทึกสำเร็จ"); await mutate(); }
    else toast.error(json.error ?? "บันทึกไม่สำเร็จ");
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/request/accounting/settings/same-day-brand?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) { toast.success("ลบแล้ว"); await mutate(); }
    else toast.error(json.error ?? "ลบไม่สำเร็จ");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>เบิกวันซ้ำข้ามแบรนด์</h3>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
          style={{ background: "var(--color-action)", color: "#fff" }}>
          <Plus size={13} /> เพิ่มรายชื่อ
        </button>
      </div>
      <p className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
        คนในรายชื่อนี้เบิกวันเดียวกันได้หลายรายการ ตราบใดที่เป็นคนละแบรนด์
      </p>

      {isLoading ? (
        <div className="rounded-xl py-8 text-center" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl py-8 text-center px-4" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
          <p className="text-[13px] font-medium" style={{ color: "var(--color-danger)" }}>โหลดรายชื่อไม่สำเร็จ</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl py-8 text-center" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ยังไม่มีรายชื่อ</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", opacity: r.isActive ? 1 : 0.55 }}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{r.displayName ?? r.email ?? `StaffId ${r.staffId}`}</p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {r.email ?? "—"}{r.staffId != null ? ` · รหัส ${r.staffId}` : ""}
                </p>
              </div>
              <button onClick={() => post({ id: r.id, isActive: !r.isActive })}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer border-none"
                style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
                {r.isActive ? "ปิด" : "เปิด"}
              </button>
              <button onClick={() => remove(r.id)} aria-label="ลบ"
                className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
                style={{ background: "var(--bg-badge)", color: "var(--color-danger)" }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ADSearchModal onClose={() => setShowModal(false)} existingEmails={rows.map((r) => r.email ?? "")}
          onSelect={(u) => post({ email: u.email, displayName: u.name, isActive: true })} />
      )}
    </div>
  );
}
