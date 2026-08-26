import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultPaymentRound } from "./payment-calendar";
import { FINAL_SAME_PERSON_ERROR } from "./two-person";
import {
  ACCOUNT_ACTOR_UNKNOWN_ERROR,
  NOT_ACCOUNT_APPROVER_ERROR,
  NOT_AT_STEP_ERROR,
  PAYMENT_DATE_NOT_A_ROUND,
  PAYMENT_DATE_REQUIRED,
  REJECT_COMMENT_REQUIRED,
  STEP_TOKEN_REQUIRED,
  STATE_AFTER_APPROVE,
  STATUS_AT_STEP,
  STEP_ORDER,
  accountCheckActorStaffId,
  finalStepRefusal,
  findActiveApprover,
  isAccountStep,
  isReimburseStepCode,
  isYmd,
  paymentDateError,
  rejectCommentOrError,
  CANCEL_WINDOW_EXPIRED_ERROR,
  RETURN_COMMENT_REQUIRED,
  SELF_CANCEL_WINDOW_HOURS,
  returnCommentOrError,
  selfCancelDeadline,
  selfCancelRefusal,
  stepTokenRefusal,
  upcomingPaymentRounds,
} from "./approval-policy";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { AP4_FORM_CODE, REIMBURSE_STEP_CODES } from "@/features/reimburse/constants";
import type { ReimburseApproval, ReimburseApprover } from "@/features/reimburse/types";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function approver(p: Partial<ReimburseApprover> & { staffId: number }): ReimburseApprover {
  return {
    id: p.id ?? p.staffId,
    staffId: p.staffId,
    email: p.email ?? `staff${p.staffId}@rocksgroup.com`,
    displayName: p.displayName ?? `Staff ${p.staffId}`,
    isActive: p.isActive ?? true,
  };
}

function approval(p: Partial<ReimburseApproval> & { stepCode: ReimburseApproval["stepCode"] }): ReimburseApproval {
  return {
    id: p.id ?? 1,
    requestId: p.requestId ?? 900001,
    stepCode: p.stepCode,
    stepOrder: p.stepOrder ?? STEP_ORDER[p.stepCode],
    assignedTo: p.assignedTo ?? null,
    assignedEmail: p.assignedEmail ?? null,
    status: p.status ?? "Pending",
    comment: p.comment ?? null,
    isChecked: p.isChecked ?? null,
    actionedByStaffId: p.actionedByStaffId ?? null,
    actionedAt: p.actionedAt ?? null,
    createdAt: p.createdAt ?? "",
  };
}

/* ─────────────────────────── the state machine ─────────────────────────── */

test("the two accounting steps share ManagerApproved, so a claim must name the step too", () => {
  assert.equal(STATUS_AT_STEP.ACCOUNT, "ManagerApproved");
  assert.equal(STATUS_AT_STEP.ACCOUNT_FINAL, "ManagerApproved");
  // Which is exactly why the step codes have to differ.
  assert.notEqual(STEP_ORDER.ACCOUNT, STEP_ORDER.ACCOUNT_FINAL);
});

test("approving each step lands where the spec says", () => {
  assert.deepEqual(STATE_AFTER_APPROVE.MANAGER, { status: "ManagerApproved", nextStep: "ACCOUNT" });
  assert.deepEqual(STATE_AFTER_APPROVE.ACCOUNT, { status: "ManagerApproved", nextStep: "ACCOUNT_FINAL" });
  assert.deepEqual(STATE_AFTER_APPROVE.ACCOUNT_FINAL, { status: "Approved", nextStep: null });
});

test("the step codes are the three AP-4 uses and nothing else", () => {
  assert.equal(isReimburseStepCode("ACCOUNT_FINAL"), true);
  assert.equal(isReimburseStepCode("HEAD_ACCOUNT"), false);
  assert.equal(isReimburseStepCode(null), false);
  assert.equal(isAccountStep("MANAGER"), false);
  assert.equal(isAccountStep("ACCOUNT"), true);
  assert.equal(isAccountStep("ACCOUNT_FINAL"), true);
});

/* ─────────────────────────── the approver pool ─────────────────────────── */

test("an active approver is found by StaffId", () => {
  const roster = [approver({ staffId: 10176 }), approver({ staffId: 10177 })];
  assert.equal(findActiveApprover(roster, 10177, null)?.staffId, 10177);
});

