import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { buildAccActor } from "@/lib/acc/actor-context";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { setReimburseItemAccounts } from "@/lib/acc/reimburse/approval-service";
import { listExpenseAccounts } from "@/lib/acc/reimburse/expense-account-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { suggestGlAccountWithAI } from "@/lib/clr/ai-receipt";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * POST /api/request/reimburse/requests/[id]/suggest-gl
 *
 * Ask the model for a G/L account for every line of one claim that has none,
 * from that line's own รายละเอียด, and save what it answers.
 *
 * **One claim per call, from a button.** Suggesting on every keystroke would
 * spend a model call per character; suggesting for the whole queue on open
 * would spend one per line of every claim before anyone had decided to look. A
 * button is also what makes the cost legible: the accountant chooses when to
 * ask.
 *
 * **It only fills EMPTY lines.** A line an accountant has already set is their
 * answer, and a model is not entitled to overwrite it — that is the difference
 * between a suggestion and a correction. Re-running after clearing a line is
 * how somebody asks again.
 *
 * **The model can only choose from the accounts this claim may actually post
 * to.** `listExpenseAccounts` is keyed on the Business Central company, so the
 * claim brand is resolved through `AccBrandErpInterface` first — the same
 * resolution the picker itself uses, and the reason a ROCKS claim used to be
 * offered an empty list. Anything the model answers that is not in that list is
 * dropped by `pickSuggestedGl`, so an accountant is never shown an account they
 * could not have picked by hand.
 *
 * **The write goes through `setReimburseItemAccounts`**, so it inherits every
 * guard the manual edit has: the roster check, the state predicate claimed
 * inside the transaction, the brand scope re-decided from the database, and the
 * old-to-new activity row. A sibling writer would have to re-implement four
 * checks and could only get one wrong.
 *
 * Layered like `../items`: `authorizeAccRequest("read")` first, then the roster
 * and scope inside the service. `"mutate"` is the wrong mode here for the same
 * reason it is wrong there.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const claim = await getReimburseRequest(id);
    if (!claim) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const map = await getBrandErpInterfaceMap(claim.brandCode ?? "", AP4_FORM_CODE);
    const company = map?.interfaceBrandCode?.trim() || (claim.brandCode ?? "");
    const accounts = company ? await listExpenseAccounts(company) : [];
    if (accounts.length === 0) {
      return NextResponse.json(
        { ok: false, error: "ไม่มีผังบัญชีของบริษัทนี้ให้เลือก" },
        { status: 400 },
      );
    }

    const candidates = accounts.map((a) => ({
      glAccountNo: a.accountNo,
      nameTh: a.displayName,
      nameEn: null,
    }));

    const targets = claim.items.filter(
      (it) => it.id != null && (it.category ?? "").trim() === "" && (it.description ?? "").trim() !== "",
    );

    // Sequential rather than Promise.all: these are model calls, and a claim
    // with twenty lines firing twenty at once is a rate limit waiting to
    // happen. A handful of lines is the normal case.
    const edits: { id: number; category: string | null }[] = [];
    for (const it of targets) {
      const suggested = await suggestGlAccountWithAI(it.description ?? "", candidates);
      if (suggested) edits.push({ id: it.id as number, category: suggested });
    }

    if (edits.length === 0) {
      return NextResponse.json({ ok: true, data: { filled: 0 } });
    }

    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    await setReimburseItemAccounts(id, actor, edits);
    return NextResponse.json({ ok: true, data: { filled: edits.length } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
