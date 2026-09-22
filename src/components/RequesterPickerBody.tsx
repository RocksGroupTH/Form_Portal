"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { Avatar } from "@/components/ui";

export interface RequesterOption {
  staffId: number;
  fullName: string | null;
  position?: string | null;
  departmentName?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  bankAccountNo?: string | null;
}

/**
 * Which frame this body is being rendered inside — and the only thing that
 * differs between them.
 *
 * - `modal` reproduces `RequesterPickerModal`'s own layout **exactly**: a
 *   `shrink-0` search band above a `flex-1` scroller, which is what makes the
 *   search stay put inside a fixed-height dialog.
 * - `inline` renders both regions as ordinary blocks with no scroller of
 *   their own, so whatever container the caller already has — AP-17's
 *   room-share dialog, whose body is a single `overflow-y-auto` column — does
 *   the scrolling. A nested scroller there would mean two scroll regions
 *   stacked inside one 90vh dialog on a phone, and height math that has to be
 *   right at every viewport; one container has neither problem.
 */
export type RequesterPickerFrame = "modal" | "inline";

/**
 * **The person search itself — the search box, the debounce, the department
 * list and the whole-company `?q=` lookup — with no frame around it.**
 *
 * Extracted from `RequesterPickerModal` on 2026-09-22 so that AP-17's
 * พักห้องเดียวกับ picker can render it *inline* on its own first tab instead
 * of stacking a second dialog on top of the one already open (the user:
 * "อยากปรับให้ 2 หน้านี้รวมกัน"). One implementation, two frames — the
 * alternative was a second copy of the `seq` staleness guard and the 220 ms
 * debounce, which is exactly what spec §6 says must not be written twice.
 *
 * It opens on the already-loaded department list, because that is who people
 * file for almost every time. Typing two characters hands the query to
 * `searchEndpoint` instead: there are 1,117 active employees, so the old
 * arrangement — ship the list, filter it in the browser — stopped being
 * possible the moment the list left one department.
 *
 * Without `searchEndpoint` it behaves exactly as before, filtering
 * `colleagues` locally. The prop is optional so a caller with a genuinely
 * small list does not have to stand up a route to keep working.
 *
 * **This component owns no "is it showing" state, and must not gain one.**
 * It is mounted while it is visible and unmounted when it is not, so the
 * query, the fetched results and the `seq` counter reset by unmounting. That
 * replaced an `open`-prop reset effect, and it is what lets the two frames
 * share it: the modal frame returns `null` when closed, and the inline frame
 * renders it only on the step that shows it — neither has to remember to
 * clear anything.
 */
export function RequesterPickerBody({
  colleagues,
  self,
  value,
  onSelect,
  searchEndpoint,
  frame = "modal",
  autoFocusSearch = true,
}: {
  colleagues: RequesterOption[];
  /** The logged-in user, shown as the "ตัวฉันเอง" option at the top. */
  self: RequesterOption | null;
  /** Currently selected requester StaffId; null = self. */
  value: number | null;
  /**
   * A row was pressed. **This body does not close anything** — the frame
   * decides what a choice means, because the two frames disagree: the modal
   * dismisses itself, while AP-17's inline tab moves on to the chosen
   * person's request list without closing its dialog.
   */
  onSelect: (staffId: number | null) => void;
  /**
   * Where to send a typed query — the same route `colleagues` came from, which
   * answers `?q=` with matches from the whole active roster. Omit to keep the
   * old client-side filtering.
   */
  searchEndpoint?: string;
  frame?: RequesterPickerFrame;
  /**
   * Focus the search box on mount. On in both frames today; a prop rather
   * than a literal because a future caller embedding this below other fields
   * would be stealing focus from them.
   */
  autoFocusSearch?: boolean;
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
  }, [q, searchEndpoint]);

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

  const modalFrame = frame === "modal";

  return (
    <>
      {/* Search */}
      <div className={modalFrame ? "px-5 py-3 shrink-0" : "shrink-0"}>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            autoFocus={autoFocusSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchEndpoint ? "ค้นหาชื่อ อีเมล หรือรหัสพนักงาน (ทั้งบริษัท)..." : "ค้นหาชื่อ หรืออีเมล..."}
            className="flex-1 text-[13px] outline-none bg-transparent"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
      </div>

      {/* List */}
      <div
        className={
          modalFrame
            ? "flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-1.5"
            : "flex flex-col gap-1.5"
        }
      >
        {self && !q && renderRow(self, value === null, () => onSelect(null), true)}
        {filtered.length > 0 && (
          <p className="text-[10px] font-bold uppercase tracking-wider mt-1 mb-0.5" style={{ color: "var(--text-faint)" }}>
            {remoteMode ? `ผลการค้นหา (${filtered.length})` : `เพื่อนร่วมแผนก (${filtered.length})`}
          </p>
        )}
        {filtered.map((c) => renderRow(c, value === c.staffId, () => onSelect(c.staffId), false))}
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
    </>
  );
}