test("an approver with no HR StaffId is still found by their login email, case-folded", () => {
  const roster = [approver({ staffId: 10176, email: "Q.Somsri@rocksgroup.com" })];
  assert.equal(findActiveApprover(roster, null, "  q.somsri@ROCKSGROUP.com ")?.staffId, 10176);
});

test("a deactivated approver is not found by either key", () => {
  const roster = [approver({ staffId: 10176, email: "gone@rocksgroup.com", isActive: false })];
  assert.equal(findActiveApprover(roster, 10176, "gone@rocksgroup.com"), null);
});

test("somebody outside the pool is not an approver, whatever their StaffId", () => {
  const roster = [approver({ staffId: 10176 })];
  assert.equal(findActiveApprover(roster, 99999, "someone@rocksgroup.com"), null);
  assert.equal(findActiveApprover([], 10176, "staff10176@rocksgroup.com"), null);
  assert.equal(NOT_ACCOUNT_APPROVER_ERROR.length > 0, true);
});

test("StaffId wins over email, so an actor acts as their own roster row", () => {
  const roster = [
    approver({ staffId: 10176, email: "shared@rocksgroup.com" }),
    approver({ staffId: 10177, email: "shared@rocksgroup.com" }),
  ];
  assert.equal(findActiveApprover(roster, 10177, "shared@rocksgroup.com")?.staffId, 10177);
});

/* ─────────────────────────── the two-person rule ─────────────────────────── */

test("the step-2 actor is read off the approved ACCOUNT row", () => {
  const approvals = [
    approval({ stepCode: "MANAGER", status: "Approved", actionedByStaffId: 5001 }),
    approval({ stepCode: "ACCOUNT", status: "Approved", actionedByStaffId: 10176 }),
    approval({ stepCode: "ACCOUNT_FINAL", status: "Pending" }),
  ];
  assert.equal(accountCheckActorStaffId(approvals), 10176);
});

test("a pending or rejected ACCOUNT row names nobody", () => {
  assert.equal(accountCheckActorStaffId([approval({ stepCode: "ACCOUNT", status: "Pending" })]), null);
  assert.equal(
    accountCheckActorStaffId([approval({ stepCode: "ACCOUNT", status: "Rejected", actionedByStaffId: 10176 })]),
    null,
  );
  assert.equal(accountCheckActorStaffId(null), null);
  assert.equal(accountCheckActorStaffId([]), null);
});

test("the same person is refused with the reason, not with a bare no-permission", () => {
  assert.equal(finalStepRefusal(10176, 10176), FINAL_SAME_PERSON_ERROR);
});

test("a different approver is not refused at all", () => {
  assert.equal(finalStepRefusal(10177, 10176), null);
});

test("StaffId 0 is a present id on either side, not a missing one", () => {
  // `canActFinalStep` compares with `== null` for exactly this case; a
  // truthiness guard in front of it would deny a legitimate approval.
  assert.equal(finalStepRefusal(0, 10176), null);
  assert.equal(finalStepRefusal(10176, 0), null);
  assert.equal(finalStepRefusal(0, 0), FINAL_SAME_PERSON_ERROR);
});

test("an unrecorded step-2 actor says so rather than accusing anyone", () => {
  assert.equal(finalStepRefusal(10177, null), ACCOUNT_ACTOR_UNKNOWN_ERROR);
  assert.equal(finalStepRefusal(null, 10176), ACCOUNT_ACTOR_UNKNOWN_ERROR);
});

/* ─────────────────────────── inputs off the wire ─────────────────────────── */

test("a rejection without a reason is refused, whitespace included", () => {
  assert.equal(rejectCommentOrError("   ").error, REJECT_COMMENT_REQUIRED);
  assert.equal(rejectCommentOrError("").error, REJECT_COMMENT_REQUIRED);
  assert.equal(rejectCommentOrError(undefined).error, REJECT_COMMENT_REQUIRED);
  assert.equal(rejectCommentOrError(42).error, REJECT_COMMENT_REQUIRED);
});

test("a reason is trimmed and kept", () => {
  assert.deepEqual(rejectCommentOrError("  ใบเสร็จไม่ครบ  "), { comment: "ใบเสร็จไม่ครบ", error: null });
});

