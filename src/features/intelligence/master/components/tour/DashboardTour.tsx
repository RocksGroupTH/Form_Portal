"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * In-app guided product tour. Walks the user through the dashboard's
 * controls one by one with a dimmed/blurred backdrop that EXCLUDES the
 * spotlight target — only "irrelevant" surrounding UI is blurred so the
 * highlighted control stays crisp and readable.
 *
 * The dimmed area is rendered as four panes (top / right / bottom /
 * left) framing a transparent rectangle around the target's bounding
 * box; this avoids SVG masks while still leaving the target untouched
 * by the blur filter.
 *
 * Steps can also run imperative actions when entered/exited
 * (`onEnter` / `onExit`) — the Export tour uses these to open the
 * Export modal automatically and switch tabs as the user advances.
 */
interface TourStep {
  /** CSS selector for the element to spotlight. Null = centered modal
   *  used for welcome / final-step messages. */
  selector: string | null;
  title: string;
  body: string;
  /** Whether this step expects the Export modal to be OPEN. The tour
   *  syncs the modal's open/close state to this flag every time the
   *  step changes — so going Back from a modal step closes the modal,
   *  going Forward re-opens it. */
  needsExportModal?: boolean;
  /** Which export tab this step should be on (summary | full).
   *  Only meaningful when needsExportModal is true. */
  exportTab?: "summary" | "full";
}

