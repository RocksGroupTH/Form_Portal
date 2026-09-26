import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isGrantableAdvClrTabKey } from "./settings-tabs";

/**
 * Which gate each AP-2 / AP-3 settings route carries, read out of its source.
 *
 * Source-reading because the thing that must hold is a **missing call**, and no
 * behavioural test notices one: deleting a gate leaves every other test green,
 * which this repository has measured on AP-4's own queue route.
 *
 * Two properties, and the second is the one a reasonable edit breaks:
 *
 * 1. **Two KINDS of route stay `requireRole`, for two different reasons.**
 *    `settings/access` on either form writes the grant table itself — whoever
 *    could POST there could grant themselves the rest, and here it also edits
 *    both approver pools. And every route that **writes `Rocks_ERP_Data`** —
 *    `advance/settings/vendors/sync`, `advance/settings/erp-batches`,
 *    `clear-advance/settings/erp-sync`, `clear-advance/settings/locations/sync`
 *    — because those rows are not this app's private ones: Rocks Fast writes
 *    the neighbouring tables and ACC Portal reads them through `Fast_Data`'s
 *    synonyms. CLAUDE.md's standing rule is that a tab grant must never become
 *    write access to them, and this change did not cross it.
 *    `settings/erp-interface` was on that list until 2026-09-22 and is NOT any
 *    more — the user opened it deliberately, having been told it is gated but
 *    not brand-scoped. See `./settings-tabs`.
 * 2. **The gate is the handler's FIRST await, and its refusal is returned.**
 *    A gate that runs after the read has already happened is not a gate; one
 *    whose `Response` is computed and dropped is not either.
 *
 * **Every settings route on disk needs an entry (2026-09-22).** The table used
 * to name eight of twenty-two, so a new ungated route — or an existing one
 * quietly moved — was invisible to it. AP-4's own copy of this file has had
 * that assertion from the start; this one now does too, and it is what pins
 * the `requireRole` decisions above as decisions rather than omissions.
 *
 * A third property joined them on 2026-09-22, when สิทธิ์เข้าถึง split per
 * form: **each hub asks its own form's question.** It is not a gate — showing a
 * card grants nothing and every destination re-decides server-side — but it is
 * read out of source for the same reason the gates are, and it belongs beside
 * them because it is the other half of "what may this viewer reach on AP-2 or
 * AP-3". See the block at the foot of this file.
 */

const ADV_ROOT = "src/app/api/request/advance/settings";
const CLR_ROOT = "src/app/api/request/clear-advance/settings";

