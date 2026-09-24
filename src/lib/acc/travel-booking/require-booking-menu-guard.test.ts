import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **An AP-17 menu tick is authority, not sight — and only if every acting route
 * asks for it.**
 *
 * Source-reading, for the reason `booking-brand-scope-guard.test.ts` gives for
 * its own twin and which applies here unchanged: the failure is a **missing
 * call**. `requireBookingMenu` reaches a pool, so `@/env` validates the whole
 * environment at import and no unit test can call it — and no behavioural test
 * of the seven routes below would notice an eighth arriving without it.
 *
 * What makes this guard worth more than the usual presence check is the
 * **pairing**: the key each route passes has to match the step it acts on.
 * `BookingMenuKey` is a two-member union of strings, so handing the Admin desk
 * `"accountApproval"` type-checks perfectly and silently gates the booking
 * queue on the HR tick — the same shape as feeding `returnVehicle` the
 * `goVehicleId`, which `id-card-gate-guard.test.ts` exists to catch.
 */

const API = path.resolve(process.cwd(), "src/app/api/request/travel-booking");

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(API, p).split(path.sep).join("/");
const src = (r: string) => code(path.join(API, r));

/**
 * The two desks' own work, one key each.
 *
 * `reject` and `return` are absent deliberately — they serve BOTH desks and the
 * manager, so the key they pass is a branch rather than a constant. They have
 * their own test below.
 */
const SINGLE_KEY: Record<string, "bookingQueue" | "accountApproval"> = {
  "admin/requests/[id]/booking/route.ts": "bookingQueue",
  "admin/requests/[id]/complete/route.ts": "bookingQueue",
  "requests/[id]/account-approve/route.ts": "accountApproval",
  "requests/[id]/payment-date/route.ts": "accountApproval",
  "requests/[id]/exchange-rate/route.ts": "accountApproval",
};

const BRANCHING = ["requests/[id]/reject/route.ts", "requests/[id]/return/route.ts"];

/**
 * The attachment path, whose POST and DELETE each gate their own `booking_*`
 * branch. It is in neither list above because the gate is NOT at the top of
 * the handler and must not be: the same two methods carry the requester's own
 * ID-card file, which is gated on ownership and `Draft`/`Returned` instead.
 */
const FILES = "requests/[id]/files/route.ts";

/**
 * The one route that scopes by brand and legitimately asks for no menu.
 *
 * Its `requireBookingBrandScope` call is inside the **GET** — an area viewer
 * reading somebody else's request — and reading is not acting. Its PUT and
 * DELETE are the requester's own draft paths and never reach that branch.
 */
const READ_ONLY_SCOPE = ["requests/[id]/route.ts"];

test("each single-desk act route asks for ITS OWN menu, and no other", () => {
  for (const r of Object.keys(SINGLE_KEY)) {
    const s = src(r);
    const calls = s.match(/requireBookingMenu\s*\([^)]*\)/g) ?? [];
    assert.equal(
      calls.length,
      1,
      `${r} should call requireBookingMenu exactly once; found ${calls.length}`,
    );
    const wanted = SINGLE_KEY[r];
    const other = wanted === "bookingQueue" ? "accountApproval" : "bookingQueue";
    assert.ok(
      calls[0].indexOf(`"${wanted}"`) >= 0,
      `${r} acts on the ${wanted} desk's step but does not pass that key: ${calls[0]}`,
    );
    assert.ok(
      calls[0].indexOf(`"${other}"`) < 0,
      `${r} passes the OTHER desk's key — the two are one string union apart, so this ` +
        "type-checks and gates the wrong queue",
    );
  }
});

test("a refusal is RETURNED, never computed and dropped", () => {
  /* `requireBookingMenu` answers `NextResponse | null`, so ignoring the result
     is not a type error — it is an ungated route that still compiles and still
     passes a presence check. */
  for (const r of [...Object.keys(SINGLE_KEY), ...BRANCHING, FILES]) {
    const s = src(r);
    assert.ok(
      /const\s+menu\s*=\s*await\s+requireBookingMenu\s*\(/.test(s) &&
        /if\s*\(menu\)\s*return\s+menu;/.test(s),
      `${r} must capture requireBookingMenu's answer and return it — a discarded refusal ` +
        "gates nothing",
    );
  }
});

test("both booking-evidence branches take the คิวจอง tick", () => {
  /* One gated branch and one open one is worse than neither: the desk that
     cannot attach evidence could still delete it. */
  const s = src(FILES);
  const calls = s.match(/requireBookingMenu\s*\([^)]*\)/g) ?? [];
  assert.equal(calls.length, 2, `${FILES} should gate its POST and its DELETE`);
  for (const c of calls) {
    assert.ok(
      c.indexOf('"bookingQueue"') >= 0,
      `booking evidence is the Admin desk's work, so it takes คิวจอง: ${c}`,
    );
  }
  /* And never at the top of the handler, which would refuse every requester
     attaching their own ID card through the same two methods. */
  assert.ok(
    s.indexOf("await requireBookingMenu(") > s.indexOf("export async function POST"),
    `${FILES} gates before the branch that decides whose file this is`,
  );
});