test("a YYYY-MM-DD that is not a real day is not a date", () => {
  assert.equal(isYmd("2026-08-07"), true);
  assert.equal(isYmd("2026-02-31"), false);
  assert.equal(isYmd("2026-13-01"), false);
  assert.equal(isYmd("07/08/2026"), false);
  assert.equal(isYmd(null), false);
});

test("a payment date the picker would not offer is refused", () => {
  const valid = ["2026-08-07", "2026-08-21"];
  assert.equal(paymentDateError("2026-08-07", valid), null);
  // A perfectly real Friday — just the 2nd one, which is AP-1's round.
  assert.equal(paymentDateError("2026-08-14", valid), PAYMENT_DATE_NOT_A_ROUND);
  assert.equal(paymentDateError("", valid), PAYMENT_DATE_REQUIRED);
  assert.equal(paymentDateError(undefined, valid), PAYMENT_DATE_REQUIRED);
});

/* ─────────────────────────── the default round ─────────────────────────── */

test("the rounds handed to defaultPaymentRound are sorted ascending", () => {
  const rounds = upcomingPaymentRounds(new Date(2026, 7, 3), 4);
  const sorted = rounds.slice().sort((a, b) => a.getTime() - b.getTime());
  assert.deepEqual(rounds.map(ymd), sorted.map(ymd));
  // Two per month over five months (the anchor month plus four).
  assert.equal(rounds.length, 10);
  assert.equal(ymd(rounds[0]), "2026-08-07");
});

test("the rounds start at the anchor month even when its first round has passed", () => {
  // The list is not filtered by `from`; it is the calendar, and
  // `defaultPaymentRound` is what drops the rounds that are no longer reachable.
  const rounds = upcomingPaymentRounds(new Date(2026, 7, 25), 1);
  assert.equal(ymd(rounds[0]), "2026-08-07");
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 25), rounds)!), "2026-09-04");
});

test("the default off the real round list is the first one still in time", () => {
  const rounds = upcomingPaymentRounds(new Date(2026, 7, 3), 4);
  // Monday 3 Aug 2026 11:00 — that week's Friday is the 1st round of August.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 11, 0), rounds)!), "2026-08-07");
  // Monday 13:00 — past that round's own Monday noon, so the next round.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 13, 0), rounds)!), "2026-08-21");
});

/* ─────────────────────── the step the actor saw (finding 2) ─────────────────────── */

test("the posted step matching the record's is no refusal at all", () => {
  assert.equal(stepTokenRefusal("MANAGER", "MANAGER"), null);
  assert.equal(stepTokenRefusal("ACCOUNT", "ACCOUNT"), null);
  assert.equal(stepTokenRefusal("ACCOUNT_FINAL", "ACCOUNT_FINAL"), null);
});

test("the stale accounting-check click is refused before it can take the final approval", () => {
  // A holds the page at the check; B performs it; the record is now at
  // ACCOUNT_FINAL. A clicks the check bar. Dispatching on the record alone would
  // run the final approval — A is a different person, so the two-person rule
  // passes — and record A's consent to a step A never saw.
  assert.deepEqual(stepTokenRefusal("ACCOUNT", "ACCOUNT_FINAL"), {
    error: NOT_AT_STEP_ERROR,
    status: 409,
  });
});

test("a finished request refuses any step, rather than falling through", () => {
  assert.deepEqual(stepTokenRefusal("ACCOUNT_FINAL", null), {
    error: NOT_AT_STEP_ERROR,
    status: 409,
  });
  assert.deepEqual(stepTokenRefusal("MANAGER", undefined), {
    error: NOT_AT_STEP_ERROR,
    status: 409,
  });
});

test("a missing or unrecognised token is a bad request, not a stale one", () => {
  // 400 and a different message: NOT_AT_STEP_ERROR tells the reader to reload,
  // which would be a lie when the body simply never carried a step.
  for (const bad of [undefined, null, "", "account", "ACCOUNT ", 2, {}, ["ACCOUNT"]]) {
    assert.deepEqual(
      stepTokenRefusal(bad, "ACCOUNT"),
      { error: STEP_TOKEN_REQUIRED, status: 400 },
      `expected a 400 for ${JSON.stringify(bad)}`,
    );
  }
});

