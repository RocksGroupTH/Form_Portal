import { NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { resolveBookingBrandAccess } from "@/lib/acc/travel-booking/booking-approver-brands";
import {
  BOOKING_BRAND_SCOPE_ERROR,
  canActOnBookingBrand,
} from "@/lib/acc/travel-booking/booking-brand-access-shared";

/**
 * May this person act on this AP-17 request's brand?
 *
 * Filtering a queue hides rows; this is what stops somebody acting on one
 * anyway. A scoped approver who still holds the id of a request outside their
 * brands — from a link, a bookmark, or a page loaded before the scope was
 * narrowed — must be refused at the action, not merely not shown it.
 *
 * **It loads the brand itself, from the database, pinned to AP-17.** That is the
 * same query and the same reason `admin-service.ts` gives for its own
 * brand read: fifteen call sites each reading the brand from wherever they
 * happen to have it is how one of them ends up reading it from the request body.
 *
 * Returns `null` when allowed, or the `Response` to return.
 */
export async function requireBookingBrandScope(
  user: { email?: string | null; role?: string | null },
  requestId: number,
): Promise<Response | null> {
  const access = await resolveBookingBrandAccess(user.email ?? null, user.role ?? null);
  // Unrestricted short-circuits before the query: no reason to read a brand
  // nobody is going to be compared against.
  if (access.allAccess) return null;

  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("rid", sql.Int, requestId)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`SELECT TOP 1 BrandCode FROM [dbo].[AccRequest]
            WHERE Id = @rid AND FormCode = @form`);

  // A request that does not exist, or is not AP-17, is not this gate's business
  // — the caller's own lookup answers 404 for it. Letting it through here keeps
  // the two refusals from disagreeing about which one applies.
  if (r.recordset.length === 0) return null;

  const brandCode = (r.recordset[0]?.BrandCode as string | null) ?? null;
  if (canActOnBookingBrand(access, brandCode)) return null;

  // Names no brand: an actor scoped out of a request should not learn whose it is.
  return NextResponse.json({ ok: false, error: BOOKING_BRAND_SCOPE_ERROR }, { status: 403 });
}
