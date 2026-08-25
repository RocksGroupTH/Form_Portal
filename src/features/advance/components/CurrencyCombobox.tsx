"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";

interface Opt {
  code: string;
  name: string;
}

/** Searchable currency dropdown — type to filter by code or name. */
export function CurrencyCombobox({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Opt[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = options.find((o) => o.code === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
    : options;

  const field = "w-full text-[13px] px-3 py-2 rounded-xl outline-none";
  const fieldStyle: React.CSSProperties = {
    background: "var(--bg-input, var(--bg-card))",
    color: "var(--text-primary)",
    border: "1px solid var(--border-card)",
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${field} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed`}
        style={fieldStyle}
      >
        <span className="truncate">{current ? `${current.code} — ${current.name}` : (value || "— เลือกสกุลเงิน —")}</span>
        <ChevronDown size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>

      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQuery(""); }} />
          <div
            className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden flex flex-col"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-card)" }}>
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหา code หรือชื่อ..."
                className="flex-1 text-[13px] outline-none bg-transparent"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
            <div className="max-h-56 overflow-auto py-1">
              {filtered.length === 0 ? (
                <p className="text-[12px] px-3 py-3 text-center" style={{ color: "var(--text-muted)" }}>ไม่พบสกุลเงิน</p>
              ) : (
                filtered.map((o) => {
                  const active = o.code === value;
                  return (
                    <button
                      key={o.code}
                      type="button"
                      onClick={() => { onChange(o.code); setOpen(false); setQuery(""); }}
                      className="w-full text-left px-3 py-2 text-[13px] cursor-pointer border-none flex items-center gap-2"
                      style={{
                        background: active ? "var(--nav-active-bg)" : "transparent",
                        color: active ? "var(--nav-active-text)" : "var(--text-primary)",
                      }}
                    >
                      <span className="font-bold w-[42px] shrink-0">{o.code}</span>
                      <span className="truncate" style={{ color: active ? "var(--nav-active-text)" : "var(--text-muted)" }}>{o.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
