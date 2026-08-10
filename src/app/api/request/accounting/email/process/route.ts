import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { processQueue } from "@/lib/acc/email-queue";

/**
 * POST /api/request/accounting/email/process
 *
 * Drains the accounting email queue (AccEmailQueue).
 * Mirrors the guard used by /api/forms/email/process:
 *   - Allows a valid CRON_SECRET header to bypass role check (for scheduled jobs).
 *   - Otherwise requires IT Admin or System Admin.
 */
export async function POST(req: NextRequest) {
  // Auth: admin role OR cron secret header (mirrors forms email/process guard)
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;
  }

  try {
    const result = await processQueue();
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/request/accounting/email/process] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
