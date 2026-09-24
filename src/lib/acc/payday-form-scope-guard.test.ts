import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Every payday call must name its own form, and `tsc` cannot check which.**
 *
 * `getPaymentDates`, `getDefaultPaymentDate` and `paymentRoundsForApprovals`
 * took a mandatory, defaultless `form` on 2026-09-24 so that nobody could
 * inherit AP-1's fortnightly calendar by saying nothing. That works: a caller
 * that passes no form does not compile. It says nothing at all about a caller
 * that passes the *wrong* one — and these routes were built by copying each
 * other (AP-3's screens are copies of AP-2's; the commit before this one fixed
 * two of them still fetching AP-2's endpoint), so a copy keeping the form code
 * it was copied from is the most likely mistake there is here.
 *
 * It is also among the quietest. The wrong form returns a perfectly valid list
 * of Fridays; the picker offers them, the approval engine accepts them, and the
 * only symptom is money leaving on a day that form does not pay on. No type
 * error, no exception, no failing assertion anywhere else in the suite.
 *
 * So this asserts the one thing the compiler cannot: the form named matches the
 * directory it is named in. It walks the directories rather than listing files,
 * so a route added next month is covered the day it lands rather than the day
 * somebody remembers to add it here.
 *
 * Source-reading, like the other guards in this neighbourhood: every one of
 * these modules reaches `@/lib/db/mssql` → `@/env`, which validates the whole
 * environment at import and throws under a bare test runner.
 *
 * **Not a veto.** A directory that legitimately serves another form is a fine
 * change — it just has to be declared in `SCOPES` below, where the next reader
 * can see it.
 */

/** The three payday entry points. A fourth added later belongs in this list. */
const CALLS = ["getPaymentDates", "getDefaultPaymentDate", "paymentRoundsForApprovals"];

/**
 * Directory → the form code every payday call under it must name.
 *
 * `exclude` is matched against the path relative to `src/`. AP-4 lives under
 * `lib/acc/reimburse/` with a calendar of its own (1st and 3rd Friday) and does
 * not use these functions; `lib/acc/payment-calendar.ts` is where they are
 * *declared*, so its own signatures would otherwise read as AP-1 calls that
 * name `form` instead of a literal.
 */
const SCOPES: { form: string; dirs: string[]; exclude: string[] }[] = [
  {
    form: "AP-2",
    dirs: ["lib/adv", "app/api/request/advance"],
    exclude: [],
  },
  {
    form: "AP-3",
    dirs: ["lib/clr", "app/api/request/clear-advance"],
    exclude: [],
  },
  {
    form: "AP-1",
    dirs: ["lib/acc", "app/api/request/accounting"],
    exclude: ["lib/acc/reimburse", "lib/acc/payment-calendar.ts"],
  },
];

const SRC = path.join(process.cwd(), "src");

/** Every .ts/.tsx file under `dir`, tests excluded — they quote forms on purpose. */
function walk(dir: string): string[] {
  const abs = path.join(SRC, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Comments naming a rule must not satisfy the check for it — this file's own header included. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

/** Each payday call in `src`, as [call name, whatever its first argument was]. */
function paydayCalls(src: string): [string, string][] {
  const re = new RegExp(
    String.raw`\b(${CALLS.join("|")})\s*\(\s*("[^"]*"|'[^']*'|[^,)]*)`,
    "g",
  );
  const out: [string, string][] = [];
  // exec/while rather than matchAll: this repo's tsconfig target predates the
  // iterator protocol on RegExpStringIterator, so matchAll does not compile here.
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push([m[1], m[2].trim()]);
  return out;
}

for (const scope of SCOPES) {
  test(`every payday call under ${scope.dirs.join(" and ")} names "${scope.form}"`, () => {
    const files = scope.dirs
      .flatMap((d) => walk(d))
      .filter((f) => !scope.exclude.some((x) => f === x || f.startsWith(`${x}/`)));

    // A scan that silently finds nothing passes forever. If this fires, the
    // directories moved and the guard moved with them or stopped guarding.
    assert.ok(
      files.length > 0,
      `no source files found under ${scope.dirs.join(", ")} — the guard is scanning ` +
        "nothing. Fix SCOPES to name where these routes live now",
    );

    let calls = 0;
    for (const file of files) {
      for (const [name, arg] of paydayCalls(code(file))) {
        calls++;
        assert.equal(
          arg,
          `"${scope.form}"`,
          `src/${file} calls ${name}(${arg}) — everything under ${scope.dirs.join(" or ")} ` +
            `pays on ${scope.form}'s calendar and must pass the literal "${scope.form}". ` +
            "AP-2 pays every Friday; AP-1 and AP-3 pay the 2nd and 4th. The wrong form " +
            "returns a valid list of Fridays, so nothing else in this suite would notice — " +
            "the only symptom is money leaving on a day this form does not pay on. If the " +
            "directory really does serve another form now, declare it in SCOPES",
        );
      }
    }
    assert.ok(
      calls > 0,
      `found ${files.length} file(s) under ${scope.dirs.join(", ")} but no call to any of ` +
        `${CALLS.join("/")}. Either the entry points were renamed — add the new names to ` +
        "CALLS — or this scope no longer reads the payday calendar and should be removed",
    );
  });
}
