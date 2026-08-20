"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * The shared Entra ID people-picker used by the settings panels.
 *
 * Four private copies of this modal predate it — Users & Roles, AP-1's
 * `ApproverSettings`, `SameDayBrandSettings` and `UatUserSettings` — each with
 * a slightly different prop shape and, in two of them, raw hex where a theme
 * token belongs. This is the one new panels should import; the four are left
 * alone deliberately, since folding them in is a refactor of its own and each
 * carries small behavioural differences worth reading before they are merged.
 *
 * `onSelect` hands back the whole `ADResult` rather than a name/email pair, so
 * a caller that later needs the Entra object id or the department does not
 * have to widen this signature.
 */
export interface ADResult {
  id?: string | null;
  email: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  photo?: string | null;
}

export function ADSearchModal({
  title,
  subtitle,
  onClose,
  onSelect,
  existingEmails,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (user: ADResult) => void;
  /** Already on the list — shown as "เพิ่มแล้ว" and not selectable again. */
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
        else throw new Error(json.error || "ค้นหาไม่สำเร็จ");
      } catch (err) {
        setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const existing = new Set((existingEmails ?? []).map((e) => (e ?? "").toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--overlay-bg)" }}
    >
      <div
        className="rounded-2xl w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-card)",
          boxShadow: "var(--shadow-modal)",
          border: "1px solid var(--border-card)",
        }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>
              {title}
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {subtitle ?? "ค้นหาผู้ใช้จาก Microsoft Entra ID"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

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

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {query.trim().length < 2 ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา
              </p>
            </div>
          ) : searching ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                กำลังค้นหาใน Entra ID...
              </p>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-danger)" }}>
                {error}
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                ไม่พบผู้ใช้สำหรับ &quot;{query}&quot;
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: "var(--text-faint)" }}
              >
                {results.length} ผลลัพธ์
              </p>
              {results.map((u) => {
                const added = existing.has((u.email ?? "").toLowerCase());
                return (
                  <div
                    key={u.email}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{
                      border: `1px solid ${
                        added
                          ? "color-mix(in srgb, var(--status-ok-text) 30%, transparent)"
                          : "var(--border-card)"
                      }`,
                      background: added ? "var(--status-ok-bg)" : "var(--bg-card)",
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
                          background: added
                            ? "color-mix(in srgb, var(--status-ok-text) 20%, transparent)"
                            : "var(--nav-active-bg)",
                          color: added ? "var(--status-ok-text)" : "var(--nav-active-text)",
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
                        style={{ color: "var(--status-ok-text)", background: "var(--status-ok-bg)" }}
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
                        style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }}
                      >
                        + เลือก
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
