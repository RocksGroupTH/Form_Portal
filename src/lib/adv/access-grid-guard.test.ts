import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The สิทธิ์เข้าถึง grid's invisible properties, read out of its source.
 *
 * `AdvClrAccessSettings.tsx` is a `"use client"` module — importing it drags
 * `useSWR`, `sonner` and the AD search modal in, so its behaviour cannot be
 * exercised here. What CAN be pinned is which helper each write goes through,
 * and that is exactly the failure to guard against: every property below is a
 * **missing call**, and a missing call leaves the screen looking correct.
 *
 * This is the weaker, outer layer. The rules themselves are unit-tested for
 * real in `approver-columns.test.ts` and `access-grid-rows.test.ts`; this file
 * only asserts the component still reaches them. Each assertion is made
 * **inside the function it is about**, not across the whole file, so a call
 * moved somewhere else does not satisfy it.
 */

const SRC = readFileSync(
  join(
    process.cwd(),
    "src/features/advance/components/settings/AdvClrAccessSettings.tsx",
  ),
  "utf8",
);

/**
 * One top-level `function NAME(...) { ... }`, parameter list included.
 *
 * The body's opening brace is found by walking the PARAMETER list to its
 * closing paren first. Every component here destructures its props, so the
 * first `{` after the name belongs to the parameter pattern, not the body —
 * counting braces from there closes at the end of the props type and returns
 * a few lines of signature, which then matches nothing and fails every
 * assertion for the wrong reason.
 */
