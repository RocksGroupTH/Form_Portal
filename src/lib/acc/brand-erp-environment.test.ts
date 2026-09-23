import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_ERP_ENVIRONMENT_COLUMN,
  brandErpEnvPredicate,
  parseErpBcEnvironment,
  rowsForEnvironment,
} from "@/lib/acc/brand-erp-environment";

/**
 * The rule that says which Business Central environment a per-brand Interface
 * ERP setting was chosen for. Unit-testable because the module imports nothing
 * but a type — the services that consume it all reach `@/env` through a pool.
 */

test("the predicate names the column, with and without an alias", () => {
  assert.equal(brandErpEnvPredicate(), "Environment = @environment");
  assert.equal(brandErpEnvPredicate("b"), "b.Environment = @environment");
  // The constant is what the guard and every query agree on; if it moves, the
  // predicate must move with it rather than carrying a second spelling.
  assert.ok(brandErpEnvPredicate().startsWith(BRAND_ERP_ENVIRONMENT_COLUMN));
});

test("the predicate has no IS NULL arm", () => {
  /* Unlike `perFormPredicate`, whose NULL means "the default, every form". The
     column is NOT NULL and a row belongs to exactly one environment, so an arm
     admitting NULL would read as though absence meant "answers both" — which is
     the state migration 161 was written to end. */
  assert.equal(brandErpEnvPredicate().indexOf("IS NULL"), -1);
});

test("an absent environment is undefined, not a default", () => {
  /* The three shades matter: undefined means the service resolves the
     request's own environment, which is what every money path relies on. */
  assert.equal(parseErpBcEnvironment(undefined), undefined);
  assert.equal(parseErpBcEnvironment(null), undefined);
  assert.equal(parseErpBcEnvironment(""), undefined);
});

test("both environments parse, trimmed and case-insensitively", () => {
  assert.equal(parseErpBcEnvironment("Production"), "Production");
  assert.equal(parseErpBcEnvironment("production"), "Production");
  assert.equal(parseErpBcEnvironment("  SANDBOX  "), "Sandbox");
  assert.equal(parseErpBcEnvironment("Sandbox"), "Sandbox");
});

test("anything else is null — refused, never defaulted to Production", () => {
  /* This is the whole reason the function has three answers rather than two.
     Defaulting an unrecognised value to Production would write one
     environment's bank account over the other's — a real row, no error — which
     is the silent wrong-environment write the column exists to end. */
  for (const bad of ["UAT", "PRO", "prod", 1, true, {}, []]) {
    assert.equal(parseErpBcEnvironment(bad), null, `${JSON.stringify(bad)} should be refused`);
  }
  // "UAT" is the trap: it is what the NAVBAR calls this half, and it is not
  // what the column holds. `resolveSettingsErpEnvironment()` is what translates
  // between the two, and it is the only thing that should.
  assert.equal(parseErpBcEnvironment("UAT"), null);
  // Whitespace is trimmed rather than refused, so this one is NOT in the list
  // above — a stray space is a typing accident, not a different environment.
  assert.equal(parseErpBcEnvironment("Sandbox "), "Sandbox");
});

test("rows narrow to one environment, tolerating how a row was written", () => {
  const rows = [
    { id: 1, environment: "Production" },
    { id: 2, environment: "Sandbox" },
    { id: 3, environment: " production " },
    { id: 4, environment: "SANDBOX" },
  ];
  assert.deepEqual(
    rowsForEnvironment(rows, "Production").map((r) => r.id),
    [1, 3],
  );
  assert.deepEqual(
    rowsForEnvironment(rows, "Sandbox").map((r) => r.id),
    [2, 4],
  );
});

test("a row with no environment belongs to NEITHER, which is the safe direction", () => {
  /* The column is NOT NULL DEFAULT 'Production' and every mapper here reads it
     back with `?? "Production"`, so this case only arises for a row shape that
     did not SELECT it — the hazard `PERDIEM_ROW_COLUMNS` documents one level
     down, where dropping a column from a query silently changes a derived
     answer rather than failing.

     Falling back to Production here was considered and rejected. It would hand
     Production's accounts and batches to a Sandbox screen the moment somebody
     dropped the column from a SELECT — silently, with a 200 and real rows,
     which is the exact failure migration 161 exists to end. Matching nothing
     instead shows an empty list on both halves and makes the send refuse: the
     configuration looks missing, which is loud, and no journal is built from
     the other company's chart. */
  const rows = [{ id: 1 }, { id: 2, environment: null }, { id: 3, environment: "Sandbox" }];
  assert.deepEqual(rowsForEnvironment(rows, "Production"), []);
  assert.deepEqual(
    rowsForEnvironment(rows, "Sandbox").map((r) => r.id),
    [3],
  );
});
