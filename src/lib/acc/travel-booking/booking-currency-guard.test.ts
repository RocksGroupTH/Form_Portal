import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The three rules AP-17's multi-currency work is **defined by its corrections
 * to**, pinned in source so the obvious thing cannot creep back in.
 *
 * Each of them was written down twice before it stuck, because each one looks
 * like an oversight to a reader who has just finished AP-1:
 *
 * 1. **`AccRequest.TotalAmount` is not changed.** For AP-17 that column is the
 *    *per-diem total alone* — the booking cost lives on
 *    `AccTravelBookingDetail` and has never reached the header. Summing it in
 *    would double the figure on My Requests, My Work and the request header for
 *    **every** AP-17 request including baht ones, and `recomputeGroupPerDiem`
 *    would silently rewrite it back from the per diem anyway.
 * 2. **No new lock, and no `Status = 'Completed'` freeze.** `AdminBookingPanel`
 *    renders only at `ManagerApproved`/`ADMIN`, so the currency control is
 *    already unreachable once accounting has signed off. `bookingFieldsLocked`
 *    is a per-row *emptiness* rule and explicitly not status-based; giving it a
 *    currency arm would strand figures somebody had already entered.
 * 3. **The rate is the server's.** The desk's toggle posts a currency and never
 *    a rate — the one part of AP-2's approach this feature does not reuse, since
 *    nothing there verifies the rate the browser sent.
 *
 * None of it is unit-testable directly: `admin-service.ts` needs a pool and
 * `@/env` validates the whole environment at import. So this reads the source,
 * in the shape `request-total-baht.test.ts` and `currency-pool-guard.test.ts`
 * already use.
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

const ADMIN_SERVICE = "lib/acc/travel-booking/admin-service.ts";
const BOOKING_ROUTE = "app/api/request/travel-booking/admin/requests/[id]/booking/route.ts";
const PANEL = "features/travel-booking/components/AdminBookingPanel.tsx";
const BOOKING_LOCK = "features/travel-booking/lib/booking-lock.ts";
const PERDIEM = "lib/acc/travel-booking/perdiem-recompute.ts";

