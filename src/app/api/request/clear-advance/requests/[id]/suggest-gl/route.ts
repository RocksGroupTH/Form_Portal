import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest, listGlAccounts, listGlHistoryRows } from "@/lib/clr/clear-advance-request-service";
import { clrCompanyForBrand, resolveClrCompany } from "@/lib/clr/clear-advance-admin-service";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { isAdminRole } from "@/lib/roles";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { suggestGlAccountWithAI } from "@/lib/clr/ai-receipt";
import { branchesToLoad, runGlSuggestions, type GlCandidate } from "@/lib/clr/gl-suggest-run";
import { planGlSuggestions } from "@/lib/clr/gl-suggest-targets";
import { decideRemembered, glHistoryKey, type GlHistoryRow } from "@/lib/clr/gl-history";
import { AP3_FORM_CODE, isRocksPcBrand, FORCE_GL_NON_ROCKS_PC } from "@/features/clear-advance/constants";

/**
 * POST /api/request/clear-advance/requests/[id]/suggest-gl — no body.
 *
 * Ask the model for a G/L account for every line of one AP-3 clearing that has
 * none, from that line's own รายละเอียด, and **answer with what it said**.
 *
 * **One claim per call, from a button.** Suggesting on every keystroke would
 * spend a model call per character, and suggesting across the queue on open
 * would spend one per line of every claim before anyone had decided to look at
 * them. A button also makes the cost legible: the officer chooses when to ask.
 *
 * **It only looks at lines that have no account.** One the officer has already
 * set is their answer, and a model is not entitled to overwrite it — that is
 * the difference between a suggestion and a correction. `planGlSuggestions`
 * decides which lines those are, and its buckets are reported back as counts so
 * a line that cannot be asked about (no description, no branch) is said out
 * loud rather than quietly left blocked.
 *
 * **It asks the model only about what it cannot remember.** A line whose
 * รายละเอียด has been accounted for before — same company, same HQ-or-branch
 * classification — is filled from that decision instead: free, instant, and
 * consistent with the officer who made it in a way a model is not. The history
 * only answers when it agrees with itself (`decideRemembered`), and what it
 * offers is re-validated against the same candidate list the model's answer is,
 * so an account that has since been deactivated is not replayed onto a new
 * claim. Everything else still goes to the model, in the same order as before.
 *
 * ## This route does not write, and that is where it parts from AP-4's
 *
 * AP-4's `reimburse/requests/[id]/suggest-gl` saves the accounts itself. This
 * one must not, because AP-3's account step is a different animal: the screen
 * holds the whole grid in `editItems` and autosaves it on a 900 ms debounce
 * (`ClearAdvanceDetail.tsx`). If this route wrote, the browser would still be
 * holding the pre-suggestion lines, and the next autosave — fired by any later
 * keystroke anywhere in the grid — would post those stale lines back over the
 * accounts the server had just filled in. Silently, and only sometimes, which
 * is the worst kind of only sometimes.
 *
 * So there is exactly one writer. This route suggests, the screen applies the
 * suggestions to `editItems` by index, and the existing save path persists
 * them with every guard it already has. Making this route write "like AP-4's"
 * is the simplification to refuse.
 *
 * **Auth is the account step's own gate**, copied from the sibling
 * `account-edit` route: an ACCOUNT approver or an admin. This is an
 * account-step action, and someone who may not edit the grid has no business
 * spending model calls against it — nor any way to keep what comes back.
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

  const clrReq = await getRequest(id);
  if (!clrReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const allowed =
    (await isClrApprover(session.user.email ?? null, "ACCOUNT")) ||
    isAdminRole(session.user.role);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์แก้ไขขั้นบัญชี" },
      { status: 403 },
    );
  }

  // A brand that is not the home company has every line's account overwritten
  // with FORCE_GL_NON_ROCKS_PC on save, so a suggestion here could not survive
  // even if the model were right. The button is hidden for these claims, which
  // makes a call that gets this far a bug or a hand-made request — and
  // answering it with a cheerful "filled 0" would hide whichever it is.
  if (!isRocksPcBrand(clrReq.brandCode)) {
    return NextResponse.json(
      {
        ok: false,
        error: `แบรนด์นี้ใช้บัญชีคงที่ ${FORCE_GL_NON_ROCKS_PC} (จ่ายแทนบ.อื่น) ทุกบรรทัด จึงไม่ต้องให้ AI แนะนำบัญชี`,
      },
      { status: 400 },
    );
  }

  try {
    const items = clrReq.clear?.items ?? [];

    // Same two inputs the picker itself uses — the company from the brand, the
    // branch from the line — so a suggestion can only ever be an account the
    // officer could have chosen by hand. Built once per DISTINCT branch: the
    // lines of one claim can sit in different branches, and building per line
    // would query the database once a line for lists that are usually equal.
    const company = await resolveClrCompany(clrReq.brandCode);
    const byBranch = new Map<string, readonly GlCandidate[]>();
    for (const branchCode of branchesToLoad(items)) {
      const accounts = await listGlAccounts({ company, branchCode });
      // An empty list is a broken chart of accounts, not an empty answer. This
      // codebase has already lost a suggestion feature to exactly this silence
      // once (see ClearAdvanceForm's note), so it is said, with the branch named.
      if (accounts.length === 0) {
        return NextResponse.json(
          { ok: false, error: `ไม่มีผังบัญชีที่ใช้กับสาขา ${branchCode} ได้ — กรุณาตรวจสอบผังบัญชี AP-3 ของบริษัทนี้` },
          { status: 400 },
        );
      }
      byBranch.set(branchCode, accounts);
    }

    // What an officer already decided, before spending anything on asking.
    //
    // **One query for the claim, not one per line.** Every eligible line's
    // รายละเอียด goes down in a single read and the rows come back for all of
    // them together; splitting it per line would be a scan apiece for a button
    // press, and the lines of one claim repeat themselves constantly.
    //
    // The rows arrive carrying the brand of the claim they came from, because
    // that is what the database holds; `decideRemembered` keys on the COMPANY,
    // because that is what an account belongs to. `interfaceByClaim` is that
    // mapping and it lives in the journal context, not in SQL — so it is
    // applied here, once, over rows that may come from several brands.
    const plan = planGlSuggestions(items);
    const historyRows = await listGlHistoryRows(
      plan.targets.map((i) => items[i]?.description ?? ""),
    );
    const { interfaceByClaim } = await loadErpJournalBuildContext(AP3_FORM_CODE);
    const rows: GlHistoryRow[] = historyRows.map((r) => ({
      description: r.description,
      branchCode: r.branchCode,
      company: clrCompanyForBrand(r.brandCode, interfaceByClaim),
      glAccountNo: r.glAccountNo,
    }));
    const remembered = new Map<number, string>();
    for (const i of plan.targets) {
      const it = items[i];
      // The key is per LINE, not per description: two lines can share a
      // รายละเอียด and sit at different kinds of branch, and the whole point of
      // the key is that those are two different questions.
      const acct = decideRemembered(rows, glHistoryKey(it?.description, company, it?.branchCode));
      if (acct) remembered.set(i, acct);
    }

    // `remembered` is a proposal, not a decision. `runGlSuggestions` puts each
    // one through the same candidate check the model's answer goes through, and
    // a line whose remembered account no longer survives it falls through to
    // the model like any other.
    const data = await runGlSuggestions(items, byBranch, suggestGlAccountWithAI, remembered);
    // An empty `suggestions` is a success: nothing to fill, or nothing the
    // model would commit to. The counts say which.
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
