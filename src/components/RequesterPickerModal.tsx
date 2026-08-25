"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
 * Popup picker for choosing the requester (ผู้ขอเบิก) — yourself, or anyone in the company,
 * to open a request on their behalf.
 *
 * It opens on the already-loaded department list, because that is who people file for almost
 * every time. Typing two characters hands the query to `searchEndpoint` instead: there are
 * 1,117 active employees, so the old arrangement — ship the list, filter it in the browser —
 * stopped being possible the moment the list left one department.
 *
 * Without `searchEndpoint` it behaves exactly as before, filtering `colleagues` locally. The
 * prop is optional so a caller with a genuinely small list does not have to stand up a route
 * to keep working.
 */
export function RequesterPickerModal({
  open,
  onClose,
  colleagues,
  self,
  value,
  onSelect,
  searchEndpoint,
}: {
  open: boolean;
  onClose: () => void;
  colleagues: RequesterOption[];
  /** The logged-in user, shown as the "ตัวฉันเอง" option at the top. */
  self: RequesterOption | null;
  /** Currently selected requester StaffId; null = self. */
  value: number | null;
  onSelect: (staffId: number | null) => void;
  /**
   * Where to send a typed query — the same route `colleagues` came from, which
   * answers `?q=` with matches from the whole active roster. Omit to keep the
   * old client-side filtering.
   */
  searchEndpoint?: string;
}) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<RequesterOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const q = query.trim().toLowerCase();
  const remoteMode = Boolean(searchEndpoint) && q.length >= 2;

  /**
   * Debounced lookup. `seq` is what makes a slow answer for "cha" unable to
   * overwrite a fast one for "chaiyen" — responses are not ordered, and the
   * only thing that can tell a stale one apart is the request that asked.
   */
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (!searchEndpoint || q.length < 2) {
      setRemote(null);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      const sep = searchEndpoint.indexOf("?") === -1 ? "?" : "&";
      fetch(`${searchEndpoint}${sep}q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((json) => {
          if (mine !== seq.current) return;
          setRemote(json?.ok ? (json.data?.colleagues ?? []) : []);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          // An empty list, not the department list: showing colleagues under a
          // query that did not run would look like "these are the matches".
          setRemote([]);
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [open, q, searchEndpoint]);

  // Reset between openings, or the next open flashes the previous search.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setRemote(null);
      setSearching(false);
    }
  }, [open]);

  const filtered = useMemo(
    () =>
      remoteMode
        ? (remote ?? [])
        : !q
          ? colleagues
          : colleagues.filter(
              (c) =>
                (c.fullName ?? "").toLowerCase().includes(q) ||
                (c.email ?? "").toLowerCase().includes(q) ||
                String(c.staffId).includes(q),
            ),
    [colleagues, q, remote, remoteMode],
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
      className="app-overlay fixed inset-0 z-[80] flex items-center justify-center p-4"
     
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
              placeholder={searchEndpoint ? "ค้นหาชื่อ อีเมล หรือรหัสพนักงาน (ทั้งบริษัท)..." : "ค้นหาชื่อ หรืออีเมล..."}
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
              {remoteMode ? `ผลการค้นหา (${filtered.length})` : `เพื่อนร่วมแผนก (${filtered.length})`}
            </p>
          )}
          {filtered.map((c) => renderRow(c, value === c.staffId, () => { onSelect(c.staffId); onClose(); }, false))}
          {searching && filtered.length === 0 && (
            <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
              กำลังค้นหา...
            </p>
          )}
          {/* One character with a server behind it is neither a search nor a
              filter — say which, rather than showing an empty list. */}
          {!searching && searchEndpoint && q.length === 1 && (
            <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
              พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาทั้งบริษัท
            </p>
          )}
          {!searching && q.length >= 2 && filtered.length === 0 && (
            <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
              ไม่พบ “{query}”
            </p>
          )}
          {/* Nobody else in the department. The picker still works — say so,
              rather than showing the requester's own row over blank space. */}
          {!searching && !q && filtered.length === 0 && (
            <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
              {searchEndpoint
                ? "ไม่มีเพื่อนร่วมแผนก — พิมพ์ชื่อเพื่อค้นหาทั้งบริษัท"
                : "ไม่มีเพื่อนร่วมแผนกให้เลือก"}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