const STEPS: TourStep[] = [
  {
    selector: null,
    // {brand} is replaced at render time so the welcome step says
     // "ยินดีต้อนรับสู่ KSI Dashboard" when the user is browsing the
     // KSI brand, etc. Mirrors the multi-brand routing the rest of
     // the dashboard already supports.
    title: "ยินดีต้อนรับสู่ {brand} Dashboard",
    body: "พาทัวร์สั้นๆ ให้รู้จักทุกฟังก์ชันบนหน้านี้ — ใช้เวลาประมาณ 1-2 นาที กดปุ่ม ? ที่มุมล่างซ้ายได้ตลอดเพื่อเปิดทัวร์อีกครั้ง",
  },
  {
    selector: '[data-tour="theme-toggle"]',
    title: "สลับธีม Light / Dark",
    body: "คลิกเพื่อเปลี่ยนระหว่างโหมดสว่างและโหมดมืด ตามที่ตาคุณสบายในตอนนั้น",
  },
  {
    selector: '[data-tour="view-select"]',
    title: "เลือกมุมมอง (Select a View)",
    body: "เลือกว่ากราฟ Net Sales หลักจะ stack สีตามอะไร — Sale Channel, Sale Mode, Tender, Hourly, Category หรือ Item Name (รายการเมนู)",
  },
  {
    selector: '[data-tour="date-filter"]',
    title: "ช่วงเวลา (Date)",
    body: "เลือกเดือนที่ต้องการดูข้อมูล — default แสดง 3 เดือนล่าสุด เลือกหลายเดือนพร้อมกันได้",
  },
  {
    selector: '[data-tour="filter-panel"]',
    title: "Filter ตามคอลัมน์",
    body: "กรองข้อมูลด้วย Branch, Channel, Category, Payment Type, Menu Name ฯลฯ เลือกหลายค่าได้พร้อมกัน — ปุ่ม Clear ที่มุมขวาบนของกล่องนี้ล้างฟิลเตอร์ทั้งหมดในคลิกเดียว",
  },
  {
    selector: '[data-export-id="main-bar"]',
    title: "Net Sales รายวัน (กราฟหลัก)",
    body: "Hover ที่แท่งเพื่อดูยอดรวมของวันนั้น — คลิก bar ใดก็ได้เพื่อเปิด Breakdown panel ที่ลากย้ายได้, search ได้, scroll ได้ ดูรายละเอียดทุกรายการของวันนั้น",
  },
  {
    selector: '[data-export-id="branch-ads"]',
    title: "Branch ADS — MoM Growth %",
    body: "ตาราง ADS (Average Daily Sales) ต่อสาขา แยกตามเดือน + เปอร์เซ็นต์การเปลี่ยนแปลงเดือนต่อเดือน",
  },
  {
    selector: '[data-tour="export-button"]',
    title: "Export Data",
    body: "ปุ่มนี้จะเปิดหน้าต่าง Export — กดต่อ Next เพื่อให้เราเปิดให้ดูพร้อมพาทัวร์ภายในเลย",
  },
  {
    selector: '[data-tour="export-tab-summary"]',
    title: "แท็ป Summary",
    body: "สรุปข้อมูลตามเดือน เช่น KPI per month, ยอด NetSales แยกตาม view ที่เลือก — ดาวน์โหลดเป็น CSV หรือ XLSX",
    needsExportModal: true,
    exportTab: "summary",
  },
  {
    selector: '[data-tour="export-tab-full"]',
    title: "แท็ป Full Data",
    body: "ส่งออกข้อมูล raw rows ทั้งตาราง — เลือกฟิลด์ + ลากสลับลำดับคอลัมน์ได้ตามต้องการ",
    needsExportModal: true,
    exportTab: "full",
  },
  {
    selector: '[data-tour="export-period-picker"]',
    title: "เลือกช่วงเวลา (Period)",
    body: "เลือกได้ 3 แบบ: Monthly (เลือกเป็นเดือน), Weekly (สัปดาห์ ISO), Daily (ปฏิทินรายวัน คลิก = 1 วัน, Shift+คลิก = range). คลิกที่ chip นี้แล้วเลือกแท็บที่ต้องการ",
    needsExportModal: true,
    exportTab: "full",
  },
  {
    selector: '[data-tour="export-scope-toggle"]',
    title: "Filtered vs All data",
    body: "Filtered = ใช้ฟิลเตอร์เดียวกับ dashboard (Branch, Channel, Period ฯลฯ). All data = ดึงทุก row จาก database ไม่กรองอะไรเลย — ไฟล์ใหญ่และช้ากว่ามาก ใช้เฉพาะตอนต้องการ raw dump เท่านั้น",
    needsExportModal: true,
    exportTab: "full",
  },
  {
    selector: '[data-tour="export-preview-table"]',
    title: "ลากสลับคอลัมน์",
    body: "บนหัวตาราง preview แต่ละคอลัมน์มีสัญลักษณ์ ⋮⋮ — กดค้างที่ header แล้วลากไปทางซ้าย/ขวาเพื่อเปลี่ยนลำดับคอลัมน์ที่จะ export ลำดับใหม่จะถูกใช้ในไฟล์ที่ดาวน์โหลด",
    needsExportModal: true,
    exportTab: "full",
  },
  {
    selector: '[data-tour="export-reset-columns"]',
    title: "Reset Columns",
    body: "เคยลาก/เอา fields ออกแล้วอยากกลับ default? ปุ่มนี้กลับลำดับเดิม + เลือกครบทุกฟิลด์ในคลิกเดียว — ปุ่มจะ active เฉพาะตอนที่มีการแก้ไขเท่านั้น",
    needsExportModal: true,
    exportTab: "full",
  },
  {
    selector: null,
    title: "พร้อมใช้งานแล้ว",
    body: "เริ่มสำรวจข้อมูลของคุณได้เลย — ทุก filter จะเก็บใน URL bookmark/share ได้ และทัวร์นี้สามารถเปิดดูใหม่ได้จากปุ่ม ? ที่มุมล่างซ้าย",
  },
];

