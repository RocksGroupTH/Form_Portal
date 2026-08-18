import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAdvanceReport } from "@/lib/adv/advance-report-service";

/** GET — AP-2 control report (columns per sheet "AP-2-Control"). */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listAdvanceReport() });
  } catch (err) {
    console.error("[api/request/advance/report] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