const ROUTES = [
  // [file, expected gate, expected argument or null]

  /* ── tab-gated: a grant holder, or an admin ── */
  [`${ADV_ROOT}/tiers/route.ts`, "requireAdvClrSettingsTab", "matrix"],
  [`${ADV_ROOT}/banks/route.ts`, "requireAdvClrSettingsTab", "banks"],
  [`${ADV_ROOT}/brand-active/route.ts`, "requireAdvClrSettingsTab", "brands"],
  [`${CLR_ROOT}/locations/route.ts`, "requireAdvClrSettingsTab", "locations"],
  // Opened 2026-09-22, on the user's instruction and with the reach stated to
  // them: these four are gated but NOT brand-scoped, so a holder sets any
  // brand's posting configuration.
  [`${ADV_ROOT}/erp-interface/route.ts`, "requireAdvClrSettingsTab", "advanceErpInterface"],
  // `erp-master` is the option list AP-2's Interface ERP tab picks from — it
  // READS Rocks_ERP_Data and writes nothing, which is what separates it from
  // the sync routes below.
  [`${ADV_ROOT}/erp-master/route.ts`, "requireAdvClrSettingsTab", "advanceErpInterface"],
  [`${CLR_ROOT}/erp-interface/route.ts`, "requireAdvClrSettingsTab", "clearErpInterface"],
  [`${CLR_ROOT}/erp-gl-accounts/route.ts`, "requireAdvClrSettingsTab", "clearErpInterface"],
  [`${CLR_ROOT}/erp-journal-batches/route.ts`, "requireAdvClrSettingsTab", "clearErpInterface"],
  // `erp-bank-accounts` is AP-3’s twin of `erp-master` above: the option list
  // its Interface ERP tab picks a bank from. It READS Rocks_ERP_Data and writes
  // nothing — the choice is saved by `erp-interface` beside it, which carries
  // the same key. (user, 2026-09-23)
  [`${CLR_ROOT}/erp-bank-accounts/route.ts`, "requireAdvClrSettingsTab", "clearErpInterface"],
  // Opened the same day, over rows that carry no FormCode and therefore serve
  // AP-4 as well — the grid says so in Thai beside each tick.
  [`${CLR_ROOT}/gl-accounts/route.ts`, "requireAdvClrSettingsTab", "glAccounts"],
  [`${CLR_ROOT}/bu-gl-map/route.ts`, "requireAdvClrSettingsTab", "buGlMap"],

  /* ── admin-only: hands out power ── */
  [`${ADV_ROOT}/access/route.ts`, "requireRole", null],
  // The two approver pools. Being on one means approving real money, and both
  // editors render on the สิทธิ์เข้าถึง tab, which is itself ungrantable.
  [`${ADV_ROOT}/approvers/route.ts`, "requireRole", null],
  [`${ADV_ROOT}/approvers/[id]/route.ts`, "requireRole", null],
  [`${ADV_ROOT}/approvers/candidates/route.ts`, "requireRole", null],
  [`${CLR_ROOT}/approvers/route.ts`, "requireRole", null],

  /* ── admin-only: writes Rocks_ERP_Data, which two sibling apps also read ── */
  [`${ADV_ROOT}/vendors/sync/route.ts`, "requireRole", null],
  [`${ADV_ROOT}/erp-batches/route.ts`, "requireRole", null],
  [`${CLR_ROOT}/erp-sync/route.ts`, "requireRole", null],
  [`${CLR_ROOT}/locations/sync/route.ts`, "requireRole", null],

  /* ── admin-only: the grant cannot be stored ──
   *
   * A message grants nothing, but `AccAdvClrAccessTab` is shared with ACC
   * Portal, whose own writer deletes an approver's whole tab set and
   * re-inserts only the keys ITS list knows (spec §8). A `messages` grant made
   * here would vanish on that app's next save with no error either side — the
   * exact defect the 2026-09-24 work fixed for AP-17's menu ticks. AP-2 and
   * AP-3 each get their own route rather than sharing one, for the same reason
   * they have two Interface ERP keys rather than one.
   */
  [`${ADV_ROOT}/messages/route.ts`, "requireRole", null],
  [`${CLR_ROOT}/messages/route.ts`, "requireRole", null],

  /* ── admin-only, and NOT by design: the two `[id]` DELETEs ──
   *
   * `banks` and `tiers` are grantable and their collection routes are
   * tab-gated, but deleting one of their rows is still `requireRole`. So a
   * `banks` holder adds and edits a bank and cannot remove one. That predates
   * this change and nobody has ruled on it; it is pinned here so the
   * inconsistency is recorded rather than rediscovered, and so that closing it
   * is a deliberate edit to this table rather than a silent drift.
   */
  [`${ADV_ROOT}/banks/[id]/route.ts`, "requireRole", null],
  [`${ADV_ROOT}/tiers/[id]/route.ts`, "requireRole", null],
] as const;

const read = (rel: string) =>
  fs
    .readFileSync(path.resolve(process.cwd(), rel), "utf8")
    // Comments stripped: these files NAME the gate they used to carry and the
    // ones they deliberately do not, so a search over raw text would pass on
    // prose alone.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

for (const [file, gate, arg] of ROUTES) {
  test(`${file} is gated by ${gate}${arg ? `("${arg}")` : ""}`, () => {
    const src = read(file);
    const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g) ?? [];
    assert.ok(handlers.length > 0, "no route handlers found — has the file moved?");

    // `await <gate>(` rather than a bare mention: a comment naming the old gate
    // must not satisfy this, and neither must an import left behind.
    const calls = src.match(new RegExp(`await ${gate}\\(`, "g")) ?? [];
    assert.equal(
      calls.length,
      handlers.length,
      `${handlers.length} handler(s) but ${calls.length} call(s) to ${gate}`,
    );

    if (arg) {
      assert.ok(
        new RegExp(`await ${gate}\\("${arg}"\\)`).test(src),
        `${gate} is not called with "${arg}" — the wrong tab key gates this route`,
      );
      assert.ok(
        !/requireRole/.test(src),
        "requireRole is still referenced — two gates on one route drift apart",
      );
    }

    // Every handler must return the refusal rather than compute and drop it.
    const refusals = src.match(/if \(session instanceof Response\) return session;/g) ?? [];
    assert.equal(
      refusals.length,
      handlers.length,
      `${handlers.length} handler(s) but ${refusals.length} refusal return(s)`,
    );
  });
}