function topLevelFunction(name: string): string {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is gone from the grid`);
  let paren = 0;
  let i = SRC.indexOf("(", start);
  for (; i < SRC.length; i += 1) {
    if (SRC[i] === "(") paren += 1;
    else if (SRC[i] === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  const open = SRC.indexOf("{", i);
  assert.notEqual(open, -1, `${name} has no body`);
  let depth = 0;
  for (let j = open; j < SRC.length; j += 1) {
    const ch = SRC[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, j + 1);
    }
  }
  assert.fail(`${name} never closes`);
}

/* The extractor has to actually extract, or every assertion below passes or
   fails on a few lines of signature. */
test("the extractor returns a whole function body, not its signature", () => {
  const fn = topLevelFunction("TabGrantCells");
  assert.ok(fn.length > 1200, `TabGrantCells came back as ${fn.length} characters`);
  assert.match(fn, /return \(/, "no JSX in the extracted body");
});

/**
 * The top-level keys of the object literal assigned to `const <name> ... = {`.
 *
 * **A substring search is not good enough here, and that was measured.** The
 * first version of the `form` guard below asserted `/\n\s*form,\n/` over the
 * whole function and a mutation deleting the POST body's `form` field
 * SURVIVED it — because `filterAdvClrKeysForForm(..., form,)` a few lines
 * above has `form,` on a line of its own. Splitting the literal on its own
 * top-level commas, with brace/paren/bracket depth tracked, is what tells a
 * field of this object from an argument of a call inside it.
 */
function objectKeys(declaration: string): string[] {
  const at = SRC.indexOf(declaration);
  assert.notEqual(at, -1, `${declaration} is gone`);
  // Comments come out FIRST, not per segment: the explanatory line above
  // `settingsTabs` contains a comma, and splitting before stripping made that
  // comma a field boundary — the parser then reported half a sentence as a
  // key and the guard failed for a reason that had nothing to do with the code
  // it guards.
  const src = SRC.slice(at)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const open = src.indexOf("{");
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `${declaration} never closes`);

  const keys: string[] = [];
  let segment = "";
  let d = 0;
  const take = () => {
    // Whatever precedes the first top-level colon; `foo,` (shorthand) and
    // `foo: bar,` both leave the key.
    const colon = segment.indexOf(":");
    const key = (colon === -1 ? segment : segment.slice(0, colon)).trim();
    if (key) keys.push(key);
    segment = "";
  };
  for (let i = open + 1; i < end; i += 1) {
    const ch = src[i];
    if (ch === "{" || ch === "(" || ch === "[") d += 1;
    else if (ch === "}" || ch === ")" || ch === "]") d -= 1;
    if (ch === "," && d === 0) {
      take();
      continue;
    }
    segment += ch;
  }
  take();
  return keys;
}

/* The parser has to actually parse, or every assertion over it is vacuous. */
test("the key parser reads a literal's own fields, not a nested call's arguments", () => {
  const keys = objectKeys("const body: Record<string, unknown> = ");
  assert.deepEqual(keys.sort(), ["displayName", "email", "form", "settingsTabs"]);
});

/* ── the bounded save ── */

test("the tab save still names its form", () => {
  // `setAdvClrAccessTabs` replaces only the named form's keys, and the route
  // refuses a save that does not name one rather than guessing. Dropping this
  // field does not silently widen the save — it stops every tick working — but
  // it is the field the whole form split rests on, so it is pinned here too.
  assert.ok(
    objectKeys("const body: Record<string, unknown> = ").indexOf("form") !== -1,
    "the POST body no longer carries `form`",
  );
});

test("the tab save posts only THIS form's keys", () => {
  // The service narrows again on arrival, but sending the other form's here
  // would make that a silent drop rather than a second line of defence.
  const fn = topLevelFunction("TabGrantCells");
  assert.match(
    fn,
    /settingsTabs:\s*filterAdvClrKeysForForm\(/,
    "settingsTabs is no longer filtered to this form",
  );
});

test("an approver-only row OMITS isActive instead of echoing false", () => {
  // The silent one. A row with no AccAdvClrAccess row has no flag to echo, and
  // `upsertAdvClrAccess` reads an absent one as "leave it alone" while a new
  // row defaults to active — so echoing the `false` this screen displays for
  // such a row would create the access row SWITCHED OFF, granting nothing and
  // leaving the tick looking broken.
  const fn = topLevelFunction("TabGrantCells");
  assert.match(
    fn,
    /if\s*\(row\.access\)\s*body\.isActive\s*=\s*row\.access\.isActive;/,
    "isActive is no longer conditional on the row having an access row",
  );
  // And it is not ALSO a field of the literal, which would make the
  // conditional line above a redundant overwrite of a value already sent.
  assert.equal(
    objectKeys("const body: Record<string, unknown> = ").indexOf("isActive"),
    -1,
    "isActive is in the POST body unconditionally — an orphan would be created switched off",
  );
});

/* ── the approver column ── */

test("the approver write goes through advClrApproverWriteBody", () => {
  // That helper is where "unticking a row that does not exist writes nothing"
  // and "an existing row is switched by id, never re-created by email" live,
  // both of them tested for real. A body built inline here would be neither.
  const fn = topLevelFunction("ApproverCells");
  assert.match(fn, /advClrApproverWriteBody\(\s*form,/);
  assert.match(fn, /if\s*\(!body\)\s*return;/, "a null body no longer stops the write");
});

test("the approver write and its cache name the endpoint the same way", () => {
  const fn = topLevelFunction("ApproverCells");
  assert.match(fn, /fetch\(advClrApproverEndpoint\(form\)/);
  assert.doesNotMatch(
    fn,
    /"\/api\/request\/(advance|clear-advance)\/settings\/approvers"/,
    "an endpoint is spelled out beside the write again",
  );
});

test("an unreadable approver roster renders a dash, never an empty box", () => {
  // With `rosterOk` false every tick would otherwise draw unticked — the
  // "unreadable renders as empty" lie — and a click would then CREATE an
  // approver row for somebody who may already have one.
  const fn = topLevelFunction("ApproverCells");
  assert.match(fn, /!rosterOk\s*\?/, "the failed-read branch is gone");
});

/* ── the union ── */

test("the grid's rows are the UNION, unfiltered on either IsActive", () => {
  // The requirement AP-4 had to be fixed out of twice: an approver with no
  // access row must be listed, inactive ones included. `buildAccessGridRows`
  // is what does that and it is tested; what a regex can still catch is the
  // roster being filtered on its way in.
  assert.match(
    SRC,
    /buildAccessGridRows\(\s*accessRows,\s*roster\.data\?\.rows \?\? \[\],\s*columns,?\s*\)/,
    "the roster handed to the builder is no longer the whole roster",
  );
});

test("the tbody maps the built rows rather than a filtered copy", () => {
  // `rows.filter(...)` legitimately appears above for the corner counts, so
  // the thing to pin is what the body actually iterates.
  assert.match(SRC, /\{rows\.map\(\(r, idx\) =>/, "the table body no longer maps `rows`");
});
