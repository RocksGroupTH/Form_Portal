import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Two lists have to name the same four companies, and nothing makes them.
 *
 * `GL_RULE_COMPANIES` (`clear-advance-admin-service.ts`) is what a new G/L
 * category is fanned out to; `ERP_INTERFACE_BRANDS` (`@/lib/acc/erp-interface-brands`)
 * is what the settings screen offers to pick between. A company in the picker
 * but not in the fan-out gets **no rule row** for any category created
 * elsewhere — its screen shows every line as "ยังไม่ได้ตั้งค่า" and every AP-3
 * clearing under it can charge nothing. A company in the fan-out but not the
 * picker accumulates rows nobody can see or edit.
 *
 * They are not one constant on purpose: `ERP_INTERFACE_BRANDS` is derived from
 * `BRANDS`, which exists for the browser's brand picker, and the service has no
 * business importing it. This is the cheaper of the two ways to keep them
 * honest.
 *
 * Source-reading, like the other guards here: the service reaches `@/env`
 * through `getAccPool` and throws at import, so the constant cannot be read
 * from a test at all.
 */

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

function listFromSource(src: string, decl: RegExp): string[] {
  const m = src.match(decl);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([A-Z0-9_]+)"/g)).map((x) => x[1]);
}

test("the fan-out list and the picker name the same companies", () => {
  const service = read("src/lib/clr/clear-advance-admin-service.ts");
  const fanOut = listFromSource(
    service,
    /GL_RULE_COMPANIES: readonly string\[\] = \[([^\]]*)\]/,
  );
  assert.ok(fanOut.length > 0, "GL_RULE_COMPANIES is gone or no longer a literal array");

  // `ERP_INTERFACE_BRANDS` is `BRANDS.filter(b => b.enabled)`, so the picker's
  // real content is the enabled entries of `src/lib/brand.ts`.
  const brands = read("src/lib/brand.ts");
  const enabled = Array.from(
    brands.matchAll(/id:\s*"([A-Z0-9_]+)"[^}]*enabled:\s*true/g),
  ).map((m) => m[1]);
  assert.ok(enabled.length > 0, "src/lib/brand.ts no longer lists enabled brands the same way");

  assert.deepEqual(
    fanOut.slice().sort(),
    enabled.slice().sort(),
    "GL_RULE_COMPANIES and the enabled BRANDS have drifted — a company in one and not the other " +
      "either sees every category as unconfigured or collects rows nobody can edit",
  );
});

test("the migration backfills exactly those companies", () => {
  // 151's CROSS JOIN names them literally; a company added to the code without
  // being added there starts with no rules for the 43 existing categories.
  const sql = read("migrations/151_clr_gl_company.sql");
  const inBackfill = Array.from(
    sql.matchAll(/\('([A-Z0-9_]+)'\)/g),
  ).map((m) => m[1]);
  const service = read("src/lib/clr/clear-advance-admin-service.ts");
  const fanOut = listFromSource(
    service,
    /GL_RULE_COMPANIES: readonly string\[\] = \[([^\]]*)\]/,
  );
  assert.deepEqual(inBackfill.slice().sort(), fanOut.slice().sort());
});