test("the token cannot widen anything — a valid step still has to be the current one", () => {
  // The hazard the route header warns about is a client that lies. It cannot
  // gain by it: naming a step the record is not at only refuses the caller.
  assert.equal(stepTokenRefusal("ACCOUNT_FINAL", "ACCOUNT")?.status, 409);
  assert.equal(stepTokenRefusal("MANAGER", "ACCOUNT")?.status, 409);
});

/* ─────────────────── AP-1's claims stay on AP-1 (finding 1) ─────────────────── */

/**
 * Source-level, because there is no other pure way to pin it.
 *
 * AP-4 parks a request at (Status='ManagerApproved', CurrentStepCode='ACCOUNT')
 * — byte for byte the tuple AP-1's account approval claims. AP-1's engine and
 * its action routes reach AccRequest by id alone, so before the pin an active
 * AccApprover who is on no AP-4 roster could finalize an AP-4 claim through
 * AP-1's URL: ACCOUNT_FINAL never opened, the two-person rule never run, and an
 * AP-1 2nd/4th-Friday payment date instead of AP-4's 1st/3rd.
 *
 * Anything that would prove this at runtime needs a pool, and "@/lib/acc/pool"
 * reaches "@/env", which validates the whole environment at import time — the
 * reason this whole module is import-free. Reading the source is what is left,
 * and the invariant is worth more than the elegance of the check.
 */
const SRC_ROOT = path.resolve(__dirname, "..", "..", "..");

function readSrc(relative: string): string {
  return readFileSync(path.join(SRC_ROOT, relative), "utf8");
}

/** Each "UPDATE <table> … WHERE …" in `source`, cut at the statement separator. */
function claimsOn(source: string, table: string): string[] {
  const opener = "UPDATE " + table;
  const out: string[] = [];
  let from = source.indexOf(opener);
  while (from >= 0) {
    const rest = source.slice(from);
    // A claim ends at the SQL statement separator, or at the end of the
    // template literal holding it when it is the last statement.
    const ends = [rest.indexOf(";"), rest.indexOf(String.fromCharCode(96))].filter((i) => i >= 0);
    out.push(rest.slice(0, ends.length ? Math.min.apply(null, ends) : rest.length));
    from = source.indexOf(opener, from + opener.length);
  }
  return out;
}

test("every claim approval-engine makes on AccRequest names its FormCode", () => {
  const engine = readSrc("lib/acc/approval-engine.ts");
  const claims = claimsOn(engine, "[dbo].[AccRequest]");
  // approveManager, approveAccount, reject, returnForEdit, cancelByRequester.
  assert.equal(claims.length, 5, "approval-engine should hold five AccRequest claims");
  for (const claim of claims) {
    assert.ok(claim.indexOf("WHERE") > 0, "an AccRequest UPDATE with no WHERE at all");
    assert.ok(
      claim.indexOf("FormCode=@form") > 0,
      "an AccRequest claim with no FormCode predicate: " + claim,
    );
  }
});

test("AP-1's action routes authorize against an AP-1 row, not any row", () => {
  for (const route of ["approve", "reject", "return", "submit"]) {
    const src = readSrc("app/api/request/accounting/requests/[id]/" + route + "/route.ts");
    const opener = "authorizeAccRequest(";
    let from = src.indexOf(opener);
    assert.ok(from > 0, route + "/route.ts calls no object ACL at all");
    while (from >= 0) {
      const call = src.slice(from, src.indexOf(")", from) + 1);
      assert.ok(
        call.indexOf("AP1_FORM_CODE") > 0,
        route + "/route.ts: unpinned gate " + call,
      );
      from = src.indexOf(opener, from + opener.length);
    }
  }
});

/* ───────────── the accounting queues do not cross forms (finding 3) ───────────── */

