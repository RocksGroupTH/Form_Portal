/**
 * The "open the document" button every notification carries, and the absolute
 * URL behind it.
 *
 * **A relative href in an email is a dead link.** It resolves against the mail
 * client, which is nowhere — there is no page for it to be relative to. AP-3
 * built its links that way (`<a href="/request/clear-advance/42">`) and every
 * one of them was unclickable in Outlook, on a phone, everywhere. That is the
 * failure this module exists to make unrepresentable: `documentUrl` returns
 * null rather than a relative string when it has no absolute base to build on,
 * and `documentButton` renders nothing for a null.
 *
 * A mail with no button is a small loss. A mail with a button that goes
 * nowhere is worse: the reader clicks, gets an error, and stops trusting the
 * next one.
 *
 * Pure and import-free — it takes the base URL as an argument rather than
 * reading `@/env`, so it is unit-tested without a live environment, and so the
 * caller decides which base applies.
 */

/** Attribute-safe escaping. Matches the `esc()` each mail template already uses. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The absolute URL of one request's page, or null when there is no usable base.
 *
 * `base` is `NEXT_PUBLIC_APP_URL`, which is allowed to be unset — `src/env.ts`
 * does not require it — so every caller has to cope with its absence. Returning
 * null is how that absence stays visible instead of becoming a broken link.
 */
export function documentUrl(
  base: string | null | undefined,
  path: string,
  id: number | string,
): string | null {
  const trimmed = (base ?? "").trim();
  // Absolute means it has a scheme and a host. A bare hostname, or a lone "/",
  // is exactly the input that used to produce a link going nowhere.
  if (!/^https?:\/\/.+/i.test(trimmed)) return null;
  return `${trimmed.replace(/\/+$/, "")}${path}/${id}`;
}

/** The button, or an empty string when there is no URL to point it at. */
export function documentButton(url: string | null): string {
  if (!url) return "";
  return (
    `<p style="margin-top:16px"><a href="${esc(url)}" ` +
    `style="background:#A3121B;color:#fff;padding:10px 18px;border-radius:6px;` +
    `text-decoration:none">เปิดเอกสาร</a></p>`
  );
}
