import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { parseFormNames } from "@/lib/form-environment/form-name-input";
import { setFormNames } from "@/lib/form-environment/form-names-service";

/**
 * POST { formCode, nameTh, nameEn } — rename one form.
 *
 * **System Admin, matching the page it serves.** Settings → Form Environment is
 * System Admin-only, and the names sit in the same row as the switches that
 * decide whether a form is open at all; a weaker gate here would mean an admin
 * who may not open that page can still change what every requester, every
 * report and every filter calls the form.
 *
 * Separate from `/api/settings/form-environment` for the reason that route's
 * own docblock gives: its POST is deliberately one switch at a time, so that a
 * stale copy of the switch an admin did not touch cannot travel back with the
 * one they did. A rename is a different shape and gets its own door.
 *
 * The write is dual — see `setFormNames`.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const formCode = typeof body?.formCode === "string" ? body.formCode.trim() : "";
    if (!formCode) {
      return NextResponse.json({ ok: false, error: "formCode is required" }, { status: 400 });
    }
    const parsed = parseFormNames(body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const changed = await setFormNames(formCode, parsed.nameTh, parsed.nameEn);
    if (!changed) {
      return NextResponse.json({ ok: false, error: `ไม่พบฟอร์ม ${formCode}` }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/form-names] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
