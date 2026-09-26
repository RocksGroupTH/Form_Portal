import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import {
  resolveAdvanceCanMessageByEmail,
  resolveClearCanMessageByEmail,
} from "@/lib/adv/access-message-access";
import { decideMessageTabAccess } from "@/lib/acc/message-grant";

/**
 * The gates on AP-2's and AP-3's Message settings tabs — the counterparts of
 * `@/lib/acc/require-message-access`, the same shape on purpose.
 *
 * Two functions, not one taking a form: `AccAdvClrAccess.CanAdvanceMessage`
 * and `.CanClearMessage` are two columns on one shared roster row, exactly as
 * `advanceErpInterface` / `clearErpInterface` are two settings-tab keys rather
 * than one — see `@/lib/adv/access-message-access`. Neither is an
 * `AccAdvClrAccessTab` row, for the reason AP-1's twin gives: that table is
 * shared with ACC Portal and its own saver rewrites a person's whole tab set
 * with only the keys it recognises. See `@/lib/acc/message-grant`.
 *
 * Both return the session, or the `Response` to return — the same shape
 * `requireAuth()` uses.
 */
async function gate(
  resolve: (email: string | null | undefined) => Promise<boolean>,
  logTag: string,
): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let canMessage: boolean;
  try {
    canMessage = await resolve(session.user.email);
  } catch (err) {
    console.error(`[require-adv-clr-message-access] could not resolve ${logTag} message grant`, err);
    return NextResponse.json(
      { ok: false, error: "ตรวจสอบสิทธิ์เข้าถึงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  if (!decideMessageTabAccess(isAdmin, canMessage)) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้" },
      { status: 403 },
    );
  }

  return session;
}

export async function requireAdvanceMessageAccess(): Promise<Session | Response> {
  return gate(resolveAdvanceCanMessageByEmail, "AP-2");
}

export async function requireClearMessageAccess(): Promise<Session | Response> {
  return gate(resolveClearCanMessageByEmail, "AP-3");
}
