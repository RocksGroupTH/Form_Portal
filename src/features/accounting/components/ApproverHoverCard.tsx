"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";

/**
 * The people who may approve a request, as a card rather than a `title` string.
 *
 * It replaced a native tooltip on the `รออนุมัติโดย` cell the day after that
 * tooltip shipped (the user: *"ปรับ UI กล่องให้ดูดีและแสดงบันทัดละคนลงมา
 * เรื่อยๆ"*). The reason the native one had to go is the data: AP-17's booking
 * roster is **eight people**, and `title` renders them as one comma-joined line
 * that the browser wraps wherever it likes, after a delay the reader did not
 * ask for and with no styling available at all. One name per line is the
 * whole request, and a `title` cannot do it reliably.
 *
 * ## Why a portal and `position: fixed`
 *
 * The table scrolls horizontally (`overflow-x-auto`) and `.acc-theme` sets
 * `overflow-x: clip` besides, so a popover positioned inside the cell is
 * clipped by its own container — exactly where a wide table needs it most, at
 * the right-hand columns. Rendering into `document.body` at viewport
 * coordinates takes it out of every ancestor's overflow. The trade is that the
 * card does not follow a scroll, which is why it closes on one.
 *
 * ## It must not open the request
 *
 * The whole `<tr>` is a click target. Every pointer handler here stops
 * propagation, or reading who can approve would navigate away from the list.
 */
export function ApproverHoverCard({
  text,
  brandCode,
  names,
}: {
  /** What the cell shows — a department, usually. */
  text: string;
  brandCode: string | null | undefined;
  /** Empty is a real answer: the lookup worked and nobody can act. */
  names: string[];
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; flip: boolean } | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const CARD = 260;
    const estimated = 52 + names.length * 22;
    // Clamped so a right-hand column does not push it off screen, and flipped
    // above when the rows near the bottom would put it past the fold.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD - 8));
    const flip = r.bottom + estimated > window.innerHeight - 8;
    setAt({ left, top: flip ? r.top - 6 : r.bottom + 6, flip });
  };
  const close = () => setAt(null);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          e.stopPropagation();
          if (at) close();
          else open();
        }}
        className="inline-flex items-center gap-1 cursor-help outline-none"
        style={{ textDecoration: "underline dotted", textUnderlineOffset: 3 }}
      >
        {text}
        <Users size={11} style={{ color: "var(--text-faint)" }} aria-hidden />
      </span>

      {at &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onMouseEnter={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: at.left,
              top: at.top,
              transform: at.flip ? "translateY(-100%)" : undefined,
              width: 260,
              zIndex: 60,
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-modal)",
              padding: "10px 12px",
              pointerEvents: "none",
            }}
          >
            <div
              className="text-[10.5px] font-bold mb-1.5 flex items-center gap-1"
              style={{ color: "var(--text-muted)" }}
            >
              <Users size={11} aria-hidden />
              ผู้มีสิทธิ์อนุมัติ
              {brandCode ? (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                >
                  {brandCode}
                </span>
              ) : null}
            </div>

            {names.length === 0 ? (
              /* Not an error and not "loading" — the lookup worked and the
                 answer is nobody, which is the single most worth-saying thing
                 this card can say. */
              <div className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                ยังไม่มีผู้มีสิทธิ์อนุมัติ{brandCode ? `แบรนด์ ${brandCode}` : ""}
              </div>
            ) : (
              <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                {names.map((n) => (
                  <li
                    key={n}
                    className="text-[11.5px] leading-[1.5] truncate"
                    style={{ color: "var(--text-primary)" }}
                    title={n}
                  >
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