/* ── each hub asks about its OWN form (2026-09-22) ────────────────────────
 *
 * `/api/request/advance/access` used to answer one union `canSettings` and both
 * hubs drew their ตั้งค่า card on it, so a grant of AP-2's `banks` put the card
 * on AP-3's hub — where that page has no tab the viewer may open and answers
 * ไม่มีสิทธิ์เข้าถึง. Splitting สิทธิ์เข้าถึง per form made that worse rather
 * than causing it: `brands` had been on both strips, so a `brands` holder
 * genuinely had a tab on both pages until it moved to AP-2 alone.
 *
 * Source-read because the failure is a hub reading the WRONG field, which type
 * checking cannot see — both are booleans on the same payload, and a hub that
 * reads a field the route stopped sending gets `undefined`, which `!!` turns
 * into a silently missing card for admins too.
 */
const HUBS = [
  ["src/app/(dashboard)/request/advance/admin/page.tsx", "canAdvanceSettings", "canClearSettings"],
  ["src/app/(dashboard)/request/clear-advance/admin/page.tsx", "canClearSettings", "canAdvanceSettings"],
] as const;

for (const [file, mine, theirs] of HUBS) {
  test(`${file} draws its settings card on ${mine}`, () => {
    const src = read(file);
    assert.ok(src.includes(mine), `${file} does not read ${mine}`);
    assert.ok(
      !src.includes(theirs),
      `${file} reads ${theirs} — that is the other form's answer`,
    );
    // The union field is gone from the payload, so a hub still naming it would
    // read `undefined` and hide the card from everybody, admins included.
    assert.ok(
      !/\bcanSettings\b\s*:\s*!!\s*d\?\.canSettings\b/.test(src),
      `${file} still reads the union canSettings the route no longer sends`,
    );
  });
}

test("the access route answers a settings flag per form and no union", () => {
  const src = read("src/app/api/request/advance/access/route.ts");
  for (const key of ["canAdvanceSettings", "canClearSettings"]) {
    assert.ok(src.includes(key + ":"), `the route no longer answers ${key}`);
  }
  assert.ok(
    !/\bcanSettings\s*:/.test(src),
    "the union canSettings is back — both hubs would share one answer again",
  );
  // Derived from each form's own strip, so a tab moving between the two pages
  // moves this with it rather than needing to be remembered here.
  assert.ok(
    src.includes("advClrTabsForForm("),
    "the per-form flag is not derived from the forms' tab strips",
  );
});

test("every AP-2 / AP-3 settings route on disk has an entry", () => {
  // The assertion that makes the table a guarantee rather than a sample. It
  // was missing until 2026-09-22, when the table named 8 of 22 — so a new
  // route could ship with no gate at all and nothing here would notice.
  // Separators are normalised because `path.join` answers `\` on Windows and
  // the table is written with `/`.
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(full));
      else if (e.name === "route.ts") out.push(full);
    }
    return out;
  };
  const root = process.cwd();
  const onDisk = walk(path.resolve(root, ADV_ROOT))
    .concat(walk(path.resolve(root, CLR_ROOT)))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .sort();
  const mapped = ROUTES.map(([file]) => file).slice().sort();
  assert.deepEqual(
    onDisk,
    mapped,
    "an AP-2 / AP-3 settings route is not in ROUTES — add it with the gate it should carry",
  );
});

test("every tab-gated route names a key an admin can actually tick", () => {
  // A route gated on a key that is not grantable can never open for a
  // non-admin, whatever an admin ticks — it would be `requireRole` wearing a
  // longer name. This is the assertion that fails if a key is dropped from
  // `GRANTABLE_ADV_CLR_TABS` while its route keeps pointing at it.
  for (const [file, gate, arg] of ROUTES) {
    if (gate !== "requireAdvClrSettingsTab") continue;
    assert.ok(arg, `${file} is tab-gated with no key`);
    assert.equal(
      isGrantableAdvClrTabKey(arg as string),
      true,
      `${file} is gated on "${arg}", which no admin can tick`,
    );
  }
});

test("the gate is the first await in every handler it guards", () => {
  for (const [file, gate] of ROUTES) {
    const src = read(file);
    // Split on the handler openings and check each body's first `await`.
    const parts = src.split(/export async function (?:GET|POST|PATCH|PUT|DELETE)\b/).slice(1);
    for (const body of parts) {
      const firstAwait = body.indexOf("await ");
      assert.ok(firstAwait !== -1, `${file}: a handler with no await at all`);
      assert.ok(
        body.slice(firstAwait).startsWith(`await ${gate}(`),
        `${file}: a handler does something before its ${gate} call`,
      );
    }
  }
});
