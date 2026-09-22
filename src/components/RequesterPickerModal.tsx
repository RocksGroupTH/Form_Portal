"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { RequesterPickerBody, type RequesterOption } from "@/components/RequesterPickerBody";

export type { RequesterOption };

/**
 * Popup picker for choosing the requester (ผู้ขอเบิก) — yourself, or anyone in the company,
 * to open a request on their behalf.
 *
 * **This is a frame, not an implementation.** The search box, the 220 ms
 * debounce, the `seq` staleness guard, the department list and the
 * whole-company `?q=` lookup all live in `RequesterPickerBody`, which AP-17's
 * พักห้องเดียวกับ picker renders *inline* on its own first tab rather than
 * stacking a second dialog on top of the one already open. One
 * implementation, two frames — spec §6 is explicit that the directory search
 * is not to be written twice.
 *
 * It opens on the already-loaded department list, because that is who people
 * file for almost every time. Typing two characters hands the query to
 * `searchEndpoint` instead: there are 1,117 active employees, so the old
 * arrangement — ship the list, filter it in the browser — stopped being
 * possible the moment the list left one department.
 *
 * Without `searchEndpoint` it behaves exactly as before, filtering `colleagues` locally. The
 * prop is optional so a caller with a genuinely small list does not have to stand up a route
 * to keep working.
 *
 * **Closing is this frame's business, and the body's rows do not do it.**
 * `onSelect` here still means "pick and dismiss", exactly as it always has for
 * every caller — the dismiss is composed on below, where the body reports a
 * bare choice.
 *
 * **The body is mounted only while the modal is open**, which is where its
 * query and its results now reset. That used to be an effect watching `open`;
 * it is the same behaviour, since this component already returned `null` — and
 * so unmounted the whole subtree — whenever it was closed.
 */
export function RequesterPickerModal({
  open,
  onClose,
  colleagues,
  self,
  value,
  onSelect,
  searchEndpoint,
  title = "เลือกผู้ขอเบิก",
  subtitle = "เลือกตัวเอง หรือเพื่อนร่วมแผนกเพื่อกรอกแทน",
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
  /**
   * Header copy, defaulted to the on-behalf wording every existing caller
   * relies on.
   */
  title?: string;
  subtitle?: string;
}) {
  if (!open || typeof document === "undefined") return null;

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
              {title}
            </h2>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              {subtitle}
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

        <RequesterPickerBody
          frame="modal"
          colleagues={colleagues}
          self={self}
          value={value}
          searchEndpoint={searchEndpoint}
          /* Pick AND dismiss, which is what every caller of this modal has
             always meant by `onSelect`. The body reports the bare choice
             because AP-17's inline frame stays open on it. */
          onSelect={(staffId) => {
            onSelect(staffId);
            onClose();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
