import { Info } from "lucide-react";
import { REIMBURSE_NOTICE } from "@/features/reimburse/constants";

/**
 * AP-4's read-only notice panel — Accounting's own instructions, rendered
 * before any input (spec §5.1).
 *
 * Two things about it are load-bearing:
 *
 * 1. **The text is not ours.** `REIMBURSE_NOTICE` is the owner's verbatim Thai
 *    compliance copy — withholding-tax deadlines, the PR threshold, what may
 *    not be claimed, who receives the originals — restored character for
 *    character after a paraphrase was caught misstating who owes the Revenue
 *    Department what. It is displayed, never edited, re-wrapped or reformatted.
 * 2. **The whitespace is part of it.** Each of the six paragraphs carries
 *    embedded newlines, and the source also has a deliberate double space
 *    inside the first parenthetical and a leading space on the second line of
 *    the fourth block. HTML collapses all of that by default, which turns six
 *    blocks into six run-on lines.
 *
 * `whitespace-pre-wrap` rather than `pre-line`: both keep the newlines, but
 * `pre-line` still collapses runs of spaces and strips the space that leads a
 * wrapped line, so it would silently lose the two spacing details the review
 * verified byte for byte. `pre-wrap` keeps everything and still wraps on narrow
 * screens, which is what "do not tidy the spacing" actually requires.
 */
export function ReimburseNotice() {
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
        {REIMBURSE_NOTICE.map((paragraph, i) => (
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
