import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { suggestBranchWithAI } from "@/lib/clr/ai-receipt";
import { listBranches } from "@/lib/clr/clear-advance-request-service";

/**
 * POST /api/request/clear-advance/suggest-branch — body: { hint, brand }
 *
 * Advisory branch (สาขา) suggestion for one OCR upload (§10). `hint` is the
 * document-level note the reader took off the pages — what the spend was FOR,
 * never the "สาขา" printed on the tax invoice, which is the buyer's registered
 * tax-invoice branch and is almost always สำนักงานใหญ่.
 *
 * The candidate list is built here from the request's brand, never sent by the
 * client, and the answer is matched back against it — so a suggestion can only
 * ever be a branch that brand offers in the picker. No match returns null and
 * the field stays empty.
 */
export async function POST(req: Request) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { hint?: string; brand?: string | null };
    const hint = (body.hint ?? "").trim();
    const brand = (body.brand ?? "").trim();
    if (!hint || !brand) return NextResponse.json({ ok: true, data: null });

    const branches = await listBranches(brand);
    const { code, close } = await suggestBranchWithAI(hint, branches);
    const hit = branches.find((b) => b.code === code) ?? null;
    return NextResponse.json({
      ok: true,
      data: hit ? { code: hit.code, name: hit.name, close } : null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "suggest failed" },
      { status: 500 },
    );
  }
}
