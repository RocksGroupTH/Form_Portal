import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The five gates behind the five `messages` routes reach a pool
 * (`resolve*CanMessageByEmail`, one per form) through
 * `@/lib/acc/pool` / `@/lib/adv/pool`, so `@/env` validates the whole
 * environment at import and none of them can be called from a test at all.
 * This reads their sources instead.
 *
 * What has to hold, and would not be caught by any behavioural test:
 *
 * - **the admin arm comes FIRST**, before any roster read — an admin who
 *   holds no `AccApprover` / `AccBookingApprover` / `AccReimburseAccess` /
 *   `AccAdvClrAccess` row must not be refused;
 * - **the resolver it calls reads the right column on the right table** — a
 *   copy-paste of AP-1's file into AP-17's, with only the import path fixed,
 *   would still typecheck and still export the right function name;
 * - **it reads a COLUMN, never a `TabKey` row** — the whole reason this grant
 *   exists as a column (see `@/lib/acc/message-grant`) is that
 *   `AccApproverSettingsTab` / `AccBookingApproverTab` /
 *   `AccReimburseAccessTab` / `AccAdvClrAccessTab` are shared with ACC Portal
 *   and get rewritten wholesale by saves that know nothing of this key; a
 *   guard that quietly grew a fallback onto one of those tables would
 *   reopen exactly that hole;
 * - **`decideMessageTabAccess` makes the decision**, not a hand-rolled
 *   `isAdmin || canMessage` inline — one rule, shared by all five, so a
 *   mistake in it is fixed once.
 */

const GUARDS: {
  code: string;
  path: string;
  fn: string;
  resolveImport: string;
  resolveCall: string;
}[] = [
  {
    code: "AP-1",
    path: "src/lib/acc/require-message-access.ts",
    fn: "requireAccMessageAccess",
    resolveImport: "@/lib/acc/approver-message-access",
    resolveCall: "resolveApproverCanMessageByEmail",
  },
  {
    code: "AP-17",
    path: "src/lib/acc/travel-booking/require-booking-message-access.ts",
    fn: "requireBookingMessageAccess",
    resolveImport: "@/lib/acc/travel-booking/booking-approver-message-access",
    resolveCall: "resolveBookingApproverCanMessageByEmail",
  },
  {
    code: "AP-4",
    path: "src/lib/acc/reimburse/require-reimburse-message-access.ts",
    fn: "requireReimburseMessageAccess",
    resolveImport: "@/lib/acc/reimburse/access-message-access",
    resolveCall: "resolveReimburseAccessCanMessageByEmail",
  },
];

for (const g of GUARDS) {
  const src = readFileSync(g.path, "utf8");

  test(`${g.code}: ${g.fn} imports the shared decision`, () => {
    assert.ok(
      src.includes('from "@/lib/acc/message-grant"') && src.includes("decideMessageTabAccess"),
      `${g.path} does not import and use decideMessageTabAccess`,
    );
  });

  test(`${g.code}: ${g.fn} admits an admin BEFORE reading any roster row`, () => {
    const isAdminAt = src.indexOf("isAdminRole(");
    const resolveAt = src.indexOf(g.resolveCall + "(");
    assert.ok(isAdminAt >= 0, `${g.path} never checks isAdminRole`);
    assert.ok(resolveAt >= 0, `${g.path} never calls ${g.resolveCall}`);
    assert.ok(
      isAdminAt < resolveAt,
      `${g.path} reads the roster before checking isAdminRole — an admin with no row would be refused`,
    );
    // And the admin arm must actually return early, not merely be computed.
    assert.match(
      src,
      /if\s*\(isAdmin\)\s*return session;/,
      `${g.path} computes isAdmin but never returns early on it`,
    );
  });

  test(`${g.code}: ${g.fn} resolves from its OWN module, not another form's`, () => {
    assert.ok(
      src.includes(`from "${g.resolveImport}"`),
      `${g.path} does not import from ${g.resolveImport}`,
    );
    for (const other of GUARDS) {
      if (other.code === g.code) continue;
      assert.ok(
        !src.includes(other.resolveCall),
        `${g.path} references ${other.resolveCall}, which belongs to ${other.code}`,
      );
    }
  });

  test(`${g.code}: ${g.fn} never falls back to a TabKey resolver`, () => {
    // The failure this guards against: a later hand adding
    // `resolveApproverSettingsTabsByEmail` (or one of its three siblings) as a
    // fallback, which would read a row ACC Portal's own saver deletes.
    assert.ok(
      !/resolve(Approver|Booking|Reimburse|AdvClr)[A-Za-z]*Tabs?ByEmail/.test(src),
      `${g.path} references a TabKey resolver — the grant would be silently deleted by ACC Portal`,
    );
  });

  test(`${g.code}: ${g.fn} returns the refusal, never computes and drops it`, () => {
    assert.match(
      src,
      /if\s*\(session instanceof Response\)\s*return session;/,
      `${g.path} never returns requireAuth's own refusal`,
    );
    assert.match(
      src,
      /return NextResponse\.json\(\s*\{\s*ok:\s*false,\s*error:\s*"ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้"/,
      `${g.path} never returns a 403 for a non-admin, non-holder`,
    );
  });
}

/**
 * AP-2 and AP-3's guards live in one file, sharing one `gate` helper — so the
 * checks above are re-run against that one file with both resolver names.
 */
test("AP-2 / AP-3: both message gates resolve their own column and nothing else", () => {
  const path = "src/lib/adv/require-adv-clr-message-access.ts";
  const src = readFileSync(path, "utf8");

  assert.ok(
    src.includes('from "@/lib/acc/message-grant"') && src.includes("decideMessageTabAccess"),
    `${path} does not import and use decideMessageTabAccess`,
  );
  assert.ok(
    src.includes('from "@/lib/adv/access-message-access"'),
    `${path} does not import from @/lib/adv/access-message-access`,
  );
  assert.ok(
    src.includes("resolveAdvanceCanMessageByEmail") && src.includes("resolveClearCanMessageByEmail"),
    `${path} does not reference both AP-2 and AP-3's resolvers`,
  );
  assert.ok(
    !/resolve(Approver|Booking|Reimburse|AdvClr)[A-Za-z]*Tabs?ByEmail/.test(src),
    `${path} references a TabKey resolver — the grant would be silently deleted by ACC Portal`,
  );
  assert.match(
    src,
    /if\s*\(isAdmin\)\s*return session;/,
    `${path} computes isAdmin but never returns early on it`,
  );
  const isAdminAt = src.indexOf("isAdminRole(");
  const resolveAt = src.indexOf("await resolve(");
  assert.ok(isAdminAt >= 0 && resolveAt >= 0, `${path} is missing the admin check or the resolve call`);
  assert.ok(
    isAdminAt < resolveAt,
    `${path} reads the roster before checking isAdminRole — an admin with no row would be refused`,
  );
  assert.match(
    src,
    /export async function requireAdvanceMessageAccess\(\): Promise<Session \| Response> \{\s*return gate\(resolveAdvanceCanMessageByEmail/,
    `${path} does not wire requireAdvanceMessageAccess to resolveAdvanceCanMessageByEmail`,
  );
  assert.match(
    src,
    /export async function requireClearMessageAccess\(\): Promise<Session \| Response> \{\s*return gate\(resolveClearCanMessageByEmail/,
    `${path} does not wire requireClearMessageAccess to resolveClearCanMessageByEmail`,
  );
});
