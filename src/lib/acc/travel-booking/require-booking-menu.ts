import { NextResponse } from "next/server";
import { isAdminRole } from "@/lib/roles";
import { resolveBookingAreasByEmail } from "@/lib/acc/travel-booking/booking-approver-areas";
import { BOOKING_AREAS, type BookingAreaKey } from "@/lib/acc/travel-booking/booking-areas";

/**
 * **An AP-17 menu tick decides who may ACT, not just who may look — since
 * 2026-09-24** (the user: "Admin จะต้องเป็นคนที่ติ๊ก จองคิว เท่านั้น และ HR
 * จะต้องเห็นคนที่ติ๊ก HR").
 *
 * This inverts what `AccBookingApproverTab`'s menu keys were designed for, and
 * the inversion is the whole point of the file, so it is stated rather than
 * buried. CLAUDE.md recorded the old rule as: *"A tick therefore **adds**
 * reach, opening a menu to somebody who is not on the roster; it is not a
 * second thing a roster member must also be given… roster membership is still
 * what permits the action."* It is now exactly that second thing. A roster
 * member without the tick keeps their brand scope and their place in the
 * roster and cannot press the button.
 *
 * **What made the old shape untenable was the `รออนุมัติโดย` card.** It lists
 * who may act on a step, and with sight and authority disagreeing there was no
 * honest list to show: the roster said all eight, the queue those eight can
 * actually open said six, and the two sets are not the same six for the two
 * steps. Filtering the card alone would have been a card that lies, which is
 * the mistake this repo had already made once with AP-1's fail-open.
 *
 * ## Admins pass
 *
 * `canAccessBookingArea` keeps its admin arm, `requireBookingBrandScope` grants
 * admins `allAccess`, and the settings grid prints "เห็นทุกเมนูอยู่แล้ว (Super
 * Admin)" in place of their tick boxes — so an admin holds every menu by
 * construction and has no row to read. Refusing them here would contradict all
 * three and lock the people who administer the form out of it.
 *
 * ## It is the LAST gate, never the first
 *
 * Callers run it after `canAccessBookingArea` and `requireBookingBrandScope`,
 * so "you are not in this area at all" and "not your brand" keep answering
 * first. This one only ever explains the narrower thing.
 */
export async function requireBookingMenu(
  user: { email?: string | null; role?: string | null },
  menu: BookingAreaKey,
): Promise<NextResponse | null> {
  if (isAdminRole(user.role ?? "")) return null;

  const areas = await resolveBookingAreasByEmail(user.email);
  if (areas.indexOf(menu) >= 0) return null;

  /* Named from `BOOKING_AREAS` rather than branched on, so a third or
     fourth area cannot reach a refusal that describes a different menu. */
  const label = BOOKING_AREAS.filter((a) => a.key === menu)[0]?.label ?? menu;
  return NextResponse.json(
    {
      ok: false,
      error: `ไม่มีสิทธิ์ — ต้องได้รับสิทธิ์เมนู ${label} จึงจะดำเนินการขั้นตอนนี้ได้`,
    },
    { status: 403 },
  );
}
