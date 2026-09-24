"use client";

import React from "react";
import type { MyRequestStatusDisplay, MyRequestStatusTone } from "@/lib/acc/my-request-view";

/**
 * **The status chip for My Requests and My Work — one vocabulary, one palette,
 * both views.**
 *
 * The user's instruction of 2026-09-24, in two parts: six distinct labels with
 * six distinct colours ("ปรับสีให้แตกต่างกัน"), and the list and the table
 * saying the same thing ("ใช้ชุดเดียวกัน") — toggling the view must not change
 * the word on a row.
 *
 * ## Why this is NOT `RequestStatusBadge`
 *
 * That one is Thai (`รออนุมัติ`, `อนุมัติแล้ว`), it collapses `Submitted` and
 * `ManagerApproved` into a single `รออนุมัติ`, and it is rendered by six other
 * surfaces — the AP-1 report, three detail pages, AP-3's control report and
 * AP-17's own badge. Re-pointing it would have changed all of those on the
 * strength of a request about two pages, so this is a second chip rather than
 * an edit to the first. **The duplication is deliberate and bounded**: if the
 * English vocabulary is later wanted everywhere, the move is to re-point
 * `RequestStatusBadge` at `statusDisplay` and delete this file — not to grow a
 * third.
 *
 * The labels and tones themselves live in `@/lib/acc/my-request-view`, which is
 * pure and tested; this file is only the colours and the markup.
 */
const STATUS_TONE: Record<MyRequestStatusTone, React.CSSProperties> = {
  /* Nobody has acted on it and nobody is waiting — the neutral draft
     tokens, which is what every other surface already paints a draft. */
  draft: {
    background: "var(--status-draft-bg)",
    color: "var(--status-draft-text)",
    border: "1px solid var(--border-light)",
  },
  submitted: {
    background: "var(--nav-active-bg)",
    color: "var(--nav-active-text)",
    border: "1px solid color-mix(in srgb, var(--nav-active-text) 25%, transparent)",
  },
  pending: {
    background: "var(--bg-info-yellow)",
    color: "var(--text-info-yellow)",
    border: "1px solid var(--border-info-yellow)",
  },
  complete: {
    background: "var(--bg-info-green)",
    color: "var(--text-info-green)",
    border: "1px solid var(--border-info-green)",
  },
  revise: {
    background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
    color: "var(--color-warning)",
    border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
  },
  rejected: {
    background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
    color: "var(--color-danger)",
    border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
  },
  cancelled: {
    background: "var(--bg-badge)",
    color: "var(--text-muted)",
    border: "1px solid var(--border-light)",
  },
  /* A status this app has never heard of — AP-11's `Ready` and `Received`, or
     one added later. Dashed rather than invisible: it renders its own raw
     value, and the border says the app does not recognise it. */
  other: {
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px dashed var(--border-light)",
  },
};

export function MyRequestStatusChip({ display }: { display: MyRequestStatusDisplay }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap inline-block"
      style={STATUS_TONE[display.tone]}
    >
      {display.label}
    </span>
  );
}
