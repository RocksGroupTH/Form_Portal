"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { ChevronDown, Search } from "lucide-react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  subLabel?: string | null;
  iconUrl?: string | null;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  borderColor?: string;
  triggerBackground?: string;
  disabled?: boolean;
  /** Show full label/subLabel (wrap) instead of truncating — use in narrow grid columns */
  wrapLabel?: boolean;
}

function OptionIcon({ url, code }: { url?: string | null; code?: string }) {
  const [failed, setFailed] = useState(false);
  const src = url?.trim();
  if (!src || failed) {
    const initials = (code ?? "?").slice(0, 2).toUpperCase();
    return (
      <span
        className="h-5 w-5 shrink-0 rounded flex items-center justify-center text-[8px] font-bold"
        style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}
      >
        {initials}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="h-5 w-5 shrink-0 object-contain rounded"
      onError={() => setFailed(true)}
    />
  );
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "เลือก...",
  emptyLabel = "— ไม่ map —",
  searchPlaceholder = "ค้นหา...",
  borderColor,
  triggerBackground,
  disabled = false,
  wrapLabel = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    mode: "fixed" | "dialog";
  } | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  const allOptions = useMemo(() => {
    const items: SearchableSelectOption[] = [{ value: "", label: emptyLabel }];
    for (const o of options) {
      if (o.value) items.push(o);
    }
    return items;
  }, [options, emptyLabel]);

  const selectedLabel = useMemo(() => {
    if (!value) return emptyLabel;
    const found = allOptions.find((o) => o.value === value);
    return found?.label ?? value;
  }, [value, allOptions, emptyLabel]);

  const selectedOption = useMemo(
    () => (value ? allOptions.find((o) => o.value === value) : undefined),
    [value, allOptions],
  );

  const selectedIconUrl = selectedOption?.iconUrl;
  const selectedSubLabel = selectedOption?.subLabel?.trim() || "";
  const selectedTitle = selectedOption
    ? [selectedOption.label, selectedSubLabel].filter(Boolean).join(" — ")
    : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [allOptions, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [filtered.length, query]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      setPortalRoot(null);
      return;
    }
    function place() {
      const trigger = triggerRef.current;
      const r = trigger?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 260);
      const dialog = trigger?.closest('[role="dialog"]') as HTMLElement | null;
      if (dialog) {
        const dr = dialog.getBoundingClientRect();
        const panelH = 280;
        let left = r.left - dr.left;
        let top = r.bottom - dr.top + 4;
        if (top + panelH > dr.height - 8) {
          top = r.top - dr.top - panelH - 4;
        }
        if (top < 8) top = 8;
        const overflow = left + width - dr.width + 8;
        if (overflow > 0) left = Math.max(8, left - overflow);
        setPortalRoot(dialog);
        setCoords({ top, left, width, mode: "dialog" });
        return;
      }
      let left = r.left;
      const overflow = left + width - window.innerWidth + 8;
      if (overflow > 0) left = Math.max(8, left - overflow);
      // Flip above the trigger when the panel would run off the bottom edge.
      const panelH = 300;
      let top = r.bottom + 4;
      if (top + panelH > window.innerHeight - 8) {
        const above = r.top - panelH - 4;
        top = above >= 8 ? above : Math.max(8, window.innerHeight - panelH - 8);
      }
      setPortalRoot(document.body);
      setCoords({ top, left, width, mode: "fixed" });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const pick = filtered[activeIdx];
        if (pick) {
          onChange(pick.value);
          setOpen(false);
        }
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, filtered, activeIdx, onChange]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  const resolvedBorder = borderColor ?? "var(--border-input)";

  const panelStyle: CSSProperties = coords?.mode === "dialog"
    ? {
        position: "absolute",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        zIndex: 100,
      }
    : {
        position: "fixed",
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        width: coords?.width ?? 260,
        zIndex: 100,
      };

  const panelBody = coords && (
    <div
      ref={panelRef}
      data-searchable-select-panel
      style={{
        ...panelStyle,
        background: "var(--bg-card)",
        borderColor: "var(--border-card)",
      }}
      className="rounded-xl overflow-hidden shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          borderBottomWidth: 1,
          borderBottomStyle: "solid",
          borderBottomColor: "var(--border-light)",
          background: "var(--bg-card-alt)",
        }}
      >
        <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 text-[12px] outline-none bg-transparent"
          style={{ color: "var(--text-primary)" }}
        />
      </div>
      <div className="max-h-56 overflow-y-auto py-1 scroll-thin">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-[12px] italic" style={{ color: "var(--text-muted)" }}>
            ไม่พบรายการ
          </div>
        ) : (
          filtered.map((o, i) => {
            const selected = o.value === value;
            const active = i === activeIdx;
            return (
              <button
                key={o.value || "__empty__"}
                type="button"
                onClick={() => pick(o.value)}
                onMouseEnter={() => setActiveIdx(i)}
                className="w-full text-left text-[12px] px-3 py-2 flex items-center justify-between gap-2 cursor-pointer border-none"
                style={{
                  background: active ? "var(--bg-hover)" : "transparent",
                  color: selected ? "var(--nav-active-text)" : "var(--text-primary)",
                  fontWeight: selected ? 600 : 400,
                }}
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  {o.value ? <OptionIcon url={o.iconUrl} code={o.value} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.subLabel?.trim() ? (
                      <span
                        className="block truncate text-[10px] font-normal mt-0.5"
                        style={{ color: selected ? "var(--nav-active-text)" : "var(--text-muted)", opacity: 0.9 }}
                      >
                        {o.subLabel}
                      </span>
                    ) : null}
                  </span>
                </span>
                {selected && (
                  <span aria-hidden style={{ color: "var(--nav-active-text)" }}>
                    ✓
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const portaledPanel = panelBody && portalRoot && coords && (
    coords.mode === "fixed" ? (
      <DismissableLayerBranch data-searchable-select-panel style={{ pointerEvents: "auto" }}>
        {panelBody}
      </DismissableLayerBranch>
    ) : (
      panelBody
    )
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full text-left rounded-xl px-3 outline-none transition-colors flex items-center justify-between gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: triggerBackground ?? "var(--bg-input)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: resolvedBorder,
          paddingTop: value && selectedSubLabel ? 6 : 10,
          paddingBottom: value && selectedSubLabel ? 6 : 10,
          minHeight: value && selectedSubLabel ? (wrapLabel ? 48 : 44) : 38,
        }}
        title={selectedTitle}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          {value ? <OptionIcon url={selectedIconUrl} code={value} /> : null}
          {value && selectedSubLabel ? (
            <span className="min-w-0 flex-1">
              <span
                className={`block text-[12px] font-medium leading-tight ${wrapLabel ? "break-words" : "truncate"}`}
              >
                {selectedLabel}
              </span>
              <span
                className={`block text-[10px] leading-snug mt-0.5 ${wrapLabel ? "break-words" : "truncate"}`}
                style={{ color: "var(--text-muted)" }}
              >
                {selectedSubLabel}
              </span>
            </span>
          ) : (
            <span className={`text-[13px] ${wrapLabel ? "break-words" : "truncate"}`}>
              {value ? selectedLabel : placeholder}
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>
      {mounted && portaledPanel ? createPortal(portaledPanel, portalRoot) : null}
    </div>
  );
}
