"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface GuidedTourStep {
  selector: string | null;
  title: string;
  body: string;
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_GAP = 14;
const SPOTLIGHT_PAD = 6;

export function GuidedTourFab({
  onOpen,
  ariaLabel = "เปิดทัวร์การใช้งาน",
  tipTitle = "ดูทัวร์การใช้งาน",
  tipSub = "เริ่มต้นใน 1-2 นาที",
}: {
  onOpen: () => void;
  ariaLabel?: string;
  tipTitle?: string;
  tipSub?: string;
}) {
  return (
    <span className="tour-fab-wrap">
      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className="tour-fab"
      >
        <span aria-hidden className="tour-fab-icon">?</span>
      </button>
      <span className="tour-fab-tip" role="tooltip">
        {tipTitle}
        <span className="tour-fab-tip-sub">{tipSub}</span>
      </span>
    </span>
  );
}

export function GuidedTourOverlay({
  steps,
  onClose,
  ariaLabel = "Guided tour",
  scopeClassName = "",
  accentCss = "var(--accent)",
  ringColor = "rgba(193,71,40,0.85)",
  formatStep,
  onBeforeStep,
  onCloseCleanup,
}: {
  steps: GuidedTourStep[];
  onClose: () => void;
  ariaLabel?: string;
  scopeClassName?: string;
  accentCss?: string;
  ringColor?: string;
  formatStep?: (step: GuidedTourStep, stepIdx: number) => GuidedTourStep;
  onBeforeStep?: (stepIdx: number, step: GuidedTourStep) => void;
  onCloseCleanup?: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rawStep = steps[stepIdx];
  const step = formatStep ? formatStep(rawStep, stepIdx) : rawStep;
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;

  useLayoutEffect(() => {
    onBeforeStep?.(stepIdx, rawStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  const closeAll = useCallback(() => {
    onCloseCleanup?.();
    onClose();
  }, [onClose, onCloseCleanup]);

  useEffect(() => {
    const SCROLL_KEYS = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar",
    ]);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeAll();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (isLast) closeAll();
        else setStepIdx((i) => Math.min(steps.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowLeft") {
        setStepIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (SCROLL_KEYS.has(e.key)) {
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isLast, closeAll, steps.length]);

  useEffect(() => {
    function block(e: Event) {
      e.preventDefault();
    }
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    window.addEventListener("wheel", block, opts);
    window.addEventListener("touchmove", block, opts);
    return () => {
      window.removeEventListener("wheel", block, opts);
      window.removeEventListener("touchmove", block, opts);
    };
  }, []);

  useLayoutEffect(() => {
    if (!step.selector) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const start = performance.now();
    function measureNow(el: Element) {
      if (cancelled) return;
      setRect(el.getBoundingClientRect());
    }
    function tryMeasure() {
      if (cancelled) return;
      const el = document.querySelector(step.selector!);
      if (el) {
        try {
          el.scrollIntoView({ behavior: "auto", block: "center" });
        } catch {
          /* empty */
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => measureNow(el)),
        );
        settleTimer = setTimeout(() => {
          if (cancelled) return;
          const el2 = document.querySelector(step.selector!);
          if (el2) measureNow(el2);
        }, 280);
        return;
      }
      if (performance.now() - start < 800) {
        requestAnimationFrame(tryMeasure);
      } else {
        setRect(null);
      }
    }
    tryMeasure();
    function reMeasure() {
      const el = document.querySelector(step.selector!);
      if (el) setRect(el.getBoundingClientRect());
    }
    window.addEventListener("resize", reMeasure);
    window.addEventListener("scroll", reMeasure, true);
    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      window.removeEventListener("resize", reMeasure);
      window.removeEventListener("scroll", reMeasure, true);
    };
  }, [step.selector]);

  const next = useCallback(() => {
    if (isLast) closeAll();
    else setStepIdx((i) => Math.min(steps.length - 1, i + 1));
  }, [isLast, closeAll, steps.length]);
  const back = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  if (!mounted) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let cardLeft: number;
  let cardTop: number;
  let cardArrow: "up" | "down" | "none" = "none";
  if (rect) {
    cardLeft = Math.max(
      8,
      Math.min(vw - TOOLTIP_WIDTH - 8, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2),
    );
    const spaceBelow = vh - rect.bottom;
    if (spaceBelow > 220) {
      cardTop = rect.bottom + TOOLTIP_GAP;
      cardArrow = "up";
    } else {
      cardTop = Math.max(8, rect.top - TOOLTIP_GAP - 200);
      cardArrow = "down";
    }
  } else {
    cardLeft = vw / 2 - TOOLTIP_WIDTH / 2;
    cardTop = Math.max(80, vh / 2 - 140);
  }

  const sl = rect
    ? {
        left: Math.max(0, rect.left - SPOTLIGHT_PAD),
        top: Math.max(0, rect.top - SPOTLIGHT_PAD),
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }
    : null;
  const slRight = sl ? sl.left + sl.width : 0;
  const slBottom = sl ? sl.top + sl.height : 0;

  const paneStyle: React.CSSProperties = {
    position: "fixed",
    background: "rgba(15,23,42,0.20)",
  };

  const node = (
    <div
      className={`${scopeClassName} fixed inset-0 z-[10100]`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{ background: "transparent" }}
    >
      {sl ? (
        <>
          <button type="button" aria-label="Close tour" onClick={closeAll} style={{ ...paneStyle, left: 0, top: 0, right: 0, height: sl.top }} />
          <button type="button" aria-label="Close tour" onClick={closeAll} style={{ ...paneStyle, left: 0, top: slBottom, right: 0, bottom: 0 }} />
          <button type="button" aria-label="Close tour" onClick={closeAll} style={{ ...paneStyle, left: 0, top: sl.top, width: sl.left, height: sl.height }} />
          <button type="button" aria-label="Close tour" onClick={closeAll} style={{ ...paneStyle, left: slRight, top: sl.top, right: 0, height: sl.height }} />
        </>
      ) : (
        <button
          type="button"
          aria-label="Close tour"
          onClick={closeAll}
          className="absolute inset-0"
          style={{ background: "rgba(15,23,42,0.20)" }}
        />
      )}

      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg"
          style={{
            left: rect.left - SPOTLIGHT_PAD,
            top: rect.top - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow: `0 0 0 3px ${ringColor}`,
            transition: "all 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      ) : null}

      <div
        className="absolute rounded-xl shadow-2xl"
        style={{
          left: cardLeft,
          top: cardTop,
          width: TOOLTIP_WIDTH,
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          transition: "all 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {cardArrow !== "none" && rect ? (
          <span
            aria-hidden
            className="absolute h-3 w-3 rotate-45"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              left: Math.min(
                TOOLTIP_WIDTH - 24,
                Math.max(12, rect.left + rect.width / 2 - cardLeft - 6),
              ),
              top: cardArrow === "up" ? -7 : "auto",
              bottom: cardArrow === "down" ? -7 : "auto",
              borderTop: cardArrow === "down" ? "none" : "1px solid var(--border)",
              borderLeft: cardArrow === "down" ? "none" : "1px solid var(--border)",
              borderRight: cardArrow === "up" ? "none" : "1px solid var(--border)",
              borderBottom: cardArrow === "up" ? "none" : "1px solid var(--border)",
            }}
          />
        ) : null}
        <div className="px-4 pt-3.5 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[11px] uppercase tracking-[0.1em] font-semibold"
              style={{ color: accentCss }}
            >
              ขั้นที่ {stepIdx + 1} / {steps.length}
            </span>
            <button
              type="button"
              onClick={closeAll}
              aria-label="ปิดทัวร์"
              className="h-6 w-6 inline-flex items-center justify-center rounded"
              style={{ color: "var(--text-muted)" }}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </div>
          <div
            className="text-sm font-semibold leading-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {step.title}
          </div>
          <p
            className="text-[12px] mt-1.5 leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            {step.body}
          </p>
        </div>
        <div className="flex items-center justify-center gap-1 px-4 py-1 flex-wrap">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStepIdx(i)}
              aria-label={`ไปยังขั้นที่ ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === stepIdx ? "w-5" : "w-1.5"}`}
              style={{
                background: i === stepIdx ? accentCss : "var(--border-card)",
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-1">
          <button
            type="button"
            onClick={closeAll}
            className="text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            ข้ามทัวร์
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={back}
              disabled={isFirst}
              className="h-7 px-2.5 text-[12px] rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--bg-card)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-card)",
              }}
            >
              ย้อนกลับ
            </button>
            <button
              type="button"
              onClick={next}
              className="h-7 px-3 text-[12px] rounded-md font-semibold"
              style={{
                background: accentCss,
                color: "#fff",
              }}
            >
              {isLast ? "เสร็จแล้ว" : "ถัดไป"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
