import type { NavItem } from "./constants";

/** What the Settings hub knows about whoever is looking at it. */
export interface SettingsCardViewer {
  /** `isSystemAdminRole(session.user.role)` — IT Admin alone is false. */
  isSystemAdmin: boolean;
  /**
   * The viewer is in UAT mode: `viewer.uatMode` from `/api/form-environment`,
   * which re-checks an active `UatTester` row beside the cookie, so it cannot
   * be forged client-side.
   *
   * Pass `false` while the payload is still loading or its fetch failed. That
   * is the direction the rule wants — PRO hides — and it can only ever hide a
   * link: every page behind a card re-decides access server-side.
   */
  isUatViewer: boolean;
}

/**
 * Which Settings hub cards this viewer sees.
 *
 * Two independent gates, ANDed: `systemAdminOnly` and `uatOnly`. A card
 * carrying both needs both, because they answer different questions — one is
 * a role, the other is which database the viewer is working in — and neither
 * implies the other.
 *
 * Pure, and its own module rather than an inline `.filter()` in the page:
 * `settings/page.tsx` is a client component reaching for `useSession` and
 * `useViewerUat`, so a predicate written inside it cannot be unit-tested at
 * all. Same split `viewer-controls.ts` and `reimburse/settings-tabs.ts` make.
 */
export function visibleSettingsCards(
  cards: NavItem[],
  viewer: SettingsCardViewer,
): NavItem[] {
  return cards.filter(
    (item) =>
      (!item.systemAdminOnly || viewer.isSystemAdmin) &&
      (!item.uatOnly || viewer.isUatViewer),
  );
}
