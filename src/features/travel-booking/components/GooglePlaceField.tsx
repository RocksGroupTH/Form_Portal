"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin, Search } from "lucide-react";
import { GoogleMapsJsLoader } from "@/components/maps/GoogleMapsJsLoader";
import { usePlaceAutocomplete } from "@/components/maps/usePlaceAutocomplete";
import { errInputStyle, inputStyle } from "./shared";

/**
 * A place picked from Google Maps, committed as its label.
 *
 * ── Why the browser, and not a route ──
 *
 * The Google key this app holds is HTTP-referrer restricted. Measured
 * 2026-09-01, a server-side Places call answers 403
 * `API_KEY_HTTP_REFERRER_BLOCKED`, so there is no `/api/...` to put this behind
 * the way `OrsPlaceField` sits behind `/api/ors/geocode`. Google's Maps JS runs
 * in the page with the key that referrer restriction protects, which is the
 * arrangement AP-1's route picker has used all along.
 *
 * ── Typed text is always committable ──
 *
 * Google may be unreachable, the key may be misconfigured, or a place may
 * simply not be in it. The input commits what is typed on blur or Enter, so
 * this field never becomes the reason a request cannot be filed — the same
 * property `OrsPlaceField` has, and the reason ข้อ8 stopped being a blocked
 * field in the first place.
 */
export function GooglePlaceField({
  value,
  onChange,
  onSelectPlace,
  cities,
  country,
  hasError,
  placeholder = "พิมพ์ค้นหาสถานที่จาก Google Maps...",
}: {
  value: string | null;
  onChange: (name: string | null) => void;
  /**
   * The picked suggestion, in its three parts.
   *
   * `mainText` is the PLACE'S OWN NAME ("โรงแรมดุสิตธานี"); `secondaryText` is
   * where it is ("ถนนพระรามที่ 4, กรุงเทพมหานคร"). A caller deriving a province
   * wants the second — passing the first found nothing for every real place,
   * which is the bug this signature exists to make impossible to repeat.
   */
  onSelectPlace?: (place: {
    mainText: string | null;
    secondaryText: string | null;
    label: string;
  }) => void;
  /** Narrow Google to cities, for a จังหวัด/เมือง picker. */
  cities?: boolean;
  /**
   * ISO-3166-1 alpha-2 to search inside — the trip's own country.
   *
   * Omitted, the whole world. This restores what the ORS version of this field
   * had (`boundary.country`) and which was dropped when it moved to Google.
   */
  country?: string | null;
  hasError?: boolean;
  placeholder?: string;
}) {
  return (
    <GoogleMapsJsLoader
      loadingFallback={
        <div
          className="w-full rounded-xl px-3 py-2.5 text-[13px] flex items-center gap-2"
          style={{ ...inputStyle, color: "var(--text-faint)" }}
        >
          <Loader2 size={14} className="animate-spin" /> กำลังโหลดแผนที่...
        </div>
      }
      // No key configured is not a dead field. It becomes a plain input that
      // commits what is typed — the same answer the "ใช้ …" row gives when
      // Google is reachable but has never heard of somewhere.
      unconfiguredFallback={
        <PlainInput
          value={value}
          onChange={onChange}
          hasError={hasError}
          placeholder="พิมพ์ชื่อสถานที่..."
        />
      }
    >
      {({ isLoaded }) => (
        <Inner
          isLoaded={isLoaded}
          value={value}
          onChange={onChange}
          onSelectPlace={onSelectPlace}
          cities={cities}
          country={country}
          hasError={hasError}
          placeholder={placeholder}
        />
      )}
    </GoogleMapsJsLoader>
  );
}

/** The field with no Google behind it: type, and what you typed is the answer. */
function PlainInput({
  value,
  onChange,
  hasError,
  placeholder,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
  hasError?: boolean;
  placeholder: string;
}) {
  return (
    <input
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => onChange(e.target.value.trim() || null)}
      className="w-full text-[13px] rounded-xl px-3 py-2.5 outline-none"
      style={{ ...inputStyle, ...errInputStyle(!!hasError) }}
    />
  );
}

