import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { isAdminRole } from "@/lib/roles";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { getAccPool, sql } from "@/lib/acc/pool";
import {
  getTravelBookingRequest,
  saveTravelBookingDraft,
  deleteTravelBookingDraft,
} from "@/lib/acc/travel-booking/request-service";
import type { SaveTravelBookingGroupInput } from "@/features/travel-booking/types";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/** This tab's GroupKey — PUT/DELETE act on the whole draft group, not one tab. */
async function resolveGroupKey(requestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT GroupKey FROM [dbo].[AccTravelBooking] WHERE RequestId = @id`);
  return (r.recordset[0]?.GroupKey as string) ?? null;
}

/* ── GET /api/request/travel-booking/requests/[id] ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  try {
    const data = await getTravelBookingRequest(id);
    if (!data) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const userId = Number(session.user.id);
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    let staffId: number | null = null;
    if (loginEmail) {
      const { employee } = await findActiveEmployeeByEmail(loginEmail);
      staffId = employee?.staffId ?? null;
    }

    const pool = await getAccPool();
    const own = await pool.request()
      .input("id", sql.Int, id)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`SELECT CreatedBy, ManagerStaffId FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
    const createdBy = (own.recordset[0]?.CreatedBy as number | null) ?? null;
    const managerStaffId = (own.recordset[0]?.ManagerStaffId as number | null) ?? null;

    const isOwner = createdBy != null && createdBy === userId;
    const isManager = staffId != null && managerStaffId != null && staffId === managerStaffId;
    const isAdmin = isAdminRole(session.user.role);

    if (!isOwner && !isManager && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/requests/[id]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── PUT /api/request/travel-booking/requests/[id] — edit the whole draft group this tab belongs to ── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  try {
    const groupKey = await resolveGroupKey(id);
    if (!groupKey) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const body = (await req.json()) as SaveTravelBookingGroupInput;
    body.id = groupKey;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const data = await saveTravelBookingDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/* ── DELETE /api/request/travel-booking/requests/[id] — remove the editable draft group this tab belongs to ── */

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  try {
    const groupKey = await resolveGroupKey(id);
    if (!groupKey) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    await deleteTravelBookingDraft(groupKey, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