/** Every `UPDATE [dbo].[AccRequest] SET …` statement in a source file. */
function accRequestUpdates(src: string): string[] {
  return src.match(/UPDATE \[dbo\]\.\[AccRequest\] SET[^`;]*/g) ?? [];
}

test("AP-17's booking save records a currency and a rate on the header, together", () => {
  const updates = accRequestUpdates(code(ADMIN_SERVICE));
  const currencyWrites = updates.filter((u) => u.indexOf("Currency=") >= 0);
  assert.equal(
    currencyWrites.length,
    1,
    `expected exactly one AccRequest currency write in admin-service, found ${currencyWrites.length}`,
  );
  // A currency with no rate beside it is a figure every screen would read as
  // baht, so the two columns are written by one statement or not at all.
  assert.ok(
    currencyWrites[0].indexOf("ExchangeRate=") >= 0,
    "the currency write must set ExchangeRate in the same statement",
  );
});

/**
 * Correction 1. If this goes red the fix is to take the write out, never to
 * relax the assertion — and if the business does want the booking cost summed
 * into the header, that is a separate change which must also amend
 * `perdiem-recompute.ts` and its test, and which changes baht requests too.
 */
test("AP-17's booking save never writes AccRequest.TotalAmount or ForeignAmount", () => {
  for (const stmt of accRequestUpdates(code(ADMIN_SERVICE))) {
    assert.equal(
      /TotalAmount/.test(stmt),
      false,
      "AccRequest.TotalAmount is AP-17's per-diem total — the booking cost must not reach it: " + stmt,
    );
    // AP-1 documents ForeignAmount as the figure of which TotalAmount is the
    // conversion. Here TotalAmount is a different quantity in a different
    // currency, so filling it in would assert a relationship that does not hold.
    assert.equal(/ForeignAmount/.test(stmt), false, "ForeignAmount states a relationship AP-17 does not have: " + stmt);
  }
});

/** The other half of correction 1: per diem is always baht, so nothing converts it. */
test("the per-diem recompute knows nothing about currency", () => {
  const src = code(PERDIEM);
  assert.equal(
    /Currency|ExchangeRate|toBaht/.test(src),
    false,
    "per diem is always baht — EmployeeAllowanceLog has no currency column, so there is no data to convert",
  );
});

/**
 * Correction 2. `bookingFieldsLocked` answers "has anybody started this row",
 * and it was extracted precisely *because* a status-shaped version of it broke.
 */
test("bookingFieldsLocked stays a per-row emptiness rule — no currency arm, no status arm", () => {
  const src = code(BOOKING_LOCK);
  assert.equal(/[Cc]urrency/.test(src), false, "booking-lock.ts must not learn about currency");
  assert.equal(/["']Completed["']|status/.test(src), false, "booking-lock.ts must not become status-based");
});

test("no Status = 'Completed' amount freeze is invented in the admin panel or its service", () => {
  for (const file of [PANEL, ADMIN_SERVICE]) {
    assert.equal(
      /["']Completed["']/.test(code(file)),
      false,
      `${file} invents a 'Completed' check — the ManagerApproved/ADMIN step gate is already the lock`,
    );
  }
});

/**
 * Correction 3, at both ends. `currency` is admitted; anything rate-shaped is
 * not. The service re-derives the currency from the request's own stored
 * `BrandCode` and `CountryCode` regardless, so the posted value can only ever
 * opt IN to a currency one of those two already implies — everything else lands
 * back on baht.
 */
test("the booking save accepts a currency and no rate, at the route and at the service", () => {
  const routeSrc = code(BOOKING_ROUTE);
  assert.ok(routeSrc.indexOf("currency") > 0, "the route must pass the desk's currency through");
  assert.equal(
    /exchangeRate|rate\s*\?:/.test(routeSrc),
    false,
    "the route must not accept a rate — the service fetches one",
  );

  const src = code(ADMIN_SERVICE);
  const start = src.indexOf("export async function saveBookingDetail");
  assert.notEqual(start, -1, "saveBookingDetail not found");
  const signature = src.slice(start, src.indexOf("actor: Actor", start));
  assert.ok(/currency\?:/.test(signature), "saveBookingDetail must accept the chosen currency");
  assert.equal(
    /exchangeRate|rate\s*\?:/.test(signature),
    false,
    "saveBookingDetail must NOT accept a rate — it calls resolveRate itself",
  );
});

/**
 * `toBaht` returning null is a refusal. There is no third branch on purpose:
 * falling back to the unconverted figure is the one failure this whole feature
 * exists to prevent, and it would leave no trace on any screen.
 */
test("assertConvertible refuses rather than falling back", () => {
  const src = code(ADMIN_SERVICE);
  const start = src.indexOf("function assertConvertible");
  assert.notEqual(start, -1, "assertConvertible not found");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(/toBaht\(/.test(body), "it must actually attempt the conversion");
  assert.ok(/=== null\) throw/.test(body), "a null conversion must throw");
  assert.equal(/\?\?/.test(body), false, "it must never substitute a value for the refusal");
});

/**
 * **The three places that decide what a booking may be recorded in must ask the
 * same question of the same two inputs**, and this arm exists because they did
 * not for one commit on 2026-09-02.
 *
 * The panel offers a set, the AI-read route asks the model to answer from a set,
 * and `resolveBookingFx` accepts a set. When the panel moved from the brand to
 * the destination and the route was left on the brand, a PCTH trip to London
 * offered the desk GBP while the route asked the baht-only question — so a GBP
 * invoice came back reported as baht and its figures were recorded as baht. No
 * type caught it: both sides compiled, and both were individually correct.
 *
 * What makes that unrepeatable is that all three build from `brandCode` AND
 * `countryCode` through `bookingCurrencyOptions`. Narrowing any one of them to a
 * single input is what this refuses.
 */
const READ_CLIENT = "features/travel-booking/lib/read-booking-fields.ts";
const FIELDS_ROUTE = "app/api/request/travel-booking/booking-fields/route.ts";

test("the panel, the AI read and the save all derive the currency from brand AND country", () => {
  for (const [file, what] of [
    [PANEL, "the panel's toggle"],
    [FIELDS_ROUTE, "the AI read's candidate list"],
    [ADMIN_SERVICE, "the save's accepted set"],
  ] as [string, string][]) {
    const src = code(file);
    assert.ok(
      /bookingCurrencyOptions\s*\(|effectiveBookingCurrency\s*\(/.test(src),
      `${what} must come from booking-currency.ts, not a hand-built list (${file})`,
    );
    assert.ok(/brandCode/.test(src), `${what} must consider the brand (${file})`);
    assert.ok(/countryCode/.test(src), `${what} must consider the destination (${file})`);
  }
});

/**
 * Both codes have to actually travel from the desk to the route, or the read
 * narrows and the model is asked the wrong question.
 *
 * The client half matches the **`params.set` call**, not a mention of the name.
 * A first draft of this searched for the bare string and passed with the send
 * deleted — `read-booking-fields.ts` names `brandCode` in its options interface
 * and again reading that option, so a mention proves nothing. Verified by
 * removing each `params.set` line and watching this fail.
 */
test("the AI read sends both codes, and the route reads both", () => {
  const client = code(READ_CLIENT);
  assert.ok(
    /params\.set\(\s*["']brandCode["']/.test(client),
    "the read client must send ?brandCode=",
  );
  assert.ok(
    /params\.set\(\s*["']countryCode["']/.test(client),
    "the read client must send ?countryCode=",
  );

  const route = code(FIELDS_ROUTE);
  assert.ok(
    /searchParams\.get\(\s*["']brandCode["']\s*\)/.test(route),
    "the route must read ?brandCode=",
  );
  assert.ok(
    /searchParams\.get\(\s*["']countryCode["']\s*\)/.test(route),
    "the route must read ?countryCode=",
  );
});

/**
 * **A positive currency pick the request no longer admits must RAISE, not fall
 * back to baht**, and this is the money arm of this file.
 *
 * The panel reads the brand's currencies once at mount; `resolveBookingFx`
 * re-reads them on every save. An admin switching one off in between leaves the
 * desk posting a code the union no longer holds. Resolved to baht the save
 * *succeeds*: `needsRate('THB')` is false, so the header is written with a NULL
 * currency and NULL rate, and `recomputeBookingBaht` then stores
 * `TotalAmountBaht = TotalAmount` **unconverted** — £500 recorded as ฿500, no
 * error anywhere, carried into the accounting sign-off by `report-service`'s
 * `SUM(TotalAmountBaht)`.
 *
 * Two halves, and both are needed. The blank/THB short-circuit must come first,
 * so "nobody chose" still means baht; and the THB result after it must throw, so
 * "what you chose is gone" does not.
 */
test("resolveBookingFx refuses a stale currency rather than recording it as baht", () => {
  const src = code(ADMIN_SERVICE);
  const start = src.indexOf("async function resolveBookingFx");
  assert.notEqual(start, -1, "resolveBookingFx not found");
  const body = src.slice(start, src.indexOf("\n}", start));

  assert.ok(
    /want === THB \|\| want === ""/.test(body),
    "an absent or baht choice must short-circuit before anything else — that is the " +
      "only case that legitimately means baht",
  );
  assert.ok(
    /if \(currency === THB\) throw/.test(body),
    "a positive pick that resolves to baht is a stale pick and must throw; falling " +
      "back would record the foreign figures unconverted",
  );
  assert.ok(
    /AccConflictError/.test(body),
    "it must be a conflict, so the route answers 409 rather than 400's retry affordance",
  );
  // The order is the rule: the throw must come after the short-circuit, or an
  // absent currency raises instead of meaning baht.
  assert.ok(
    body.indexOf('want === ""') < body.indexOf("if (currency === THB) throw"),
    "the short-circuit must precede the throw",
  );
});

/**
 * **The panel now holds a rate, and it must never post one.**
 *
 * Until 2026-09-02 the browser had no rate at all on this screen, so the rule
 * "the rate is the server's" was enforced by there being nothing to send. The
 * baht preview changed that: `shownRate` is in scope in `AdminBookingPanel`,
 * fetched from `/api/request/accounting/fx-rate` for display, and it now sits a
 * few lines from the save's `JSON.stringify`.
 *
 * AP-2 is what happens without this — its browser fetches a rate and posts it,
 * and `advance-request-service.ts` stores it unverified, so a requester can
 * choose the rate their own claim converts at. The route and the service already
 * refuse a rate (the test above); this refuses it a step earlier, at the only
 * place that now has one to offer.
 */
test("the admin panel never sends a rate, though it now has one to show", () => {
  const src = code(PANEL);
  const bodies = src.match(/JSON\.stringify\(\{[\s\S]{0,600}?\}\)/g) ?? [];
  assert.ok(bodies.length > 0, "no request bodies found in the panel — has the save moved?");
  for (const body of bodies) {
    assert.equal(
      /shownRate|previewRate|exchangeRate|\brate\b/.test(body),
      false,
      "the panel must not post a rate; the server fetches its own on every save: " + body,
    );
  }
  // A guard on the guard: the preview must actually exist, or the arm above is
  // forbidding something nothing could do.
  assert.ok(
    /shownRate/.test(src),
    "AdminBookingPanel no longer derives a shown rate — if the preview is gone, drop this arm",
  );
});