function Inner({
  isLoaded,
  value,
  onChange,
  onSelectPlace,
  cities,
  country,
  hasError,
  placeholder,
}: {
  isLoaded: boolean;
  value: string | null;
  onChange: (name: string | null) => void;
  onSelectPlace?: (place: {
    mainText: string | null;
    secondaryText: string | null;
    label: string;
  }) => void;
  cities?: boolean;
  country?: string | null;
  hasError?: boolean;
  placeholder: string;
}) {
  const ac = usePlaceAutocomplete(isLoaded, {
    includedPrimaryTypes: cities ? ["(cities)"] : undefined,
    regionCode: country,
  });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(
    null,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Show the committed value when idle, the typed query while searching.
  const inputValue = open ? ac.query : value ?? "";

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = r.bottom + 4;
    setPos({
      top,
      left: r.left,
      width: r.width,
      maxH: Math.max(140, Math.min(300, window.innerHeight - top - 12)),
    });
  }, [open, ac.query, ac.suggestions.length]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      // Closing commits what was typed: somebody who types a place Google does
      // not offer and clicks away has still answered the field.
      commitTyped();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ac.query]);

  function commitTyped() {
    const typed = ac.query.trim();
    if (typed) onChange(typed);
  }

  function take(s: google.maps.places.AutocompleteSuggestion) {
    const p = s.placePrediction;
    if (!p) return;
    const label = p.text?.toString() ?? "";
    const mainText = p.mainText?.toString() ?? null;
    const secondaryText = p.secondaryText?.toString() ?? null;
    onChange(label || null);
    onSelectPlace?.({ mainText, secondaryText, label });
    // Ends the billing session — the next keystroke starts a new one.
    ac.resetToken();
    ac.setQuery("");
    setOpen(false);
  }

  return (
    <div ref={anchorRef} className="relative">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--text-faint)" }}
        />
        <input
          value={inputValue}
          placeholder={placeholder}
          onFocus={() => {
            ac.setQuery(value ?? "");
            setOpen(true);
          }}
          onChange={(e) => {
            setOpen(true);
            ac.handleInputChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyped();
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full text-[13px] rounded-xl pl-9 pr-3 py-2.5 outline-none"
          style={{ ...inputStyle, ...errInputStyle(!!hasError) }}
        />
      </div>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 60,
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              borderRadius: "var(--radius-tile)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="overflow-y-auto py-1" style={{ maxHeight: pos.maxH }}>
              {ac.loading && (
                <p
                  className="px-3 py-2 text-[12.5px] flex items-center gap-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Loader2 size={13} className="animate-spin" /> กำลังค้นหา...
                </p>
              )}
              {!ac.loading &&
                ac.suggestions.map((s, i) => {
                  const p = s.placePrediction;
                  if (!p) return null;
                  return (
                    <button
                      key={p.placeId ?? i}
                      type="button"
                      onClick={() => take(s)}
                      className="w-full flex items-start gap-2 px-3 py-2 text-left cursor-pointer border-none text-[13px]"
                      style={{ background: "transparent", color: "var(--text-primary)" }}
                    >
                      <MapPin
                        size={13}
                        className="shrink-0 mt-0.5"
                        style={{ color: "var(--text-faint)" }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.mainText?.toString()}</span>
                        {p.secondaryText && (
                          <span
                            className="block truncate text-[11px]"
                            style={{ color: "var(--text-faint)" }}
                          >
                            {p.secondaryText.toString()}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              {/* Always offered, never only on an empty result: Google being
                  unreachable, or simply not having somewhere, must not make this
                  field the reason a request cannot be filed. */}
              {!ac.loading && ac.query.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    commitTyped();
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none text-[13px]"
                  style={{
                    background: "transparent",
                    color: "var(--nav-active-text)",
                    borderTop: ac.suggestions.length > 0 ? "1px solid var(--border-light)" : undefined,
                  }}
                >
                  <span className="w-[13px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">ใช้ &quot;{ac.query.trim()}&quot;</span>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