test("My Work asks each form's own approver roster", () => {
  const report = readSrc("lib/acc/report-service.ts");
  const start = report.indexOf("export async function listMyWorkRows");
  const end = report.indexOf("export async function queryReport");
  assert.ok(start > 0 && end > start, "could not locate listMyWorkRows");
  const myWork = report.slice(start, end);

  // AP-1's roster answers for AP-1 only. It used to answer for every form, so
  // an AP-1 accountant was handed every pending AP-4 accounting step — and
  // clicking one opened it over an AP-1 URL, which is the id handover the pin
  // above closes.
  const ap1 = myWork.indexOf("r.FormCode = 'AP-1'");
  assert.ok(ap1 > 0, "the AccApprover sub-select is not pinned to AP-1");
  assert.ok(
    myWork.indexOf("[dbo].[AccApprover]", ap1) > ap1,
    "the AP-1 pin does not sit in front of the AccApprover sub-select",
  );

  // …and AP-4's own pool answers for AP-4, at both of its accounting steps.
  const ap4 = myWork.indexOf("r.FormCode = 'AP-4'");
  assert.ok(ap4 > 0, "My Work has no AP-4 clause");
  assert.ok(
    myWork.indexOf("[dbo].[AccReimburseApprover]", ap4) > ap4,
    "the AP-4 clause does not consult AccReimburseApprover",
  );
  assert.ok(
    myWork.indexOf("'ACCOUNT', 'ACCOUNT_FINAL'", ap4) > ap4,
    "the AP-4 clause leaves ACCOUNT_FINAL in nobody's queue",
  );
});

/* ────────── the constant every pin is written against (task 8a, step 8) ────────── */

test("AP1_FORM_CODE is exactly the string stored in AccRequest.FormCode", () => {
  // Every pin above — the five engine claims, the four action routes, the two
  // write routes below — is spelled `AP1_FORM_CODE` rather than 'AP-1', so all
  // of them are only as good as this one value. `AccFormMaster` seeds 'AP-1'
  // (migration 013) and `AccRequest.FormCode` has a foreign key to it, so a
  // typo here would not fail loudly: the pinned predicates would simply match
  // nothing and every claim would silently stop working.
  assert.equal(AP1_FORM_CODE, "AP-1");
  assert.equal(AP4_FORM_CODE, "AP-4");
  assert.notEqual(AP1_FORM_CODE, AP4_FORM_CODE);
});

/* ────────── AP-1's own write routes stay on AP-1 (task 8a, step 6) ────────── */

/** The body of `export async function NAME`, to the next such opener or EOF. */
function exportedFunction(source: string, name: string): string {
  const opener = "export async function " + name;
  const from = source.indexOf(opener);
  assert.ok(from > 0, "no " + name + " in the source read");
  const next = source.indexOf("export async function ", from + opener.length);
  return source.slice(from, next > 0 ? next : source.length);
}

test("PUT and DELETE on an AP-1 request authorize against an AP-1 row", () => {
  // Task 7 pinned the five engine claims and the four action routes; these two
  // called `authorizeAccRequest` not at all. On an AP-4 Draft the caller owns,
  // PUT rewrote the shared header through AP-1's `resolveRequesterForActor` and
  // clobbered TotalAmount, and DELETE removed the AccRequest row — taking
  // AccReimburse and AccReimburseItem with it through ON DELETE CASCADE — while
  // logging an AP-1 deleteDraft.
  const src = readSrc("app/api/request/accounting/requests/[id]/route.ts");
  for (const method of ["PUT", "DELETE"]) {
    const body = exportedFunction(src, method);
    const from = body.indexOf("authorizeAccRequest(");
    assert.ok(from > 0, method + " calls no object ACL at all");
    const call = body.slice(from, body.indexOf(")", from) + 1);
    assert.ok(call.indexOf('"mutate"') > 0, method + ": gate is not a mutate gate — " + call);
    assert.ok(call.indexOf("AP1_FORM_CODE") > 0, method + ": unpinned gate — " + call);
  }
});

test("saveDraft and deleteDraft read the row they are about to write by form as well as by id", () => {
  // The route gate above and this predicate are two independent answers to the
  // same question, deliberately: `POST /api/request/accounting/requests` takes a
  // body-supplied `id` into the very same `saveDraft` and has no gate of its
  // own, so the SQL is what closes that path.
  const src = readSrc("lib/acc/request-service.ts");
  const opener = "SELECT CreatedBy, Status FROM [dbo].[AccRequest]";
  const found: string[] = [];
  let from = src.indexOf(opener);
  while (from >= 0) {
    found.push(src.slice(from, src.indexOf(String.fromCharCode(96), from)));
    from = src.indexOf(opener, from + opener.length);
  }
  // saveDraft's update branch, deleteDraft, and deleteItem — the third was
  // found by this assertion rather than by the review that asked for the first
  // two, which is the whole point of counting them.
  assert.equal(found.length, 3, "request-service should hold three ownership reads");
  for (const read of found) {
    assert.ok(
      read.indexOf("FormCode=@form") > 0,
      "an ownership read with no FormCode predicate: " + read,
    );
  }
});

