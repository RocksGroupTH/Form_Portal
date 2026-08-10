import { safeBack, safePush } from "@/lib/safe-router";

/** Query param carrying the page to return to from travel-expense views. */
export const TRAVEL_FROM_PARAM = "from";
const DEFAULT_TRAVEL_RETURN = "/request";

/** Only allow same-origin relative paths (no protocol-relative URLs). */
export function resolveTravelReturnPath(
  from: string | null | undefined,
  fallback = DEFAULT_TRAVEL_RETURN,
): string {
  if (!from?.trim()) return fallback;
  const path = from.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

function appendFromParam(href: string, returnPath?: string): string {
  if (!returnPath) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}${TRAVEL_FROM_PARAM}=${encodeURIComponent(returnPath)}`;
}

/** Navigate back: explicit ?from= path, else browser history, else hub fallback. */
export function createTravelBackAction(
  router: { back: () => void; push: (href: string) => void },
  from: string | null | undefined,
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
    safePush(router, DEFAULT_TRAVEL_RETURN);
  };
}

export function travelExpenseEntryHref(returnPath?: string): string {
  return appendFromParam("/request/travel-expense", returnPath);
}

export function travelExpenseNewHref(returnPath?: string): string {
  return appendFromParam("/request/travel-expense?new=1", returnPath);
}

export function travelExpenseDetailHref(id: number, returnPath?: string): string {
  return appendFromParam(`/request/travel-expense/${id}`, returnPath);
}

export function travelExpenseFormHref(id: number, returnPath?: string): string {
  return appendFromParam(`/request/travel-expense?id=${id}`, returnPath);
}

export function travelExpenseHrefForRow(
  row: { id: number; status: string },
  opts: { showRequester: boolean; returnPath?: string },
): string {
  const openAsForm = !opts.showRequester && row.status === "Returned";
  return openAsForm
    ? travelExpenseFormHref(row.id, opts.returnPath)
    : travelExpenseDetailHref(row.id, opts.returnPath);
}
