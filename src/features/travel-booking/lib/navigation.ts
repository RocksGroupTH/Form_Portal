import { safeBack, safePush } from "@/lib/safe-router";

/** Query param carrying the page to return to from travel-booking views. */
export const TRAVEL_BOOKING_FROM_PARAM = "from";
const DEFAULT_TRAVEL_BOOKING_RETURN = "/request/accounting";

/** Only allow same-origin relative paths (no protocol-relative URLs). */
export function resolveTravelBookingReturnPath(
  from: string | null | undefined,
  fallback = DEFAULT_TRAVEL_BOOKING_RETURN,
): string {
  if (!from?.trim()) return fallback;
  const path = from.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

function appendFromParam(href: string, returnPath?: string): string {
  if (!returnPath) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}${TRAVEL_BOOKING_FROM_PARAM}=${encodeURIComponent(returnPath)}`;
}

/**
 * Navigate back: explicit ?from= path, else browser history, else `fallback` (defaults to
 * the Accounting hub — the detail page passes `/request/travel-booking` instead so its
 * "back" reads as "back to the form/entry page" per the AP-17 detail-page brief).
 */
export function createTravelBookingBackAction(
  router: { back: () => void; push: (href: string) => void },
  from: string | null | undefined,
  fallback: string = DEFAULT_TRAVEL_BOOKING_RETURN,
): () => void {
  return () => {
    const path = from?.trim();
    if (path && path.startsWith("/") && !path.startsWith("//")) {
      safePush(router, path);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      safeBack(router);
      return;
    }
    safePush(router, fallback);
  };
}

/** Entry point — draft picker decides whether to resume a draft or start fresh. */
export function travelBookingEntryHref(returnPath?: string): string {
  return appendFromParam("/request/travel-booking", returnPath);
}

/** Skip the draft picker and start a brand-new (empty) submission. */
export function travelBookingNewHref(returnPath?: string): string {
  return appendFromParam("/request/travel-booking?new=1", returnPath);
}

/** Resume an existing draft group by its GroupKey. */
export function travelBookingFormHref(groupKey: string, returnPath?: string): string {
  return appendFromParam(`/request/travel-booking?groupKey=${encodeURIComponent(groupKey)}`, returnPath);
}

/** Where to land after a group finishes submitting (no single detail id — N documents). */
export function travelBookingAfterSubmitHref(returnPath?: string): string {
  return resolveTravelBookingReturnPath(returnPath);
}
