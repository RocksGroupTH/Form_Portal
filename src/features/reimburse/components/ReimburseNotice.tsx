"use client";

import { Info } from "lucide-react";
import { useFormMessage } from "@/lib/hooks/useFormMessage";

/**
 * AP-4's read-only notice panel — Accounting's own instructions, rendered
 * before any input (spec §5.1).
 *
 * **Since 2026-09-25 the copy is `Fast_Core.dbo.FormMessage` (migration 164),
 * edited at Settings → Message**, read through `useFormMessage("AP-4")`.
 * `REIMBURSE_NOTICE` (`@/features/reimburse/constants`) is the fallback the
 * service falls back to when that table is missing, and 164's own seed for
 * this form — see that constant's docblock. This component no longer imports
 * it directly; nothing here needs to.
 *
 * Two things about the copy are still load-bearing, unchanged by where it now
 * comes from:
 *
 * 1. **The text is not ours.** It is the owner's verbatim Thai compliance
 *    copy — withholding-tax deadlines, the PR threshold, what may not be
 *    claimed, who receives the originals — restored character for character
 *    after a paraphrase was caught misstating who owes the Revenue Department
 *    what. It is displayed, never edited, re-wrapped or reformatted.
 * 2. **The whitespace is part of it.** Each block carries embedded newlines,
 *    and the source also has a deliberate double space inside the first
 *    parenthetical and a leading space on the second line of the fourth
 *    block. HTML collapses all of that by default, which turns six blocks
 *    into six run-on lines.
 *
 * `whitespace-pre-wrap` rather than `pre-line`: both keep the newlines, but
 * `pre-line` still collapses runs of spaces and strips the space that leads a
 * wrapped line, so it would silently lose the two spacing details the review
 * verified byte for byte. `pre-wrap` keeps everything and still wraps on narrow
 * screens, which is what "do not tidy the spacing" actually requires.
 *
 * Renders nothing while the message is `[]` — loading, a failed fetch, or an
 * admin who has deliberately cleared the notice.
 */
export function ReimburseNotice() {
  const messageBlocks = useFormMessage("AP-4");
  if (messageBlocks.length === 0) return null;

  return (
    <div
      className="w-full min-w-0 rounded-2xl px-5 py-4 flex flex-col gap-3"
      style={{
        background: "var(--status-pending-bg)",
        color: "var(--status-pending-text)",
      }}
    >
      <div className="flex items-center gap-2">
        <Info size={15} className="shrink-0" />
        <p className="text-[13px] font-bold m-0">ข้อควรทราบก่อนเบิกค่าใช้จ่าย</p>
      </div>

      <div className="flex flex-col gap-2.5">
        {messageBlocks.map((paragraph, i) => (
          <p
            key={i}
            className="text-[12.5px] leading-relaxed m-0 whitespace-pre-wrap break-words"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
