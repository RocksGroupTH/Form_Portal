import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveAdvClrTabsByEmail } from "@/lib/adv/access-service";
import { isAnyAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { isAnyClrApprover } from "@/lib/clr/clear-advance-approver-service";
import {
  ADV_CLR_MENUS,
  GRANTABLE_ADV_CLR_TABS,
  decideAdvClrMenuAccess,
  decideAdvClrTabAccess,
} from "@/lib/adv/settings-tabs";

/**
 * What the signed-in viewer may open on AP-2 and AP-3 — the endpoint the two
 * hubs read to decide which cards to render.
 *
 * **It reports sight, never authority.** Whether somebody may approve is
 * `AccAdvanceApprover` / `AccClearAdvanceApprover`, re-decided where the money
 * moves; a person with `advanceQueue` and no approver row sees the queue and
 * can act on nothing in it. Filtering cards is not a control either — every
 * destination re-decides its own access server-side, which is what
 * `requireAdvClrMenu` and `requireAdvClrSettingsTab` are for.
 *
 * Answers for any signed-in user, like AP-4's `/api/request/reimburse/access`:
 * a viewer with nothing granted gets every flag false, which is the state every
 * non-admin is in until an admin ticks something.
 *
 * The path sits under `/api/request/advance`, which `ROUTE_RULES` maps to AP-2,
 * and AP-3's hub calls it too — correct, because the roster is one shared,
 * dual-written table, so both databases hold the same rows.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);

  let granted: string[] = [];
  try {
    granted = await resolveAdvClrTabsByEmail(session.user.email);
  } catch (err) {
    // Degrade to "nothing granted" rather than 500: this only decides which
    // links a hub draws, and an admin is unaffected either way because their
    // arm never consults the list. Every page behind those links refuses on
    // its own.
    console.error("[api/request/advance/access] grant lookup failed", err);
  }

  const settingsTabs: Record<string, boolean> = {};
  for (const t of GRANTABLE_ADV_CLR_TABS) {
    settingsTabs[t.key] = decideAdvClrTabAccess(isAdmin, granted, t.key);
  }
  /**
   * **Roster OR grant, never grant alone.** `AccAdvClrAccess` ships empty with
   * no backfill, so gating the hubs on the tick alone would take AP-2's queue
   * and AP-3's queue away from every existing approver on the day this shipped.
   * A tick therefore ADDS reach — it opens a menu to somebody who is not an
   * approver — rather than being a second thing an approver must also be given.
   * That is the shape AP-17's booking hub already uses, for the same measured
   * reason CLAUDE.md records: its grant table was empty while its roster was
   * not.
   *
   * Showing a card leaks nothing either way: every destination re-decides its
   * own access server-side, and this endpoint reports SIGHT, never authority.
   */
  let advApprover = false;
  let clrApprover = false;
  try {
    [advApprover, clrApprover] = await Promise.all([
      isAnyAdvanceApprover(session.user.email),
      isAnyClrApprover(session.user.email),
    ]);
  } catch (err) {
    // Same degrade-to-false as the grant lookup: this only decides which links
    // a hub draws, and every page behind them refuses on its own.
    console.error("[api/request/advance/access] approver lookup failed", err);
  }

  const rosterFor = (form: "AP-2" | "AP-3") => (form === "AP-2" ? advApprover : clrApprover);
  const menus: Record<string, boolean> = {};
  for (const m of ADV_CLR_MENUS) {
    menus[m.key] = decideAdvClrMenuAccess(isAdmin, granted, m.key) || rosterFor(m.form);
  }

  return NextResponse.json({
    ok: true,
    data: {
      isAdmin,
      // Reported so a screen can say "the actions will refuse" rather than
      // leaving somebody to discover it: sight and authority are separate here.
      isAdvanceApprover: advApprover,
      isClearApprover: clrApprover,
      // True when ANY settings tab is open to this viewer — what the hubs'
      // ตั้งค่า card is drawn on. An admin always passes; a non-admin passes
      // only on a real grant, so an empty roster hides nothing that was
      // previously visible (the page was `requireRole` before this shipped).
      canSettings: isAdmin || Object.keys(settingsTabs).some((k) => settingsTabs[k]),
      settingsTabs,
      menus,
    },
  });
}
