import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { suggestGlAccountWithAI } from "@/lib/clr/ai-receipt";
import { listGlAccounts } from "@/lib/clr/clear-advance-request-service";

/**
 * POST /api/request/clear-advance/suggest-gl — body: { description, branch }
 *
 * Advisory G/L suggestion for one OCR row (§10). The candidate list is built
 * here from the row's branch, never sent by the client, and the answer is
 * matched back against it — so a suggestion can only ever be an account that
 * branch is allowed to charge. No match returns null and the field stays empty.
 */
export async function POST(req: Request) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { description?: string; branch?: string | null };
    const description = (body.description ?? "").trim();
    if (!description) return NextResponse.json({ ok: true, data: null });

    const accounts = await listGlAccounts(body.branch ?? null);
    const suggested = await suggestGlAccountWithAI(description, accounts);
    const hit = accounts.find((a) => a.glAccountNo === suggested) ?? null;
    return NextResponse.json({
      ok: true,
      data: hit ? { glAccountNo: hit.glAccountNo, nameTh: hit.nameTh } : null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "suggest failed" },
      { status: 500 },
    );
  }
}
