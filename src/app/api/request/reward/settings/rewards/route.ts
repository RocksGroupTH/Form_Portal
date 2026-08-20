import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessRewardArea } from "@/lib/acc/reward/access";
import { statusForAccError } from "@/lib/acc/request-errors";
import { listRewards, setRewardActive, upsertReward } from "@/lib/acc/reward/settings-service";

/**
 * The reward catalogue (brief §"หน้า Setting Reward").
 *
 * These rows are **per database**, not dual-written like the 19 shared masters:
 * `Qty` is inventory, not configuration. A tester editing the catalogue in UAT
 * mode is editing UAT's catalogue, which is why `/api/request/reward/settings`
 * is classified `AP-11` in `ROUTE_RULES` rather than left to resolve Production
 * the way AP-1's settings prefix is.
 */

async function gate(session: { user: { email?: string | null; role?: string | null } }) {
  if (!(await canAccessRewardArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  return null;
}

/* ── GET /api/request/reward/settings/rewards?brand=PCTH ── */

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const denied = await gate(session);
  if (denied) return denied;

  try {
    // No `selectableOnly` — the settings page must show closed, exhausted and
    // expired rewards, which are exactly the ones needing attention.
    const data = await listRewards({ brandCode: req.nextUrl.searchParams.get("brand") });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/settings/rewards] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ── POST /api/request/reward/settings/rewards — create or update ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const denied = await gate(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const data = await upsertReward(
      {
        id: body.id == null ? undefined : Number(body.id),
        brandCode: String(body.brandCode ?? ""),
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        qty: Number(body.qty ?? 0),
        unitActualValue: body.unitActualValue == null ? null : Number(body.unitActualValue),
        unitBookValue: body.unitBookValue == null ? null : Number(body.unitBookValue),
        startDate: body.startDate || null,
        expireDate: body.expireDate || null,
        poNo: body.poNo ?? null,
        pinNo: body.pinNo ?? null,
        prepaymentNo: body.prepaymentNo ?? null,
        isActive: body.isActive !== false,
        sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
      },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/settings/rewards] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    // 409 when the change collides with committed stock or a duplicate code —
    // both are "reload and look", not "try again".
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}

/* ── PATCH /api/request/reward/settings/rewards — open or close one ── */

export async function PATCH(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const denied = await gate(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    await setRewardActive(id, body.isActive !== false, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reward/settings/rewards] PATCH", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
