import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **All five forms say the same four sentences, from one module.**
 *
 * The copy is the user's (2026-09-24) and the point of it was that a mail
 * should state what happened rather than leave a reader to infer it from a
 * table. Five forms build their mail five different ways — two share a
 * `shell`, AP-3 concatenates HTML strings by hand — so nothing but a guard
 * keeps the wording together. Reword one and the other four drift.
 *
 * **Source-shape, and the weaker of the two layers.** `mail-copy.test.ts` is
 * the one with teeth: it asserts the sentences themselves. This one asserts
 * that each form actually reaches for them, which is a *missing call* and so
 * invisible to any behavioural test — every one of these modules imports
 * `@/env` and cannot be loaded here at all.
 */

const ROOT = process.cwd();

/** Every module that builds a notification a person reads. */
const MAIL_BUILDERS = [
  "src/lib/acc/email-templates.ts", // AP-1
  "src/lib/acc/travel-booking/email-templates.ts", // AP-17
  "src/lib/adv/advance-email-templates.ts", // AP-2
  "src/lib/clr/clear-advance-approval-engine.ts", // AP-3, the three outcomes
  "src/lib/clr/clear-advance-request-service.ts", // AP-3, the submit
  "src/lib/acc/reimburse/approval-service.ts", // AP-4, the three outcomes
  "src/lib/acc/reimburse/request-service.ts", // AP-4, the submit
];

function code(file: string): string {
  return fs
    .readFileSync(path.resolve(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("every form's mail builder takes its copy from mail-copy.ts", () => {
  for (const file of MAIL_BUILDERS) {
    assert.match(
      code(file),
      /from "@\/lib\/acc\/mail-copy"/,
      `${file} builds a mail without the shared copy — reword it there, not here`,
    );
  }
});

test("each of the four sentences is used by at least one form", () => {
  const all = MAIL_BUILDERS.map(code).join("\n");
  for (const fn of ["submittedLead", "approvedLead", "rejectedLead", "returnedLead"]) {
    assert.match(all, new RegExp(`\\b${fn}\\(`), `nothing calls ${fn} any more`);
  }
});

test("the submit sentence reaches ALL FIVE forms", () => {
  /* The one the user named first, and the only mail an approver gets. A form
     that stops calling it leaves a manager with a table and no instruction. */
  const submitters = [
    "src/lib/acc/email-templates.ts",
    "src/lib/acc/travel-booking/email-templates.ts",
    "src/lib/adv/advance-email-templates.ts",
    "src/lib/clr/clear-advance-request-service.ts",
    "src/lib/acc/reimburse/request-service.ts",
  ];
  for (const file of submitters) {
    assert.match(code(file), /submittedLead\(/, `${file} no longer sends the submit sentence`);
  }
});

test("nobody keeps a private copy of esc", () => {
  /* Two escapers is how one of them stops escaping. AP-3 interpolated an
     approver's comment raw into its mail body until 2026-09-24; the fix was to
     hand out finished HTML from one module rather than a string plus a habit. */
  const offenders = MAIL_BUILDERS.filter((f) => /export function esc\s*\(/.test(code(f)));
  assert.deepEqual(offenders, [], "esc must come from @/lib/acc/mail-copy");
});

test("AP-3 no longer interpolates the approver's comment unescaped", () => {
  const src = code("src/lib/clr/clear-advance-approval-engine.ts");
  assert.doesNotMatch(src, /\$\{comment\}/, "`${comment}` in an HTML body is an injection");
});
