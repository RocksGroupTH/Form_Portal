"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui";

export interface RequesterOption {
  staffId: number;
  fullName: string | null;
  position?: string | null;
  departmentName?: string | null;
  email?: string | null;
  photoUrl?: string | null;
}

/**
 * Popup picker for choosing the requester (ผู้ขอเบิก) — either yourself or a same-department
 * colleague to open a request on their behalf. Styled after the AD search modal, but the list
 * is the already-loaded same-department colleagues and search filters them client-side.
 */
export function RequesterPickerModal({
  open,
  onClose,
  colleagues,
  self,
  value,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  colleagues: RequesterOption[];
  /** The logged-in user, shown as the "ตัวฉันเอง" option at the top. */
  self: RequesterOption | null;
  /** Currently selected requester StaffId; null = self. */
  value: number | null;
  onSelect: (staffId: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      !q
        ? colleagues
        : colleagues.filter(
            (c) =>
              (c.fullName ?? "").toLowerCase().includes(q) ||
              (c.email ?? "").toLowerCase().includes(q) ||
              String(c.staffId).includes(q),
          ),
    [colleagues, q],
  );

  if (!open || typeof document === "undefined") return null;

  const renderRow = (opt: RequesterOption, selected: boolean, onClick: () => void, isSelf: boolean) => (
    <button
      key={isSelf ? "self" : opt.staffId}
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-left w-full transition-colors"
      style={{
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: selected ? "var(--nav-active-text)" : "var(--border-card)",
        background: selected ? "var(--nav-active-bg)" : "var(--bg-card)",
      }}
    >
      <div className="shrink-0 rounded-full overflow-hidden">
        <Avatar name={opt.fullName || "?"} size={36} photo={opt.photoUrl ?? undefined} color="var(--nav-active-text)" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
          {isSelf ? "ตัวฉันเอง" : opt.fullName ?? "-"}
          {!isSelf && (
            <span className="text-[11px] font-normal ml-1.5" style={{ color: "var(--text-muted)" }}>
              #{opt.staffId}
            </span>
          )}
        </p>
        <p className="text-[11px] m-0 truncate" style={{ color: "var(--text-muted)" }}>
          {[opt.departmentName, opt.position].filter(Boolean).join(" · ") || opt.email || ""}
        </p>
      </div>
      {selected && <Check size={16} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "var(--overlay-bg)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl w-[520px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-modal)", border: "1px solid var(--border-card)" }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <div>
            <h2 className="text-[15px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              เลือกผู้ขอเบิก
            </h2>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              เลือกตัวเอง หรือเพื่อนร่วมแผนกเพื่อกรอกแทน
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
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
              placeholder="ค้นหาชื่อ หรืออีเมล..."
              className="flex-1 text-[13px] outline-none bg-transparent"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-1.5">
          {self && !q && renderRow(self, value === null, () => { onSelect(null); onClose(); }, true)}
          {filtered.length > 0 && (
            <p className="text-[10px] font-bold uppercase tracking-wider mt-1 mb-0.5" style={{ color: "var(--text-faint)" }}>
              เพื่อนร่วมแผนก ({filtered.length})
            </p>
          )}
          {filtered.map((c) => renderRow(c, value === c.staffId, () => { onSelect(c.staffId); onClose(); }, false))}
          {q && filtered.length === 0 && (
            <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
              ไม่พบ “{query}”
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
