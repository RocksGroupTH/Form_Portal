/**
 * The inline style that widens a card from its page column to the viewport.
 *
 * Ported out of `src/features/reimburse/components/ReimburseForm.tsx`, where
 * AP-4 solved this first and still inlines it in JSX. AP-3's expense card wants
 * the same behaviour, and a second inline copy would be a second place to get
 * the centring wrong — so the arithmetic lives here, where a test can reach it.
 *
 * `viewportWidth` is `document.documentElement.clientWidth`, NOT
 * `window.innerWidth`: the difference between them is exactly the scrollbar,
 * and including it leaves the card a scrollbar's width too wide. The overflow
 * is clipped rather than scrolled, so the symptom is a quietly cropped right
 * edge rather than a visible page scrollbar.
 */

/** The gap left at each edge of a widened card. */
export const WIDE_INSET = 12;

export type WideCardStyle = { width: number; marginLeft: string };

/**
 * `undefined` means "render with no inline style" — the ordinary layout.
 *
 * It is returned for three different situations on purpose: not widened, not
 * measured yet, and a viewport too narrow to take the insets. All three want
 * the same thing, and a caller that had to tell them apart would be a caller
 * that could get one wrong.
 */
export function wideCardStyle(
  wide: boolean,
  viewportWidth: number | null,
): WideCardStyle | undefined {
  if (!wide || viewportWidth === null) return undefined;
  const width = viewportWidth - WIDE_INSET * 2;
  if (width <= 0) return undefined;
  return { width, marginLeft: `calc(50% - ${width / 2}px)` };
}
