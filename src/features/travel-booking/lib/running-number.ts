/**
 * The shape of an Accounting running number, derived from the one place that
 * mints them.
 *
 * `allocateRequestNo` (`src/lib/acc/sequence.ts`) builds every running number
 * in this application as
 *
 * ```ts
 * `${prefix}${yy}-${String(seq).padStart(5, "0")}`
 * ```
 *
 * — a form-specific prefix, the last two digits of the calendar year, a dash,
 * and the sequence padded to five digits. `TRL26-00100`. **The two constants
 * below are that format's two widths and nothing else**, which is the whole
 * reason this module exists rather than a regex typed out at each site: the
 * one thing that must not happen is a reader changing the mint and leaving a
 * matcher somewhere agreeing with the old width.
 *
 * ## What uses it, and what deliberately does not
 *
 * AP-17's พักห้องเดียวกับ picker searches by running number, and since
 * 2026-09-23 it waits for a **complete** one before it asks the server. That
 * is two things at once:
 *
 * - a **fix**. The lookup is an exact match, so it fired at three characters
 *   and answered `ไม่พบคำขอเลขที่ TRL` at the moment somebody had typed `TRL`
 *   — a refusal shown for a number nobody had finished typing;
 * - a **mitigation the user approved** for the hosts endpoint's widening the
 *   same day. Running numbers are sequential, so a prefix-and-debounce search
 *   is a walk; one that only answers a fully-formed number is not a materially
 *   cheaper walk, but it does stop the endpoint being hit once per keystroke
 *   for free.
 *
 * **The server deliberately keeps no shape check of its own.** The by-number
 * lookup is `RequestNo = @no`, an exact match, so an incomplete string already
 * finds nothing — a shape check there would buy no narrowing and would only
 * add a second sentence the route could answer with, blurring the
 * `not_found` / `not_hostable` distinction that whole tab exists for.
 *
 * ## Case
 *
 * Matching is **case-insensitive**, and that is not laxity: this database's
 * collation is case-insensitive (CLAUDE.md records it measured for
 * `CK_ApiKey_CodeUpper`), so `trl26-00100` really does find the row. A
 * case-sensitive gate here would leave somebody typing in lower case watching
 * a search that never fires and never says why.
 *
 * Pure and import-free — the prefix is a parameter rather than an import of
 * `constants.ts`, so this is unit-tested in a `node:test` run and a second
 * form wanting the same rule needs no change here.
 */

/** Digits of the two-digit year `allocateRequestNo` embeds. */
export const RUNNING_NO_YEAR_DIGITS = 2;

/** Digits `allocateRequestNo` pads the sequence to (`padStart(5, "0")`). */
export const RUNNING_NO_SEQ_DIGITS = 5;

/**
 * The sequence used when this module has to *show* a running number rather
 * than test one. Illustrative only — it names no request.
 */
const EXAMPLE_SEQ = 100;

/**
 * Regex-escape the prefix.
 *
 * Every prefix in `src/` today is plain letters (`TRL`, `TOF`, `RBM`, …), so
 * this escapes nothing. It is here because the alternative is a module whose
 * correctness depends on a convention held somewhere else entirely — and the
 * failure would be silent, a prefix with a `.` in it matching any character.
 */
function escapeForRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The full-match pattern for one form's running numbers. */
export function requestNoPattern(prefix: string): RegExp {
  return new RegExp(
    `^${escapeForRegex(prefix)}\\d{${RUNNING_NO_YEAR_DIGITS}}-\\d{${RUNNING_NO_SEQ_DIGITS}}$`,
    "i",
  );
}

/**
 * Has somebody finished typing a running number of this form's shape?
 *
 * Trims first — a trailing space from a paste is not an incomplete number —
 * and answers false for anything else, including the empty string.
 */
export function isCompleteRequestNo(raw: string, prefix: string): boolean {
  return requestNoPattern(prefix).test(raw.trim());
}

/**
 * A running number of this form's shape, for placeholder and hint copy.
 *
 * Built from the same two widths the matcher uses and from the viewer's own
 * calendar year with **local getters** — `getFullYear()`, never
 * `toISOString()`, which names the previous year for the first seven hours of
 * every 1 January at UTC+7. Generated rather than typed out so the example
 * still reads `TRL27-…` in 2027, which matters: it is the thing a requester
 * copies the shape of.
 */
export function exampleRequestNo(prefix: string, now: Date): string {
  const yy = String(now.getFullYear()).slice(-RUNNING_NO_YEAR_DIGITS);
  return `${prefix}${yy}-${String(EXAMPLE_SEQ).padStart(RUNNING_NO_SEQ_DIGITS, "0")}`;
}
