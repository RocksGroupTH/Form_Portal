/**
 * Matching a city picked from Google against the managed จังหวัด/เมือง list.
 *
 * Imports nothing, so it is unit-tested with no environment and no map loaded.
 *
 * ── Why matching at all ──
 *
 * A hit stores the row's **id**, and the request keeps its place in the
 * report's by-province filter (`report-service.ts` filters on `ProvinceId`). A
 * miss stores the name as free text: still recorded, still on the report, just
 * outside that filter.
 *
 * ── Why whole names only ──
 *
 * A substring rule would file a trip to Londonderry under London, and the
 * report would then count it as a London trip with nothing on screen to
 * contradict it. Too eager is worse than too shy here: a miss costs a filter,
 * a false hit costs the truth of the row.
 */

export interface ProvinceMatchOption {
  id: number;
  nameTh: string;
  nameEn?: string | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * The city out of a Google suggestion.
 *
 * Google splits a prediction into a main text (the place) and a secondary one
 * (where it is) — "Chiang Mai" / "Thailand". The main text is the city; the
 * whole label is the fallback for a shape that has no split.
 */
export function cityNameFromPlace(
  mainText: string | null | undefined,
  fullLabel: string | null | undefined,
): string | null {
  const main = (mainText ?? "").trim();
  if (main) return main;
  const full = (fullLabel ?? "").trim();
  return full || null;
}

/**
 * The list row this place is, or null.
 *
 * The query is compared whole, and then EVERY comma-separated segment of it,
 * each still compared whole. Google puts the province at a different end
 * depending on the shape it hands back:
 *
 *   a city suggestion's text  → "Bangkok, Thailand"            (province first)
 *   a venue's secondary text  → "ถ.พระรามที่ 4, กรุงเทพมหานคร"  (province last)
 *
 * Trying only the first segment — which this did until the venue shape was
 * traced — matched nothing for any real place, because the first segment there
 * is a road. Nothing looser is tried even so: no prefix, no contains.
 */
export function matchProvinceOption(
  query: string | null | undefined,
  options: readonly ProvinceMatchOption[],
): ProvinceMatchOption | null {
  const full = norm(query);
  if (!full) return null;

  const wanted: string[] = [full];
  for (const part of full.split(",")) {
    const seg = norm(part);
    if (seg && wanted.indexOf(seg) === -1) wanted.push(seg);
  }

  for (const want of wanted) {
    for (const o of options) {
      const th = norm(o.nameTh);
      const en = norm(o.nameEn);
      // A row with no English name must not match on an empty string.
      if ((th && th === want) || (en && en === want)) return o;
    }
  }
  return null;
}
