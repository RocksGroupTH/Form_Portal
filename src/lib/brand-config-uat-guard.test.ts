import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Both halves of Config BC are saved, whichever one the toggle is showing.**
 *
 * The Brand Configuration dialog gained a PRO/UAT switch on 2026-09-23 (the
 * user: *"ภายใต้ Config BC ให้มี button ให้เลือก ระหว่าง PRO & UAT"*). The two
 * halves live in different tables — Production in `Fast_Core.BrandConfig`,
 * Sandbox in `AccBrandErpTargetSetting` — and one form holds both.
 *
 * ## The failure, which nothing else would catch
 *
 * `updateBrandConfig` treats an explicit `null` as "clear this" and an absent
 * field as "leave it alone" — the three-valued rule the API-key PATCH already
 * uses. The dialog always sends both halves, so an admin who fills in UAT,
 * switches back to PRO and saves keeps their UAT company.
 *
 * Send only the visible half, and saving from the PRO tab **clears the brand's
 * Sandbox company** — and with it that brand's ability to sync or post in UAT
 * at all, since `brand-bc-profile.ts` refuses rather than falling back. The
 * admin did not touch the UAT tab; they would have no reason to connect the
 * loss to this save.
 *
 * **TypeScript cannot catch it**: all three fields are optional on
 * `BrandConfigInput`, so omitting them compiles. Neither can a render test —
 * the dialog looks identical. The payload is the only place it is visible, so
 * that is what this reads.
 *
 * Mutation-tested 2026-09-23: removing the three lines from the payload leaves
 * `npm run typecheck` and the whole suite green without this file.
 */

const PAGE = path.resolve(
  process.cwd(),
  "src/app/(dashboard)/settings/brand-config/page.tsx",
);

const src = fs.readFileSync(PAGE, "utf8");

test("the save payload carries both halves of Config BC", () => {
  for (const field of ["bcUatId", "bcUatName", "bcUatConnectionId"]) {
    assert.ok(
      src.indexOf(`${field}: form.${field}`) !== -1,
      `the Brand Configuration save no longer sends ${field} from the form. Absent, ` +
        "`updateBrandConfig` leaves the stored value alone — which sounds safe and is not the " +
        "shape here: the dialog is the only editor that holds both halves, so a payload that " +
        "drops one means the PRO tab and the UAT tab overwrite each other's work depending on " +
        "which was open at Save",
    );
  }
});

test("the payload is not gated on which tab is open", () => {
  /* The arm above passes if the field is sent CONDITIONALLY — `bcEnv === "UAT"
     ? … : null` would satisfy a substring check and is exactly the regression:
     it sends an explicit null for the half not on screen, which is the value
     that CLEARS it. So the toggle's own state must not appear in the payload
     at all. */
  const at = src.indexOf("bcUatId: form.bcUatId");
  assert.notEqual(at, -1, "the UAT half has gone from the payload entirely");
  const start = src.lastIndexOf("bcId: form.bcId", at);
  assert.notEqual(start, -1, "the PRO half has gone from the payload");
  const payload = src.slice(start, at + 400);
  assert.ok(
    payload.indexOf("bcEnv") === -1,
    "the save payload reads `bcEnv`, the PRO/UAT toggle. That toggle switches a VIEW — it must " +
      "not decide what is written, or the half that is not on screen is sent as null and cleared",
  );
});

test("the toggle does not live below the form that holds both halves", () => {
  /* `bcEnv` is the dialog's own state and the form is the caller's. If a later
     change moves the halves into two separate forms keyed on the toggle, the
     arms above still pass while the losing half is simply never collected.
     One `FormState` carrying both fields is what makes them impossible to
     separate; this pins that. */
  for (const field of ["bcUatId", "bcUatName", "bcUatConnectionId"]) {
    assert.ok(
      src.indexOf(field + ": string;") !== -1,
      `${field} is no longer a field of the dialog's FormState. Both halves must live in ONE ` +
        "form object, or switching tabs before Save loses whichever was typed first",
    );
  }
});
