import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * These five routes reach a pool, and `@/env` validates the whole environment
 * at import — so none of them can be called from a test at all. This reads
 * their sources instead, and pins the two things a typechecker cannot see.
 *
 * Both failures are silent: every `FORM_CODE` is a string, so giving AP-4's
 * route `"AP-1"` compiles and edits the wrong form's copy; and every tab key
 * is a string on three of the five guards, so passing AP-2's key on AP-3's
 * route compiles and gates the wrong grant.
 *
 * **The gate itself changed on migration 166.** Until then all five were
 * `requireRole(["IT Admin", "System Admin"])` — admin-only, because the
 * ordinary settings-tab grant is a `TabKey` row in a table ACC Portal's own
 * saver rewrites wholesale, and a `messages` row stored there would vanish on
 * that app's next unrelated settings-tab save. Migration 166 gives each form's
 * roster row a `CanMessage` (or `CanAdvanceMessage` / `CanClearMessage`)
 * COLUMN instead, which that saver's explicit column list never names, so it
 * is now admin-OR-grant-holder — resolved by its own `require*MessageAccess()`
 * function (`@/lib/acc/message-grant` holds the shared decision). Each route's
 * `gate` below is that literal call. **This is the one assertion in the file
 * that flipped, and it must not be read as the file having gone soft**: the
 * "is NOT tab-gated" test right below is the one that did not move, and still
 * must not, since the reason a `TabKey` grant is wrong here is unchanged —
 * only WHICH admin-only-looking gate is expected changed, from a shared
 * literal to a per-form column-backed one.
 */
const ROUTES = [
  {
    path: "src/app/api/request/accounting/settings/messages/route.ts",
    code: "AP-1",
    gate: "requireAccMessageAccess()",
  },
  {
    path: "src/app/api/request/travel-booking/settings/messages/route.ts",
    code: "AP-17",
    gate: "requireBookingMessageAccess()",
  },
  {
    path: "src/app/api/request/reimburse/settings/messages/route.ts",
    code: "AP-4",
    gate: "requireReimburseMessageAccess()",
  },
  {
    path: "src/app/api/request/advance/settings/messages/route.ts",
    code: "AP-2",
    gate: "requireAdvanceMessageAccess()",
  },
  {
    path: "src/app/api/request/clear-advance/settings/messages/route.ts",
    code: "AP-3",
    gate: "requireClearMessageAccess()",
  },
];

/**
 * Each exported HTTP handler in a route file, as `[method, body-from-here]`.
 *
 * Copied from `settings-tabs.test.ts`'s own `splitHandlers` rather than
 * reinvented: an ordering check run over the WHOLE FILE is satisfied by import
 * declaration order alone, since every symbol these routes touch is named once
 * in an `import` line before it is ever called — see the `POST`-body check
 * below, which is exactly the assertion that used to read the imports and pass
 * regardless of what the handler actually did.
 */
function splitHandlers(source: string): { method: string; body: string }[] {
  const decl = /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const starts: { method: string; at: number }[] = [];
  let m = decl.exec(source);
  while (m) {
    starts.push({ method: m[1], at: m.index });
    m = decl.exec(source);
  }
  return starts.map((s, i) => ({
    method: s.method,
    body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
  }));
}

for (const r of ROUTES) {
  const src = readFileSync(r.path, "utf8");

  test(`${r.code}: FORM_CODE is its own literal`, () => {
    assert.ok(
      new RegExp(`const FORM_CODE = "${r.code}"`).test(src),
      `${r.path} does not pin FORM_CODE to ${r.code}`,
    );
  });

  test(`${r.code}: exactly one form code appears in the file`, () => {
    const found = Array.from(new Set(src.match(/"AP-\d+"/g) ?? []));
    assert.deepEqual(found, [`"${r.code}"`], `${r.path} names more than its own form`);
  });

  test(`${r.code}: the form code is never read from the request body`, () => {
    assert.ok(!/body\??\.\s*formCode/.test(src), `${r.path} reads formCode off the wire`);
  });

  test(`${r.code}: both handlers open with its own column-backed gate`, () => {
    const calls = src.match(/await require[A-Za-z]+\([^)]*\)/g) ?? [];
    assert.equal(calls.length, 2, `${r.path} should gate exactly GET and POST`);
    for (const c of calls) {
      assert.ok(
        c.includes(`await ${r.gate}`),
        `${r.path} uses the wrong gate: ${c} (expected ${r.gate})`,
      );
    }
  });

  test(`${r.code}: no other route's message gate leaked in`, () => {
    // Every gate name is a string too, exactly like every FORM_CODE above —
    // pasting AP-2's gate onto AP-3's route compiles and admits AP-2's holders
    // to AP-3's notice. Assert the OTHER four gate calls are absent.
    for (const other of ROUTES) {
      if (other.code === r.code) continue;
      assert.ok(
        !src.includes(`await ${other.gate}`),
        `${r.path} calls ${other.gate}, which belongs to ${other.code}`,
      );
    }
  });

  /**
   * The grant is unstorable AS A `TabKey` ROW: all four settings-tab tables are
   * shared with ACC Portal, whose save deletes an approver's rows and
   * re-inserts only the keys its own list knows — so a `messages` tick stored
   * there disappears on that app's next save, with no error either side (spec
   * §8). Migration 166 moved the grant onto a COLUMN instead
   * (`AccApprover.CanMessage` and its three siblings), which that same saver's
   * explicit column list never names — so each route now calls its own
   * `require*MessageAccess()` rather than `requireRole(...)`, and this
   * assertion is what stops a later hand "fixing" that back onto the ordinary
   * tab guard, which would silently reopen the exact hole spec §8 describes.
   */
  test(`${r.code}: is NOT tab-gated — the grant cannot be stored as a TabKey row`, () => {
    assert.ok(
      !/require(Settings|Booking|Reimburse|AdvClr)[A-Za-z]*Tab\s*\(/.test(src),
      `${r.path} is tab-gated; the grant would be deleted by ACC Portal — see spec §8`,
    );
  });

  test(`${r.code}: is NOT the bare admin-only gate either`, () => {
    // The other half of the same regression: swapping the column-backed gate
    // back for the flat requireRole(...) this file used to expect would also
    // compile and pass every other test here, quietly making the tab
    // admin-only again.
    assert.ok(
      !/requireRole\(\s*\[\s*"IT Admin"\s*,\s*"System Admin"\s*\]\s*\)/.test(src),
      `${r.path} is back on the bare admin-only gate — a grant holder can no longer open it`,
    );
  });

  test(`${r.code}: the refusal is returned, not computed and dropped`, () => {
    const returns = src.match(/if \(session instanceof Response\) return session;/g) ?? [];
    assert.equal(returns.length, 2, `${r.path} does not return both refusals`);
  });

  test(`${r.code}: the body is validated before anything is written`, () => {
    const post = splitHandlers(src).find((h) => h.method === "POST");
    assert.ok(post, `${r.path} exports no POST handler`);
    // Sliced to the handler body on purpose — over the whole file this passes
    // on import order alone, because both names are named once in an `import`
    // line before either is ever called.
    assert.ok(
      post.body.indexOf("messageBodyProblem") < post.body.indexOf("setFormMessage"),
      `${r.path} writes before it validates`,
    );
  });
}
