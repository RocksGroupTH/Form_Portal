/**
 * Getting back to where you came from in the Request hub.
 *
 * The hub renders the same cards twice over: the full page at `/request`, and
 * the management-only view Settings → Accounting Admin opens. A management
 * page's Back button therefore has two possible destinations, and only the
 * link that got you there knows which — so the card tags its href, and the
 * destination reads the tag.
 */

/** The Request hub narrowed to its management cards. */
export const REQUEST_ADMIN_HREF = "/request?group=Settings";

/** Tag a card's destination with where the user is coming from. */
export function withRequestReturn(href: string, from: "admin"): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=${from}`;
}

/**
 * Carry the tag one level deeper.
 *
 * The tag has to survive every hop, not just the first: Accounting Admin →
 * AP-1 → its approval queue is three pages, and Back from the queue has to
 * walk the same three back. Each page passes the tag it was given to the links
 * it renders, and reads it again to build its own Back.
 */
export function withReturnTag(href: string, from: string | null | undefined): string {
  return from === "admin" ? withRequestReturn(href, "admin") : href;
}

/** Back target for a page reached directly from the Request hub. */
export function requestBackHref(from: string | null | undefined): string {
  return from === "admin" ? REQUEST_ADMIN_HREF : "/request";
}

/** Back target for a page below the hub: its parent, tag intact. */
export function backTo(parentPath: string, from: string | null | undefined): string {
  return withReturnTag(parentPath, from);
}
