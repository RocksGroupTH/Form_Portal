import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
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
      },
      actor,
    );
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
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
