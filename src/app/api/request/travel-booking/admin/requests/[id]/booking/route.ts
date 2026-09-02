import { NextRequest, NextResponse } from "next/server";
import { statusForAccError } from "@/lib/acc/request-errors";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { requireBookingBrandScope } from "@/lib/acc/travel-booking/require-booking-brand-scope";
import { buildAccActor } from "@/lib/acc/actor-context";
import { saveBookingDetail, deleteBookingDetail } from "@/lib/acc/travel-booking/admin-service";
import type { BookingType } from "@/features/travel-booking/types";

const BOOKING_TYPES = new Set<string>(["room", "ticket", "rent"]);

/** Shared guard: auth + account-area access + a valid request id. */
async function requireAdminContext(
  params: Promise<{ id: string }>,
): Promise<{ requestId: number; userId: number; email: string | null } | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const requestId = Number(rawId);
  if (Number.isNaN(requestId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  // Being in the area is not the same as being allowed this request's brand.
  // A scoped approver holding the id from a link or a stale page is refused
  // here, where the queue would merely not have shown it to them.
  const scoped = await requireBookingBrandScope(session.user, requestId);
  if (scoped) return scoped;
  return { requestId, userId: Number(session.user.id), email: session.user.email ?? null };
}

/**
 * POST /api/request/travel-booking/admin/requests/[id]/booking
 * Admin fill-in — create or update one AccTravelBookingDetail row: bookingNo plus the four
 * figures an invoice states (priceExVat, vatAmount, discountAmount, totalAmount).
 * A type may hold several rows: pass `detailId` to edit one, omit it to add another.
 * **Every field may be null** — an empty row is how Admin gets an id to attach files to first.
 *
 * The body is read permissively here and narrowed in the service, which is where
 * `sanitizeBookingNo` / `sanitizeBookingAmount` run. The client applies the same functions;
 * that is a convenience for the person typing, not the gate.
 *
 * `currency` is the desk's toggle, and **no rate is ever accepted** — the service
 * fetches one itself, so a caller cannot choose what their own figures are worth.
 * The four figures are stored in the request's own currency; which currency, and
 * at what rate, lands on the request header. `AccRequest.TotalAmount` is untouched
 * by all of it: for AP-17 that column holds the per-diem total alone.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminContext(params);
  if (ctx instanceof Response) return ctx;

  try {
    const body = (await req.json()) as {
      bookingType: BookingType;
      detailId?: number | null;
      bookingNo: string | null;
      priceExVat: number | null;
      vatAmount?: number | null;
      discountAmount?: number | null;
      totalAmount?: number | null;
      currency?: string | null;
    };
    if (!body.bookingType || !BOOKING_TYPES.has(body.bookingType)) {
      return NextResponse.json({ ok: false, error: "Invalid bookingType" }, { status: 400 });
    }
    const detailId = body.detailId == null ? null : Number(body.detailId);
    if (detailId != null && Number.isNaN(detailId)) {
      return NextResponse.json({ ok: false, error: "Invalid detailId" }, { status: 400 });
    }

    const actor = await buildAccActor(ctx.userId, ctx.email);
    const data = await saveBookingDetail(
      ctx.requestId,
      body.bookingType,
      {
        detailId,
        bookingNo: body.bookingNo ?? null,
        priceExVat: body.priceExVat ?? null,
        vatAmount: body.vatAmount ?? null,
        discountAmount: body.discountAmount ?? null,
        totalAmount: body.totalAmount ?? null,
        // Re-derived from the request's brand in the service. Anything other
        // than 'THB' resolves to the brand's own currency, so a body naming a
        // third currency cannot file the request in it — this can only opt out.
        currency: body.currency ?? null,
      },
      actor,
    );
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // 409 for a currency the request no longer admits, 400 for everything else.
    // The difference is whether retrying the same body could ever work: a stale
    // pick fails identically forever until the page is reloaded, and 400's dialog
    // offers a retry that cannot succeed. `statusForAccError` owns the mapping so
    // this route does not have to know which errors are conflicts.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}

/**
 * DELETE /api/request/travel-booking/admin/requests/[id]/booking?detailId=
 * Remove one booking row together with its attachments (used when Admin adds an entry by
 * mistake, or drops one of several bookings of the same type).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminContext(params);
  if (ctx instanceof Response) return ctx;

  const detailId = Number(new URL(req.url).searchParams.get("detailId"));
  if (!detailId || Number.isNaN(detailId)) {
    return NextResponse.json({ ok: false, error: "detailId is required" }, { status: 400 });
  }

  try {
    await deleteBookingDetail(ctx.requestId, detailId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