/* ────────── one source for the step sequence (task 8a, step 8) ────────── */

test("STEP_ORDER agrees with REIMBURSE_STEP_CODES, in that order", () => {
  // `ReimburseDetail` draws its timeline skeleton straight off
  // `REIMBURSE_STEP_CODES` rather than keeping a third copy of the sequence. It
  // may only import `approval-policy` as a type, so it cannot read `STEP_ORDER`
  // — which is the authority on the persisted `AccApproval.StepOrder`. This is
  // what makes reading the order off the constants array a checked fact.
  assert.deepEqual(Array.from(REIMBURSE_STEP_CODES), ["MANAGER", "ACCOUNT", "ACCOUNT_FINAL"]);
  REIMBURSE_STEP_CODES.forEach((code, i) => {
    assert.equal(STEP_ORDER[code], i + 1, code + " is not at position " + (i + 1));
  });
  assert.equal(Object.keys(STEP_ORDER).length, REIMBURSE_STEP_CODES.length);
});

/* ────────── the return-for-edit path (final review, finding 1) ────────── */

/*
 * AP-4 shipped with no correction path. `Status='Returned'` had exactly one
 * writer — AP-1's `returnForEdit` — and pinning that route to `AP1_FORM_CODE`
 * (correctly) removed AP-4's only way back, leaving a submitted claim that could
 * only be approved or killed. A rejection is terminal, so the sole remedy was to
 * re-key every line, re-upload every receipt and burn a second RBM number.
 *
 * Everything downstream of `Returned` had been built and was unreachable. These
 * pin the parts of the route back that a future pin could remove again.
 */

test("a return demands a note, and asks for a different thing than a rejection", () => {
  const empty = returnCommentOrError("   ");
  assert.equal(empty.comment, null);
  assert.equal(empty.error, RETURN_COMMENT_REQUIRED);

  // A return with no note puts the request back in the requester's hands saying
  // nothing about why — which is the entire purpose of the action.
  assert.notEqual(RETURN_COMMENT_REQUIRED, REJECT_COMMENT_REQUIRED);

  for (const bad of ["", "\n\t", null, undefined, 42, {}, []]) {
    assert.equal(returnCommentOrError(bad).error, RETURN_COMMENT_REQUIRED);
  }

  const ok = returnCommentOrError("  แนบใบเสร็จไม่ครบ  ");
  assert.equal(ok.error, null);
  assert.equal(ok.comment, "แนบใบเสร็จไม่ครบ");
});

test("returnReimburse claims the transition and clears the payment date", () => {
  const src = readSrc("lib/acc/reimburse/approval-service.ts");
  const body = src.slice(src.indexOf("export async function returnReimburse"));
  // \r?\n rather than \n: git checks this repo out with CRLF on Windows
  // (core.autocrlf=true), where the old indexOf found nothing, returned -1,
  // and sliced the body down to a single character — so every assertion
  // below read an empty function and failed for a reason that was not the
  // code's.
  const close = /\r?\n\}\r?\n/.exec(body);
  const fn = close ? body.slice(0, close.index + close[0].indexOf("}") + 1) : "";

  assert.ok(fn.length > 0, "returnReimburse not found");
  // Claimed, never read-then-written: `claimStep` is the conditional UPDATE that
  // names FormCode, CurrentStepCode and Status together and checks rowsAffected.
  assert.ok(fn.indexOf("claimStep(") > 0, "the return does not claim its transition");
  assert.ok(fn.indexOf('status: "Returned"') > 0, "the return does not land on Returned");
  assert.ok(fn.indexOf("stepCode: null") > 0, "the return leaves a CurrentStepCode behind");
  // As the step-3 rejection does: otherwise a request the requester has to edit
  // arrives carrying the date step 2 fixed for it.
  assert.ok(fn.indexOf("paymentDate: null") > 0, "the return keeps step 2's payment date");
  // The two-person rule is not weakened by adding a third action on that row.
  assert.ok(
    fn.indexOf("assertMayTakeFinalStep") > 0,
    "the return skips the two-person rule at ACCOUNT_FINAL",
  );
});

