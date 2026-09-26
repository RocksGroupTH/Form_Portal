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
 */
const GATE = 'requireRole(["IT Admin", "System Admin"])';

const ROUTES = [
  { path: "src/app/api/request/accounting/settings/messages/route.ts", code: "AP-1" },
  { path: "src/app/api/request/travel-booking/settings/messages/route.ts", code: "AP-17" },
  { path: "src/app/api/request/reimburse/settings/messages/route.ts", code: "AP-4" },
  { path: "src/app/api/request/advance/settings/messages/route.ts", code: "AP-2" },
  { path: "src/app/api/request/clear-advance/settings/messages/route.ts", code: "AP-3" },
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

  test(`${r.code}: both handlers open with the admin gate`, () => {
    const calls = src.match(/await require[A-Za-z]+\([^)]*\)/g) ?? [];
    assert.equal(calls.length, 2, `${r.path} should gate exactly GET and POST`);
    for (const c of calls) {
      assert.ok(c.includes(GATE), `${r.path} uses the wrong gate: ${c}`);
    }
  });

  /**
   * The grant is unstorable: all four settings-tab tables are shared with ACC
   * Portal, whose save deletes an approver's rows and re-inserts only the keys
   * its own list knows — so a `messages` tick made here disappears on that
   * app's next save, with no error either side (spec §8). Swapping this gate
   * for a tab guard compiles and passes every other test in the repo, so this
   * is the only thing standing between that and shipping.
   */
  test(`${r.code}: is NOT tab-gated — the grant cannot be stored`, () => {
    assert.ok(
      !/require(Settings|Booking|Reimburse|AdvClr)[A-Za-z]*Tab\s*\(/.test(src),
      `${r.path} is tab-gated; the grant would be deleted by ACC Portal — see spec §8`,
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
