import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildBcODataEntityUrl, buildBcApiV2CompanyEntityUrl } from "@/lib/bc/bc-url";

/**
 * **A BC URL builder is always told which environment it is building for.**
 *
 * Both builders take `environment` with a **default of `"Production"`**, and
 * append it to the base URL unless the base already ends in it. The UAT
 * connection's base URL ends in `/Sandbox` — so a call that omits the argument
 * builds
 *
 *     .../{tenant}/Sandbox/Production/ODataV4/Company('…')/GeneralJournalBatches
 *
 * two environment segments, which Business Central answers **400
 * RequestDataInvalid**. That is the failure the user hit on 2026-09-23, on the
 * first UAT sync after the routes started resolving UAT at all.
 *
 * ## Why the default is the trap rather than the convenience
 *
 * It was written when there was one environment, and it is still right for
 * every Production caller — which is why nothing failed for as long as
 * Production was the only answer. An omitted argument is not a type error, not
 * a lint warning, and produces a URL that *looks* plausible; the only thing
 * that reports it is BC, at run time, per brand.
 *
 * The behavioural arms below pin the builders' own contract, and the source arm
 * pins that the sync modules actually pass it. Both are needed: the contract
 * could hold while a caller omits the argument, which is exactly what happened.
 */

const SRC = path.resolve(process.cwd(), "src");
const PROD_BASE = "https://api.businesscentral.dynamics.com/v2.0/tenant/Production";
const SANDBOX_BASE = "https://api.businesscentral.dynamics.com/v2.0/tenant/Sandbox";

test("a Sandbox base URL is not given a second environment segment", () => {
  const odata = buildBcODataEntityUrl(SANDBOX_BASE, "ROCKS PC", "GeneralJournalBatches", "Sandbox");
  assert.equal(
    odata.indexOf("/Sandbox/Production/"),
    -1,
    `built ${odata} — two environment segments is what BC answers 400 RequestDataInvalid to`,
  );
  assert.ok(odata.startsWith(SANDBOX_BASE + "/ODataV4/"), `unexpected shape: ${odata}`);

  const v2 = buildBcApiV2CompanyEntityUrl(SANDBOX_BASE, "some-guid", "accounts", "Sandbox");
  assert.equal(v2.indexOf("/Sandbox/Production/"), -1, `built ${v2}`);
});

test("omitting the environment against a Sandbox base is what broke", () => {
  /* Pinned as the CURRENT behaviour rather than as something desirable: the
     default is correct for Production callers and this documents precisely
     what it costs a Sandbox one, so the next person to read the default knows
     why every call site passes the argument. */
  const wrong = buildBcODataEntityUrl(SANDBOX_BASE, "ROCKS PC", "GeneralJournalBatches");
  assert.ok(
    wrong.indexOf("/Sandbox/Production/") !== -1,
    "the builder no longer doubles the segment when the environment is omitted — if that was " +
      "fixed inside the builder, say so here and the source arm below can be relaxed",
  );
});

test("a Production base URL is unchanged by passing the environment", () => {
  const withArg = buildBcODataEntityUrl(PROD_BASE, "ROCKS PC", "GeneralJournalBatches", "Production");
  const without = buildBcODataEntityUrl(PROD_BASE, "ROCKS PC", "GeneralJournalBatches");
  assert.equal(withArg, without, "passing the environment changed a Production URL");
});

test("every sync module passes the environment to the BC URL builders", () => {
  /* The source arm. A missing argument compiles, lints clean, and only fails
     at BC — per brand, at run time. These four modules are the ones that build
     a URL from a brand's own connection, so they are the ones where the base
     can be a Sandbox one. */
  for (const rel of [
    "lib/erp/account-sync.ts",
    "lib/erp/dimension-sync.ts",
    "lib/erp/vendor-sync.ts",
    "lib/erp/location-sync.ts",
  ]) {
    const src = fs.readFileSync(path.join(SRC, rel), "utf8");
    for (const fn of ["buildBcODataEntityUrl", "buildBcApiV2CompanyEntityUrl", "postBcCodexStoreRpc"]) {
      let at = src.indexOf(fn + "(");
      while (at !== -1) {
        // The call's own argument list, to its matching close paren.
        let depth = 0;
        let end = at + fn.length;
        for (let i = at + fn.length; i < src.length; i++) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
        }
        const call = src.slice(at, end);
        assert.ok(
          call.indexOf("environment") !== -1,
          `${rel} calls ${fn}( without naming the environment. It defaults to "Production" and ` +
            "gets appended to a base URL that may already end in /Sandbox — two environment " +
            "segments, which BC answers 400 RequestDataInvalid",
        );
        at = src.indexOf(fn + "(", at + 1);
      }
    }
  }
});
