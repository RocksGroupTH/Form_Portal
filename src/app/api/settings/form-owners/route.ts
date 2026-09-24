import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listFormOwners, setFormOwners } from "@/lib/form-environment/form-owner";

/**
 * Who owns each form — read and write, for each form's own สิทธิ์เข้าถึง tab.
 *
 * An owner is the person printed at the foot of a form for a requester to
 * contact about a cancellation. **Naming somebody grants them nothing**, and
 * nothing in this application reads `FormOwner` to decide anything.
 *
 * **IT Admin and System Admin**, which is exactly who can reach the five grids
 * that call it. It was System Admin alone while Settings → Form Environment
 * owned this — that page is System Admin-only and the gate matched it — and
 * the owner column moved off it on 2026-09-24 (the user) onto AP-1's, AP-2's,
 * AP-3's, AP-4's and AP-17's สิทธิ์เข้าถึง tabs, which are IT Admin+. **The
 * widening is real and is not hidden behind the move**: an IT Admin who cannot
 * open Form Environment can now set any form's owners, including AP-11's and
 * AP-15's, which have no grid at all. It is defensible only because an owner
 * grants nothing — if that ever stops being true, this gate is the first thing
 * that has to move back.
 *
 * Every one of those five tabs is ungrantable to a non-admin (`access` is
 * excluded from AP-4's, AP-2/AP-3's and AP-17's grantable lists, `approvers`
 * from AP-1's), so no roster grant reaches this route.
 *
 * It is a **separate route from `/api/settings/form-environment`** rather than
 * a field on that one, because that route's POST is deliberately one switch at
 * a time — "a whole-row write would let a stale copy of the switch the admin
 * did not touch travel back with the one they did" — and an owner list is a
 * whole-row write by nature. Folding them together would force one of the two
 * shapes onto the other.
 *
 * The **read** every form page uses is not this one: it rides on
 * `/api/form-environment`, which is `requireAuth` and already fetched
 * everywhere. This read exists for the settings grids alone.
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listFormOwners() });
  } catch (err) {
    console.error("[api/settings/form-owners] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST { formCode, owners: [{ email, displayName?, staffId? }] } — replace one
 * form's owners with exactly this list.
 *
 * Replace rather than add/remove: the dialog edits a list and saves it whole,
 * so a diff protocol would put the decision about what changed on the client,
 * where a stale copy makes it wrong. Bounded to the one form named in the body
 * — see `setFormOwners`.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    const formCode = typeof body?.formCode === "string" ? body.formCode.trim() : "";
    if (!formCode) {
      return NextResponse.json({ ok: false, error: "formCode is required" }, { status: 400 });
    }
    if (!Array.isArray(body?.owners)) {
      return NextResponse.json({ ok: false, error: "owners must be an array" }, { status: 400 });
    }

    /* An address is the only required field, because it is the only one that
       does anything: `DisplayName` is decoration on a contact line and
       `StaffId` is not read at all. An entry without one is refused rather than
       dropped — dropping it would save a shorter list than the admin is looking
       at and report success. */
    const owners: { email: string; displayName?: string | null; staffId?: number | null }[] = [];
    for (const raw of body.owners) {
      const email = typeof raw?.email === "string" ? raw.email.trim() : "";
      if (!email) {
        return NextResponse.json(
          { ok: false, error: "ทุกรายชื่อต้องมีอีเมล" },
          { status: 400 },
        );
      }
      owners.push({
        email,
        displayName: typeof raw?.displayName === "string" ? raw.displayName : null,
        staffId: typeof raw?.staffId === "number" ? raw.staffId : null,
      });
    }

    await setFormOwners(formCode, owners, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/form-owners] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
