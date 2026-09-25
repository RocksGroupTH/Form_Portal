/**
 * What a form's notice copy IS, as text: how it splits into bullets, how
 * `{เจ้าของฟอร์ม}` expands, and how long it may be.
 *
 * Pure and import-free but for `form-owner-text`, so every rule here is
 * unit-testable — anything reachable from a database pool drags `@/env` in,
 * which validates the whole environment at import and throws in the runner.
 *
 * It is the ONLY definition of what a bullet is. The five form renderers and
 * the settings editor's live preview all call it, so the preview cannot
 * disagree with the form.
 */
import { formatFormOwner, type FormOwnerRef } from "./form-owner-text";

/** The one token. There is deliberately no second, and no fuzzy matching. */
export const FORM_OWNER_TOKEN = "{เจ้าของฟอร์ม}";

export const MAX_MESSAGE_CHARS = 5000;
export const MAX_MESSAGE_BLOCKS = 20;
export const MAX_BLOCK_CHARS = 1000;

/**
 * Split a stored body into bullets.
 *
 * **A blank line separates two bullets; a single newline does not.** That rule
 * is not a matter of taste — `REIMBURSE_NOTICE`'s six compliance paragraphs
 * each contain single newlines, and a one-line-per-bullet rule would silently
 * re-render them as about fifteen bullets. Measured 2026-09-25, none of the
 * six contains a blank line, so this rule round-trips that notice exactly.
 *
 * Only each block's OUTER whitespace is trimmed: the leading space on the
 * fourth `REIMBURSE_NOTICE` block's second line is part of the owner's source
 * text and has to survive.
 */
export function parseFormMessage(body: string | null | undefined): string[] {
  if (!body) return [];
  const normalised = String(body).replace(/\r\n?/g, "\n");
  const out: string[] = [];
  for (const raw of normalised.split(/\n{2,}/)) {
    const block = raw.trim();
    if (block) out.push(block);
  }
  return out;
}

/**
 * Trailing punctuation left behind when the token expanded to nothing.
 *
 * `กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ` with the names removed has to read as
 * the bare sentence it read before anybody was named, not as a dangling colon
 * — which is what every form would show on the day migration 164 lands, since
 * 163 seeds no owners.
 */
function trimDanglingSeparator(block: string): string {
  return block.replace(/[\s:：·—–-]+$/, "");
}

/**
 * The bullets a reader actually sees: parsed, with every `{เจ้าของฟอร์ม}`
 * replaced by this form's owners.
 *
 * With no owners the token becomes empty, the dangling separator is trimmed,
 * and a block that was nothing but the token disappears entirely rather than
 * rendering as a blank bullet.
 */
export function expandFormMessage(
  body: string | null | undefined,
  owners: readonly FormOwnerRef[] | null | undefined,
): string[] {
  const names = (owners ?? [])
    .filter((o) => o.email?.trim())
    .map(formatFormOwner)
    .join(", ");

  const out: string[] = [];
  for (const block of parseFormMessage(body)) {
    if (block.indexOf(FORM_OWNER_TOKEN) === -1) {
      out.push(block);
      continue;
    }
    const replaced = block.split(FORM_OWNER_TOKEN).join(names);
    const cleaned = names ? replaced : trimDanglingSeparator(replaced);
    if (cleaned.trim()) out.push(cleaned);
  }
  return out;
}

/**
 * Why this body may not be saved, in Thai, or `null` when it may.
 *
 * **An empty body is legal** and means "this form shows no notice" — AP-2's and
 * AP-3's state on day one, and how an admin turns a box off.
 *
 * Every failure is a refusal rather than a truncation: silently cutting a
 * compliance paragraph in half is worse than making somebody shorten it.
 */
export function messageBodyProblem(body: string): string | null {
  const text = String(body ?? "");
  if (text.length > MAX_MESSAGE_CHARS) {
    return `ข้อความยาวเกินกำหนด (${text.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} ตัวอักษร)`;
  }
  const blocks = parseFormMessage(text);
  if (blocks.length > MAX_MESSAGE_BLOCKS) {
    return `มีข้อความย่อยเกิน ${MAX_MESSAGE_BLOCKS} ข้อ (ตอนนี้ ${blocks.length} ข้อ) — คั่นแต่ละข้อด้วยบรรทัดว่าง 1 บรรทัด`;
  }
  for (const b of blocks) {
    if (b.length > MAX_BLOCK_CHARS) {
      return `มีข้อความย่อยที่ยาวเกิน ${MAX_BLOCK_CHARS} ตัวอักษร`;
    }
  }
  return null;
}