test("the menu gate runs LAST, after the area and the brand", () => {
  /* Order is the message, not the outcome: "you are not in this area at all"
     and "not your brand" are the wider answers and must arrive first, or a
     scoped approver looking at somebody else's brand is told to go and ask for
     a menu tick that would not have helped them. */
  for (const r of [...Object.keys(SINGLE_KEY), ...BRANCHING]) {
    const s = src(r);
    const menu = s.indexOf("await requireBookingMenu(");
    const area = s.indexOf("canAccessBookingArea(");
    const brand = s.indexOf("await requireBookingBrandScope(");
    assert.ok(menu > 0, `${r} never calls requireBookingMenu`);
    assert.ok(area > 0 && area < menu, `${r} checks the booking area after the menu, or not at all`);
    assert.ok(brand > 0 && brand < menu, `${r} checks the brand scope after the menu, or not at all`);
  }
});

test("reject and return map the STAGE to the matching desk, never crossed", () => {
  /* These two are reachable at the manager step as well, where neither desk is
     involved and no menu is required — which is why the key is `null` there and
     the call sits behind an `if`. The cross is the failure to catch: sending
     `atAccountStage` to `bookingQueue` gates the HR desk on the Admin tick. */
  for (const r of BRANCHING) {
    const s = src(r);
    const m = /const\s+menuKey\s*=([\s\S]*?);\n/.exec(s);
    assert.ok(m, `${r}: no menuKey assignment found — has the branch been rewritten?`);
    const expr = m![1];

    const acct = expr.indexOf("atAccountStage");
    const admin = expr.indexOf("atAdminStage");
    const acctKey = expr.indexOf('"accountApproval"');
    const adminKey = expr.indexOf('"bookingQueue"');
    assert.ok(acct >= 0 && admin >= 0, `${r}: menuKey must branch on BOTH stages: ${expr}`);
    assert.ok(acctKey >= 0 && adminKey >= 0, `${r}: menuKey must name both keys: ${expr}`);

    /* Each stage test is immediately followed by its own key, and by the other
       stage's test only after that. */
    assert.ok(
      acct < acctKey && acctKey < admin && admin < adminKey,
      `${r}: the stages and the keys are crossed or reordered: ${expr}`,
    );
    assert.ok(
      /null/.test(expr),
      `${r}: the manager stage must resolve to null — it is not either desk's work, and ` +
        "requiring a tick there would stop a manager rejecting their own queue",
    );
  }
});

test("no booking-area act route checks the brand and then skips the menu", () => {
  /* The pairing is what keeps the lists above from going stale: brand scope and
     menu answer different questions about the same act, so a route that asks
     one and not the other is a route somebody half-gated. An eighth file fails
     here without anybody remembering to extend a constant. */
  const offenders: string[] = [];
  for (const file of routeFiles(API)) {
    const name = rel(file);
    if (READ_ONLY_SCOPE.indexOf(name) >= 0) continue;
    const s = code(file);
    if (!/requireBookingBrandScope\s*\(/.test(s)) continue;
    if (!/requireBookingMenu\s*\(/.test(s)) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    "these action routes check the request's brand but not the actor's menu grant: " +
      offenders.join(", "),
  );
});

test("admins pass the gate, because they hold every menu by construction", () => {
  /* `canAccessBookingArea` keeps its admin arm, `requireBookingBrandScope`
     grants admins `allAccess`, and the settings grid prints "เห็นทุกเมนูอยู่แล้ว
     (Super Admin)" where their tick boxes would be. An admin therefore has no
     row for this read to find, and dropping the arm locks the people who
     administer AP-17 out of it — silently, since the roster would still list
     them. A source pin because the module reaches a pool. */
  const s = code(path.resolve(process.cwd(), "src/lib/acc/travel-booking/require-booking-menu.ts"));
  assert.match(
    s,
    /if\s*\(isAdminRole\([^)]*\)\)\s*return null;/,
    "requireBookingMenu no longer lets an admin through before reading any row",
  );
  assert.ok(
    s.indexOf("isAdminRole(") < s.indexOf("resolveBookingTabsByEmail("),
    "the admin arm must come BEFORE the roster read, or an admin who is not on " +
      "AccBookingApprover is refused by the empty list",
  );
});

test("the card lists the same people the gate admits", () => {
  /* The rule that made this necessary: the card answers "who may act on this
     step", and while sight and authority disagreed there was no honest list to
     draw. `step-approvers-load.ts` must therefore read the SAME tick table this
     gate reads, and give each AP-17 step its own key — listing one roster for
     both steps is what it did until 2026-09-24. */
  const s = code(path.resolve(process.cwd(), "src/lib/acc/step-approvers-load.ts"));
  assert.match(s, /AccBookingApproverTab/, "the AP-17 card no longer reads the menu ticks at all");
  const admin = /put\("AP-17",\s*"ADMIN",\s*([^)]*)\)/.exec(s);
  const account = /put\("AP-17",\s*"ACCOUNT",\s*([^)]*)\)/.exec(s);
  assert.ok(admin && account, "AP-17's two steps are no longer both populated");
  assert.match(admin![1], /bookingQueue/, "AP-17's ADMIN step is not filtered to the คิวจอง tick");
  assert.match(
    account![1],
    /accountApproval/,
    "AP-17's ACCOUNT step is not filtered to the อนุมัติ (HR) tick",
  );
  assert.notEqual(
    admin![1].trim(),
    account![1].trim(),
    "both AP-17 steps are listing the same people again",
  );
});
