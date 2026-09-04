import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The accounting rate override, pinned in source.
 *
 * `request-total-baht.test.ts` guards `AccRequest.TotalAmount`'s three writers
 * in `request-service.ts` — and only there. This override is the **fourth**
 * writer of that column anywhere in the application and it lives in a different
 * file, so the count in that test stays right and says nothing about this one.
 * This is the guard for this one; if either goes red the fix is to route the
 * new write through `toBaht`, never to relax a count.
 *
 * None of it is unit-testable directly: `rate-override.ts` needs a pool and
 * `@/env` validates the whole environment at import. So this reads the source,
 * in the shape `request-total-baht.test.ts` and `booking-currency-guard.test.ts`
 * already use. The rule *itself* — what a given rate does to a given claim — is
 * pure and tested for real in `rate-override-policy.test.ts`.
 */

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/** Comments quoting a rule must not satisfy or trip the check for it. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SERVICE = "lib/acc/rate-override.ts";
const POLICY = "lib/acc/rate-override-policy.ts";
const AP1_ROUTE = "app/api/request/accounting/requests/[id]/exchange-rate/route.ts";
const AP17_ROUTE = "app/api/request/travel-booking/requests/[id]/exchange-rate/route.ts";
const PANEL = "features/accounting/components/ExchangeRateOverride.tsx";
const AP1_QUEUE = "features/accounting/components/ApprovalsQueue.tsx";
const AP17_QUEUE = "app/(dashboard)/request/accounting/travel-booking/approvals/page.tsx";

/* ── The per-line override, AP-1's since migration 129 ── */

const LINE_SERVICE = "lib/acc/line-rate-override.ts";
const LINE_ROUTE =
  "app/api/request/accounting/requests/[id]/items/[itemId]/exchange-rate/route.ts";
const LINE_PANEL = "features/accounting/components/LineExchangeRateOverride.tsx";

/**
 * The one rule the whole feature exists for. `planRateOverride` is the only
 * thing that decides the new total, and it converts with `toBaht` and refuses
 * on null — there is no branch that keeps the old baht figure beside a new
 * rate, and none that writes the unconverted foreign figure into a baht column.
 */
