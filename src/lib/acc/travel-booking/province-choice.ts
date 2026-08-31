/**
 * Where a trip goes: a place from the managed list, or one the requester types.
 *
 * Imports nothing, so the client validator and the server writer can share it
 * without either dragging a pool into the other.
 *
 * ── Why both ──
 *
 * `TravelProvince` is the better answer where it has one: an id survives a
 * rename, the report filters on it, and the Rocks Fast sibling reads the same
 * rows. So a chosen id always wins and the typed text beside it is discarded.
 *
 * Free text exists because the list cannot be complete. Before this, a
 * requester travelling somewhere nobody had added met a required field whose
 * empty state told them to contact an administrator — which is a blocked form,
 * not a validation message.
 *
 * ── What the report loses, stated rather than discovered ──
 *
 * `report-service.ts` filters on `ProvinceId`, so a trip recorded as free text
 * matches no province filter — it is in the report, and it is not in a filtered
 * subset by province. That is the cost of not blocking the requester, and the
 * remedy is an admin adding the place at Settings → จังหวัด/เมือง, after which
 * later trips pick it from the list.
 */

/** `AccTravelBooking.ProvinceName` is NVARCHAR(100). */
export const PROVINCE_NAME_MAX = 100;

export interface ProvinceChoiceInput {
  provinceId?: number | null;
  provinceName?: string | null;
}

export interface ProvinceChoice {
  provinceId: number | null;
  /** Only ever set for a typed place; a listed one is named from the table. */
  provinceName: string | null;
  kind: "listed" | "typed" | "none";
}

/**
 * A typed place name, or null.
 *
 * An over-long value is **refused rather than truncated**: a clipped place name
 * reads as a real one, and the column would accept it silently. Inner whitespace
 * is left alone — "New York" is one name.
 */
export function sanitizeProvinceName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.length > PROVINCE_NAME_MAX) return null;
  return v;
}

export function resolveProvinceChoice(input: ProvinceChoiceInput): ProvinceChoice {
  const id = Number(input.provinceId);
  if (Number.isFinite(id) && id > 0) {
    // The name is left null on purpose: the server resolves it from
    // TravelProvince by id, so echoing the client's label back would let a
    // stale one overwrite a row somebody has since renamed.
    return { provinceId: id, provinceName: null, kind: "listed" };
  }
  const name = sanitizeProvinceName(input.provinceName);
  return name
    ? { provinceId: null, provinceName: name, kind: "typed" }
    : { provinceId: null, provinceName: null, kind: "none" };
}

/**
 * Has a destination been given at all — the question both validators ask.
 *
 * Defined in terms of `resolveProvinceChoice` rather than beside it, so the
 * gate and the write can never disagree about what counts as answered.
 */
export function provinceAnswered(input: ProvinceChoiceInput): boolean {
  return resolveProvinceChoice(input).kind !== "none";
}