test("the return route is pinned to AP-4 and carries the step token", () => {
  const src = readSrc("app/api/request/reimburse/requests/[id]/return/route.ts");

  // Without the pin an AP-1 id reaching this URL is authorized by an ACL that
  // was told nothing about which form it belongs to.
  assert.ok(src.indexOf("AP4_FORM_CODE") > 0, "the return route is not pinned to AP-4");
  assert.ok(src.indexOf("authorizeAccRequest") > 0, "the return route skips the object ACL");
  // The same staleness guard approve and reject carry: `claimStep` asserts the
  // state the record is in, never the state the actor was looking at.
  assert.ok(src.indexOf("stepTokenRefusal") > 0, "the return route takes no step token");
  // The step acted on comes from the record, not the body.
  assert.ok(
    src.indexOf("request.currentStepCode") > 0,
    "the return route does not read the step off the record",
  );
});

/* ────────── the requester's own cancel (final review, addendum) ────────── */

test("the self-cancel window is inclusive at exactly 24 hours", () => {
  const submitted = new Date(2026, 7, 20, 9, 30, 0, 0);
  const deadline = selfCancelDeadline(submitted);
  assert.ok(deadline);
  assert.equal(deadline.getTime() - submitted.getTime(), SELF_CANCEL_WINDOW_HOURS * 3600 * 1000);
  // Local getters, never toISOString: the server runs on Thai time.
  assert.equal(deadline.getDate(), 21);
  assert.equal(deadline.getHours(), 9);
  assert.equal(deadline.getMinutes(), 30);

  const open = (now: Date) =>
    selfCancelRefusal({
      isRequester: true,
      status: "Submitted",
      currentStepCode: "MANAGER",
      submittedAt: submitted,
      now,
    });

  assert.equal(open(new Date(deadline.getTime() - 1)), null, "one ms before the deadline");
  assert.equal(open(deadline), null, "exactly on the deadline is still inside the window");
  assert.equal(
    open(new Date(deadline.getTime() + 1))?.reason,
    "window_expired",
    "one ms past the deadline",
  );
});

test("the three refusals are told apart, and the strongest wins", () => {
  const inTime = {
    status: "Submitted",
    currentStepCode: "MANAGER",
    submittedAt: new Date(2026, 7, 20, 9, 0, 0, 0),
    now: new Date(2026, 7, 20, 10, 0, 0, 0),
  };

  // Somebody else's claim: refused before anything about its state is consulted,
  // and refused even when every other condition would have allowed it.
  assert.equal(selfCancelRefusal({ ...inTime, isRequester: false })?.reason, "not_requester");

  // The manager has already acted — a different remedy from the window one, so
  // a different message.
  const moved = selfCancelRefusal({
    ...inTime,
    isRequester: true,
    status: "ManagerApproved",
    currentStepCode: "ACCOUNT",
  });
  assert.equal(moved?.reason, "not_pending_manager");
  assert.notEqual(moved?.error, CANCEL_WINDOW_EXPIRED_ERROR);

  // A `Submitted` row with no SubmittedAt cannot be measured. "Cannot tell" is
  // not "in time".
  assert.equal(
    selfCancelRefusal({ ...inTime, isRequester: true, submittedAt: null })?.reason,
    "window_expired",
  );

  assert.equal(selfCancelRefusal({ ...inTime, isRequester: true }), null);
});

test("the cancel claim enforces the same three conditions the rule names", () => {
  const src = readSrc("lib/acc/reimburse/approval-service.ts");
  const claims = claimsOn(src, "[dbo].[AccRequest]");
  const cancel = claims.filter((c) => c.indexOf("Status='Cancelled'") > 0);
  assert.equal(cancel.length, 1, "expected exactly one cancel claim");

  const c = cancel[0];
  assert.ok(c.indexOf("FormCode=@form") > 0, "the cancel claim does not name the form");
  assert.ok(c.indexOf("CreatedBy=@uid") > 0, "the cancel claim does not name the creator");
  assert.ok(c.indexOf("CurrentStepCode='MANAGER'") > 0, "the cancel claim does not name the step");
  // The window, evaluated by the database against its own clock — the process's
  // `Date.now()` is a different clock read through none of the driver's date
  // handling. `>=` so the boundary matches the pure rule's inclusive far end.
  assert.ok(
    c.indexOf("SubmittedAt >= DATEADD(HOUR, -@hours, SYSDATETIME())") > 0,
    "the cancel claim does not enforce the window: " + c,
  );
});