test("the new total comes from toBaht, and a null conversion refuses the save", () => {
  const policy = code(POLICY);
  assert.ok(/toBaht\(/.test(policy), "planRateOverride must actually convert");
  assert.ok(
    /if \(baht === null\) return \{ ok: false, reason: "unconvertible" \}/.test(policy),
    "a null conversion must refuse, not fall back",
  );
  assert.equal(
    /\?\?\s*(amount|current\.foreignAmount)/.test(policy),
    false,
    "nothing may substitute the unconverted figure for the refusal",
  );

  const service = code(SERVICE);
  assert.ok(/planRateOverride\(/.test(service), "the service must plan through the pure rule");
  assert.ok(
    /if \(!decision\.ok\) \{[\s\S]{0,200}?throw/.test(service),
    "a refused plan must throw before anything is written",
  );
  assert.equal(
    /toBaht|foreignAmount\s*\*/.test(service),
    false,
    "the conversion belongs to the pure rule — a second copy here would drift",
  );
});

/**
 * The step is the write's own predicate, on both statements, and `FormCode` is
 * bound with it. Every `Acc*` form writes to `[dbo].[AccRequest]` and AP-4
 * parks a claim on the very same (ManagerApproved, ACCOUNT) tuple, so without
 * the form pin an AP-1 accountant could rewrite an AP-4 claim's total through
 * AP-1's URL — the same Critical `approval-engine.ts` records.
 */
test("every AccRequest statement here is pinned to the form AND to the ACCOUNT step", () => {
  const src = code(SERVICE);
  const statements = src.match(/(SELECT|UPDATE)[\s\S]*?\[dbo\]\.\[AccRequest\][\s\S]*?CurrentStepCode='ACCOUNT'/g) ?? [];
  assert.equal(statements.length, 2, `expected the guarded read and the guarded update, found ${statements.length}`);
  for (const stmt of statements) {
    assert.ok(/FormCode=@form/.test(stmt), "not pinned to a form: " + stmt);
    assert.ok(/Status='ManagerApproved'/.test(stmt), "not pinned to the status: " + stmt);
  }
  // The read holds the row for the write — without it an approveAccount can
  // land between the two and a correction be written over a signed-off claim.
  assert.ok(/WITH \(UPDLOCK, ROWLOCK\)/.test(src), "the read must lock the row it is about to rewrite");
  assert.ok(/rowsAffected\[0\] \?\? 0\) === 0/.test(src), "the update must check it actually claimed the row");
});

/** Parameterised SQL only — the house rule, and this statement carries money. */
test("the override's SQL binds every value", () => {
  const src = code(SERVICE);
  const statements = src.match(/query\(`[\s\S]*?`\)/g) ?? [];
  assert.ok(statements.length >= 3, "expected the read, the update and the activity insert");
  for (const stmt of statements) {
    assert.equal(/\$\{/.test(stmt), false, "an interpolated fragment reached the SQL: " + stmt);
  }
});

/**
 * Every override is recorded, with the old rate, the new rate and who made it,
 * **in the same transaction as the rewrite** — a corrected rate must never
 * exist without the line saying who corrected it and from what. Unlike the
 * brand-currency case this event has a request, so `AccActivityLog` is the
 * right table: its `RequestId` is `int NOT NULL` with `FK_AccActivity_Request`.
 */
test("the audit row is written by the same transaction as the rewrite", () => {
  const src = code(SERVICE);
  assert.ok(
    /INSERT INTO \[dbo\]\.\[AccActivityLog\][\s\S]*?'exchange_rate_overridden'/.test(src),
    "no exchange_rate_overridden activity row",
  );
  const begin = src.indexOf("await tx.begin()");
  const insert = src.indexOf("exchange_rate_overridden");
  const commit = src.indexOf("await tx.commit()");
  assert.ok(begin !== -1 && insert !== -1 && commit !== -1, "transaction shape not found");
  assert.ok(begin < insert && insert < commit, "the audit insert must sit inside the transaction");
  // tx.request(), not pool.request() — the latter would run outside it.
  const auditCall = src.slice(src.lastIndexOf("tx", insert - 900), insert);
  assert.ok(/tx\s*\n?\s*\.request\(\)/.test(auditCall), "the audit insert must use the transaction's request");

  assert.ok(/previousRate/.test(src) && /rate\.toFixed\(6\)/.test(src), "the note must carry both rates");
  assert.ok(/input\("by", sql\.Int, actor\.userId\)/.test(src), "the note must record who made it");
});

/* ── The screens ── */

/**
 * No screen names the provider of the stored rate.
 *
 * A Bank of Thailand key was registered as `BOT_CURRENCY_RATE` on 2026-09-04, so
 * rates recorded from then on are the Bank of Thailand selling rate while
 * everything before is the ECB mid-market fallback. Naming either would state
 * something false about the rows stored under the other, on the screen
 * accounting signs off against. What the panel must still say is that the figure
 * may not be what the bank charged — that is the reason the override exists.
 */
test("the override panel says อัตราอ้างอิง and never names a rate provider", () => {
  // The rendered copy only. This file's own doc comment, and the panel's, name
  // the Bank of Thailand in order to explain why the caption does not.
  const src = code(PANEL);
  assert.ok(src.indexOf("อัตราอ้างอิง") !== -1, "the panel must caption the figure as a reference rate");
  assert.equal(/ธนาคารแห่งประเทศไทย|Bank of Thailand/.test(src), false, "the panel names the BOT");
  // The point of the override, said out loud where the correction is made.
  assert.ok(
    src.indexOf("อาจต่างจากอัตราที่ธนาคารใช้จ่ายจริง") !== -1,
    "the panel must say the rate may not be what the bank charged",
  );
});

/** A baht claim, or one off the step, shows nothing new at all. */
test("the panel renders nothing for a baht claim or off the ACCOUNT step", () => {
  const src = code(PANEL);
  assert.ok(
    /if \(!atAccountStep \|\| isBaht\(currency\)\) return null;/.test(src),
    "the panel must bail out before rendering anything",
  );
});

/**
 * Both callers compute `atAccountStep` the same way, and it is the same tuple
 * the server's UPDATE predicate carries. A screen that offered the control one
 * step early would only produce refusals.
 */
test("both queues gate the panel on ManagerApproved/ACCOUNT", () => {
  const ap1 = code(AP1_QUEUE);
  assert.ok(
    /status === "ManagerApproved" &&[\s\S]{0,80}?currentStepCode === "ACCOUNT"/.test(ap1),
    "AP-1's queue must gate the override on the ACCOUNT step",
  );
  assert.ok(/ExchangeRateOverride/.test(ap1), "AP-1's queue must render the override");

  const ap17 = code(AP17_QUEUE);
  assert.ok(/ExchangeRateOverride/.test(ap17), "AP-17's queue must render the override");
  assert.ok(
    /atAccountStep=\{panelRequestId != null\}/.test(ap17),
    "AP-17 must reuse panelRequestId, which is already exactly that test",
  );
  // AP-17 has no ForeignAmount: its header total is per diem, always baht.
  assert.ok(/foreignAmount=\{null\}/.test(ap17), "AP-17 must not claim a foreign amount it does not have");
});

/* ── The gates ── */

/**
 * Nothing here loosens what the approve routes already enforce — the override
 * reproduces each form's own ACCOUNT-step gate rather than reaching around it.
 */
test("AP-1's route carries the ACCOUNT branch of approve, verbatim", () => {
  const src = code(AP1_ROUTE);
  assert.ok(/authorizeAccRequest\(session, id, "read", AP1_FORM_CODE\)/.test(src), "object ACL, pinned to AP-1");
  assert.ok(/canAccessAccountArea\(/.test(src), "account-area membership");
  assert.ok(/canActOnClaimBrand\(/.test(src), "interface scope — whose books these are");
  assert.ok(/applyRateOverride\(id, AP1_FORM_CODE,/.test(src), "the service call must name AP-1");
});

test("AP-17's route carries the gate its account-approve carries", () => {
  const src = code(AP17_ROUTE);
  assert.ok(/uatActorGate\(session\)/.test(src), "the UAT tester barrier");
  assert.ok(/canAccessBookingArea\(/.test(src), "AccBookingApprover membership or admin");
  assert.ok(/applyRateOverride\(id, AP17_FORM_CODE,/.test(src), "the service call must name AP-17");
});

/** The client posts a rate here and nowhere else — this is the one place a
    human is allowed to choose one, and the gate above is what makes it safe. */
test("the override is the only client-posted rate, and it is refused off the step", () => {
  for (const route of [AP1_ROUTE, AP17_ROUTE, LINE_ROUTE]) {
    const src = code(route);
    assert.ok(/body\.rate/.test(src), `${route} must read the posted rate`);
    assert.ok(/statusForAccError\(e\)/.test(src), `${route} must answer 409 on a stale step, not 400`);
  }
});

/* ─────────────── the per-line override (AP-1, migration 129) ─────────────── */

/**
 * Migration 129 moved AP-1's currency onto the expense line and every AP-1
 * `AccRequest` writer clears the header's currency columns, so
 * `rate-override.ts` — which reads them — stopped rendering for AP-1 entirely.
 * This is the same correction rebuilt one level down.
 *
 * `AccTravelExpenseItem.Amount` is Thai baht always, so the line's new figure
 * has to come from `toBaht` and from nothing else. A null conversion refuses.
 */
test("a line's new baht comes from toBaht, and a null conversion refuses the save", () => {
  const policy = code(POLICY);
  const start = policy.indexOf("export function planLineRateOverride");
  assert.notEqual(start, -1, "planLineRateOverride not found");
  const body = policy.slice(start, policy.indexOf("\n}", start));
  assert.ok(/toBaht\(/.test(body), "planLineRateOverride must actually convert");
  assert.ok(
    /if \(baht === null\) return \{ ok: false, reason: "unconvertible" \}/.test(body),
    "a null conversion must refuse, not fall back",
  );
  // A foreign line with no figure to convert is refused outright rather than
  // being given a rate its stored baht then disagrees with.
  assert.ok(
    /if \(line\.foreignAmount === null\) return \{ ok: false, reason: "no-foreign-amount" \}/.test(body),
    "a foreign line with nothing to convert must refuse",
  );

  const service = code(LINE_SERVICE);
  assert.ok(/planLineRateOverride\(/.test(service), "the service must plan through the pure rule");
  assert.ok(
    /if \(!decision\.ok\) \{[\s\S]{0,200}?throw/.test(service),
    "a refused plan must throw before anything is written",
  );
  assert.equal(
    /toBaht|foreignAmount\s*\*/.test(service),
    false,
    "the conversion belongs to the pure rule — a second copy here would drift",
  );
});

/**
 * Every statement is pinned to the form **and** to the ACCOUNT step, on the
 * request row it reaches through the item's two joins. AP-4 parks a claim on
 * the very same (ManagerApproved, ACCOUNT) tuple, so without `FormCode=@form`
 * an AP-1 accountant could rewrite an AP-4 claim's total through AP-1's URL.
 */
test("every per-line statement is pinned to the form AND to the ACCOUNT step", () => {
  const src = code(LINE_SERVICE);
  const statements =
    src.match(/(SELECT|UPDATE)[\s\S]*?\[dbo\]\.\[AccRequest\][\s\S]*?CurrentStepCode='ACCOUNT'/g) ?? [];
  assert.equal(
    statements.length,
    3,
    `expected the guarded read, the line update and the header rewrite, found ${statements.length}`,
  );
  for (const stmt of statements) {
    assert.ok(/FormCode=@form/.test(stmt), "not pinned to a form: " + stmt);
    assert.ok(/Status='ManagerApproved'/.test(stmt), "not pinned to the status: " + stmt);
  }
  assert.ok(
    /WITH \(UPDLOCK, ROWLOCK\)/.test(src),
    "the read must lock the request row it is about to rewrite",
  );
  const claims = src.match(/rowsAffected\[0\] \?\? 0\) === 0/g) ?? [];
  assert.equal(claims.length, 2, "both updates must check they actually claimed their row");
});

/** Parameterised SQL only — the house rule, and these statements carry money. */
test("the per-line override's SQL binds every value", () => {
  const src = code(LINE_SERVICE);
  const statements = src.match(/query\(`[\s\S]*?`\)/g) ?? [];
  assert.ok(statements.length >= 4, "expected the read, both updates and the activity insert");
  for (const stmt of statements) {
    assert.equal(/\$\{/.test(stmt), false, "an interpolated fragment reached the SQL: " + stmt);
  }
});

/**
 * The claim's stored totals are rebuilt from the lines through the **shared**
 * `computeTotalAmount`, not adjusted by a delta and not re-implemented in SQL.
 * That function is the one definition of what a travel day is worth — it knows
 * a rate vehicle's `fare` rows do not count and a manual section's `parking`
 * rows do not either — and a second copy here would drift from `saveDraft`,
 * `submitRequest` and `deleteItem` on the path that decides what a claim pays.
 */
test("the totals are recomputed from the lines through the shared rule", () => {
  const src = code(LINE_SERVICE);
  assert.ok(/computeTotalAmount\(day\)/.test(src), "the per-day total must use the shared rule");
  assert.ok(
    /computeRequestTotalAmount\(days\)/.test(src),
    "the header total must be the same sum across days",
  );
  // Read back inside the transaction, so what it totals is the line as this
  // statement has just left it.
  assert.ok(/loadTravelDays\(tx, requestId\)/.test(src), "the recompute must read within the tx");
});

/**
 * The line's new baht, both stored totals and the audit row are one
 * transaction. A corrected rate must never exist without the line saying who
 * corrected it and from what, and a corrected line must never exist beside a
 * total that still counts the old figure.
 */
test("the line, the totals and the audit row commit together", () => {
  const src = code(LINE_SERVICE);
  assert.ok(
    /INSERT INTO \[dbo\]\.\[AccActivityLog\][\s\S]*?'exchange_rate_overridden'/.test(src),
    "no exchange_rate_overridden activity row",
  );
  const begin = src.indexOf("await tx.begin()");
  const lineUpdate = src.indexOf("UPDATE i SET i.Amount=@amount");
  const insert = src.indexOf("exchange_rate_overridden");
  const commit = src.indexOf("await tx.commit()");
  assert.ok(begin !== -1 && lineUpdate !== -1 && insert !== -1 && commit !== -1, "transaction shape not found");
  assert.ok(begin < lineUpdate && lineUpdate < insert && insert < commit, "everything must sit inside the transaction");

  // The note names the line, both rates and who made the correction.
  assert.ok(/itemId/.test(src) && /previousRate/.test(src) && /rate\.toFixed\(6\)/.test(src),
    "the note must name the line and carry both rates");
  assert.ok(/input\("by", sql\.Int, actor\.userId\)/.test(src), "the note must record who made it");
});

/** The gate is AP-1's own ACCOUNT-step gate, reproduced rather than reached around. */
test("the per-line route carries the ACCOUNT branch of approve, verbatim", () => {
  const src = code(LINE_ROUTE);
  assert.ok(/authorizeAccRequest\(session, id, "read", AP1_FORM_CODE\)/.test(src), "object ACL, pinned to AP-1");
  assert.ok(/canAccessAccountArea\(/.test(src), "account-area membership");
  assert.ok(/canActOnClaimBrand\(/.test(src), "interface scope — whose books these are");
  assert.ok(/applyLineRateOverride\(id, itemId, AP1_FORM_CODE,/.test(src), "the service call must name AP-1");
});

/**
 * A baht claim, or one off the step, shows nothing new at all — and neither
 * does one with no foreign line, which is every Thai claim.
 */
test("the per-line panel renders nothing without a foreign line at the ACCOUNT step", () => {
  const src = code(LINE_PANEL);
  assert.ok(
    /if \(!atAccountStep \|\| lines\.length === 0\) return null;/.test(src),
    "the panel must bail out before rendering anything",
  );
  assert.ok(
    /isBaht\(it\.currency\) \|\| it\.foreignAmount == null/.test(src),
    "only a foreign line with a figure to convert may be offered a field",
  );
  assert.ok(src.indexOf("อัตราอ้างอิง") !== -1, "the panel must caption the figure as a reference rate");
  assert.equal(/ธนาคารแห่งประเทศไทย|Bank of Thailand/.test(src), false, "the panel names the BOT");
  assert.ok(
    src.indexOf("อาจต่างจากอัตราที่ธนาคารใช้จ่ายจริง") !== -1,
    "the panel must say the rate may not be what the bank charged",
  );
});

/**
 * Both panels are on AP-1's queue and both stay. The per-line one is what a
 * claim filed since 129 uses; the request-level one still answers for the ones
 * filed during 125's design, which are just as approvable.
 */
test("AP-1's queue renders both overrides", () => {
  const src = code(AP1_QUEUE);
  assert.ok(/LineExchangeRateOverride/.test(src), "AP-1's queue must render the per-line override");
  assert.ok(/ExchangeRateOverride/.test(src), "the request-level override must not be removed");
});
