import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { addOrReactivateOfficer, listOfficers, removeOfficer } from "@/lib/acc/reward/settings-service";

/* ── The Assist AP roster ── */

/**
 * Admin-only, unlike the reward catalogue.
 *
 * Managing the catalogue is day-to-day work an officer does; deciding **who is
 * an officer** is not — it is the grant that gives someone the queue, the
 * report and every reward request in the database. Letting the roster edit
 * itself would make the first member able to add anyone.
 */
const ADMIN_ROLES = ["IT Admin", "System Admin"] as const;

export async function GET() {
  const session = await requireRole([...ADMIN_ROLES]);
  if (session instanceof Response) return session;

  try {
    const data = await listOfficers();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/settings/officers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole([...ADMIN_ROLES]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const data = await addOrReactivateOfficer(
      {
        email: String(body.email ?? ""),
        staffId: body.staffId == null ? null : Number(body.staffId),
        displayName: body.displayName ?? null,
        photoUrl: body.photoUrl ?? null,
      },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/settings/officers] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}

/* ── DELETE ?id= — soft delete, so past actions keep naming their actor ── */

export async function DELETE(req: NextRequest) {
  const session = await requireRole([...ADMIN_ROLES]);
  if (session instanceof Response) return session;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  try {
    await removeOfficer(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reward/settings/officers] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