function isExportModalOpen(): boolean {
  return !!document.querySelector('[data-tour-close="export-modal"]');
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_GAP = 14;
const SPOTLIGHT_PAD = 6;

function clickFirst(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  el?.click();
}
function clickTabButton(dataTour: string) {
  const wrapper = document.querySelector<HTMLElement>(
    `[data-tour="${dataTour}"]`
  );
  // Tab wrappers contain a real <button> child — click it so React's
  // onClick fires.
  const btn = wrapper?.querySelector<HTMLElement>("button") ?? wrapper;
  btn?.click();
}
function closeExportModal() {
  document
    .querySelector<HTMLElement>('[data-tour-close="export-modal"]')
    ?.click();
}

export function DashboardTour({ brand }: { brand: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Floating launcher rendered via portal so its fixed-position
  // coordinates are anchored to the viewport, not the RightRail card
  // it used to live in. Keeps the FAB visible regardless of scroll.
  const launcher = (
    <span className="tour-fab-wrap">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="เปิดทัวร์การใช้งาน Dashboard"
        className="tour-fab"
      >
        <span aria-hidden className="tour-fab-icon">?</span>
      </button>
      <span className="tour-fab-tip" role="tooltip">
        ดูทัวร์การใช้งาน
        <span className="tour-fab-tip-sub">เริ่มต้นใน 1-2 นาที</span>
      </span>
    </span>
  );

  return (
    <>
      {mounted ? createPortal(launcher, document.body) : null}
      {open ? <TourOverlay brand={brand} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TourOverlay({ brand, onClose }: { brand: string; onClose: () => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Substitute `{brand}` placeholders in each step's title/body so
  // the welcome step (and any future brand-tagged copy) shows the
  // currently-selected brand instead of a hardcoded "UNO".
  const rawStep = STEPS[stepIdx];
  const step = {
    ...rawStep,
    title: rawStep.title.replace(/\{brand\}/g, brand),
    body: rawStep.body.replace(/\{brand\}/g, brand),
  };
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  // Sync the Export modal state to the current step every time it
  // changes. We do it in useLayoutEffect (BEFORE the measure effect)
  // so the modal is already open / on the right tab by the time we
  // try to find the spotlight target — fixes the bug where going
  // back from PDF→Reset Columns left the spotlight on the previous
  // tab's tab button instead of the (newly-mounted) Reset button.
  useLayoutEffect(() => {
    if (step.needsExportModal) {
      if (!isExportModalOpen()) {
        clickFirst('[data-tour="export-button"] button');
      }
      if (step.exportTab) {
        clickTabButton(`export-tab-${step.exportTab}`);
      }
    } else if (isExportModalOpen()) {
      closeExportModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  const cleanup = useCallback(() => {
    if (isExportModalOpen()) closeExportModal();
  }, []);

  const closeAll = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  // ESC closes; arrow keys navigate. Up/Down/PageUp/PageDown/Space/
  // Home/End are intercepted so the user can't scroll the page during
  // a tour — programmatic `scrollIntoView` calls inside the measure
  // effect aren't affected by these listeners (they only block user
  // input).
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
        else setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
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
  }, [isLast, closeAll]);

  // Lock page scroll while the tour is active. We use wheel +
  // touchmove preventDefault (instead of `position: fixed` on body)
  // so the tour's own `scrollIntoView` calls still work to bring
  // each step's target into view — only USER-driven scrolling is
  // blocked. `passive: false` is required for preventDefault to
  // take effect on wheel/touchmove.
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

  // Locate the spotlight target & re-measure on resize / scroll. We
  // poll for ~800ms after a step change because some targets (like
  // the Reset Columns button or preview table) only exist after the
  // modal/tab sync above has caused them to mount, AND their final
  // bounding rect can shift slightly as React commits the new tab's
  // layout. We also re-measure once after a 250ms delay to catch
  // those post-mount shifts.
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
          // `auto` (instant) instead of smooth — smooth-scroll
          // animates over ~250ms which would invalidate every rect
          // we measure during that window.
          el.scrollIntoView({ behavior: "auto", block: "center" });
        } catch {
          /* empty */
        }
        // Two RAF ticks: first lets React commit, second lets the
        // browser paint at the new scroll position.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => measureNow(el))
        );
        // Settle pass — re-measure once layout has fully stabilised.
        // Catches cases where a tab switch was still committing
        // when we did the first measurement.
        settleTimer = setTimeout(() => {
          if (cancelled) return;
          const el2 = document.querySelector(step.selector!);
          if (el2) measureNow(el2);
        }, 280);
        return;
      }
      // Element not yet in DOM — try again next frame, up to 800ms.
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
    else setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  }, [isLast, closeAll]);
  const back = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  if (!mounted) return null;

  // Compute the tooltip card position. If we have a target rect, anchor
  // below (or above when no room below). Otherwise center on screen.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let cardLeft: number;
  let cardTop: number;
  let cardArrow: "up" | "down" | "none" = "none";
  if (rect) {
    cardLeft = Math.max(
      8,
      Math.min(vw - TOOLTIP_WIDTH - 8, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2)
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

  // Spotlight cutout rect (with padding around target).
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

  // Lighter backdrop than the Dashboard reference's 55% dim — RocksFast
  // tends to render against a near-white page (many components are still
  // loading SWR data when the tour first opens) so 55% navy + 2px blur
  // looked like a solid gray wall that hid every supporting element.
  // 20% navy without blur keeps the surrounding context visible enough
  // for the user to recognise WHERE the spotlight target lives.
  const paneStyle: React.CSSProperties = {
    position: "fixed",
    background: "rgba(15,23,42,0.20)",
  };

  const node = (
    // `master-scope` ensures CSS variables (especially `--accent`)
    // resolve to the Master Dashboard palette (red-orange) instead of
    // the app-wide root default (blue) — the tour is portaled to
    // `document.body`, which sits OUTSIDE the MasterThemeProvider's
    // scope div, so without this class `var(--accent)` would pick up
    // the global blue.
    //
    // `background: transparent` overrides the opaque `var(--bg-base)`
    // that `.master-scope` paints by default — otherwise the tour root
    // covers the whole viewport with a solid light-gray fill and the
    // dashboard underneath becomes invisible even on the welcome step
    // where the spotlight panes haven't kicked in.
    <div
      className="master-scope fixed inset-0 z-[10100]"
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard tour"
      style={{ background: "transparent" }}
    >
      {sl ? (
        // 4-pane "frame" backdrop — leaves a transparent hole over the
        // target so the spotlighted control stays crisp & unblurred.
        <>
          <button
            type="button"
            aria-label="Close tour"
            onClick={closeAll}
            style={{
              ...paneStyle,
              left: 0,
              top: 0,
              right: 0,
              height: sl.top,
            }}
          />
          <button
            type="button"
            aria-label="Close tour"
            onClick={closeAll}
            style={{
              ...paneStyle,
              left: 0,
              top: slBottom,
              right: 0,
              bottom: 0,
            }}
          />
          <button
            type="button"
            aria-label="Close tour"
            onClick={closeAll}
            style={{
              ...paneStyle,
              left: 0,
              top: sl.top,
              width: sl.left,
              height: sl.height,
            }}
          />
          <button
            type="button"
            aria-label="Close tour"
            onClick={closeAll}
            style={{
              ...paneStyle,
              left: slRight,
              top: sl.top,
              right: 0,
              height: sl.height,
            }}
          />
        </>
      ) : (
        // No target — single full-screen dim. Same lighter overlay as
        // the 4-pane variant so the welcome / closing steps don't
        // suddenly turn the page solid gray.
        <button
          type="button"
          aria-label="Close tour"
          onClick={closeAll}
          className="absolute inset-0"
          style={{
            background: "rgba(15,23,42,0.20)",
          }}
        />
      )}

      {/* Spotlight ring — drawn ABOVE the panes for the orange outline
          but doesn't capture pointer events, so the user can still
          click the highlighted control if they want. */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg"
          style={{
            left: rect.left - SPOTLIGHT_PAD,
            top: rect.top - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow: "0 0 0 3px rgba(193,71,40,0.85)",
            transition: "all 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      ) : null}

      {/* Tooltip card */}
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
              left:
                Math.min(
                  TOOLTIP_WIDTH - 24,
                  Math.max(12, rect.left + rect.width / 2 - cardLeft - 6)
                ),
              top: cardArrow === "up" ? -7 : "auto",
              bottom: cardArrow === "down" ? -7 : "auto",
              borderTop:
                cardArrow === "down" ? "none" : "1px solid var(--border)",
              borderLeft:
                cardArrow === "down" ? "none" : "1px solid var(--border)",
              borderRight:
                cardArrow === "up" ? "none" : "1px solid var(--border)",
              borderBottom:
                cardArrow === "up" ? "none" : "1px solid var(--border)",
            }}
          />
        ) : null}
        <div className="px-4 pt-3.5 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[11px] uppercase tracking-[0.1em] font-semibold"
              style={{ color: "var(--accent)" }}
            >
              Step {stepIdx + 1} / {STEPS.length}
            </span>
            <button
              type="button"
              onClick={closeAll}
              aria-label="ปิดทัวร์"
              className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
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
            className="text-sm font-display font-semibold leading-tight"
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
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1 px-4 py-1 flex-wrap">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStepIdx(i)}
              aria-label={`ไปยังขั้นที่ ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIdx ? "w-5" : "w-1.5"
              }`}
              style={{
                background:
                  i === stepIdx
                    ? "var(--accent)"
                    : "var(--border-card)",
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
            Skip tour
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
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className="h-7 px-3 text-[12px] rounded-md font-semibold"
              style={{
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
