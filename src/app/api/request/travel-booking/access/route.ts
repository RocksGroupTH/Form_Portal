import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isBookingApprover } from "@/lib/acc/booking-access";
import { isAdminRole } from "@/lib/roles";
import { resolveBookingTabsByEmail } from "@/lib/acc/travel-booking/booking-approver-tabs";
import { resolveBookingAreasByEmail } from "@/lib/acc/travel-booking/booking-approver-areas";

/* ── GET /api/request/travel-booking/access — viewer's AP-17 capabilities ──
 *
 * Its own endpoint rather than a field on AP-1's, so the two forms' access
 * questions never have to be asked together.
 *
 * These flags drive which menus render. They are NOT the authorization gate:
 * every AP-17 account-area route still calls `canAccessBookingArea` itself, and
 * that function deliberately keeps its admin arm.
 *
 * `account` here is the `AccBookingApprover` roster alone, so an admin who is
 * not on it no longer sees AP-17's queue or report. They keep ตั้งค่า, so nobody
 * can lock themselves out — an admin can always grant themselves a row.
 *
 * `settingsTabs` / `canSettings` report the per-tab grants from
 * `AccBookingApproverTab`, in the same shape AP-1's endpoint uses. They too are
 * menu visibility only: the settings routes themselves are gated by
 * `requireBookingSettingsTab`, which resolves the grant server-side on every
 * call.
 *
 * **`areas` is a DIFFERENT table's answer and not the same kind of flag.**
 * The three menu grants are `CanQueue` / `CanAccount` / `CanReport` on the
 * roster row — the columns ACC Portal writes too — and since 2026-09-24 they
 * are real authority rather than sight: `requireBookingMenu` refuses an
 * action without them. So unlike `settingsTabs`, these must be resolved from
 * the same source the routes will consult, or a page draws buttons its own
 * server then answers 403 for.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    const approver = await isBookingApprover(email);
    // Admins see every tab; the grant list only governs non-admin approvers.
    //
    // The grant read is caught separately so it cannot take the rest of the
    // answer with it. A roster member who holds no grants still needs
    // `account` to see the queue and the report, and failing the whole endpoint
    // over a table they do not use would deny them work they are entitled to.
    // Unresolvable grants degrade to none — the fail-closed direction for the
    // settings half — while the area half is answered from a read that
    // succeeded.
    let settingsTabs: string[] = [];
    let areas: string[] = [];
    if (!admin) {
      try {
        settingsTabs = await resolveBookingTabsByEmail(email);
      } catch (err) {
        console.error("[travel-booking/access] grant read failed — reporting no grants", err);
      }
      // Its own try for the reason the one above has one: the two reads
      // answer different questions from different storage, and a settings
      // table this person does not use must not cost them their menus.
      try {
        areas = await resolveBookingAreasByEmail(email);
      } catch (err) {
        console.error("[travel-booking/access] area read failed — reporting no menus", err);
      }
    }
    const canSettings = admin || settingsTabs.length > 0;
    // Admins see both menus; a grant list only governs non-admins, exactly as
    // `settingsTabs` above does. `approver` (the AccBookingApprover roster) is
    // still what decides whether an action is permitted once a page is open.
    return NextResponse.json({
      ok: true,
      data: {
        account: approver,
        approver,
        admin,
        settingsTabs,
        canSettings,
        areas,
        bookingQueue: admin || areas.indexOf("queue") !== -1,
        accountApproval: admin || areas.indexOf("account") !== -1,
        bookingReport: admin || areas.indexOf("report") !== -1,
      },
    });
  } catch (err) {
    console.error("[api/request/travel-booking/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
