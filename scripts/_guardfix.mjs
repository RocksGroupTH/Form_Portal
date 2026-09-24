import fs from "node:fs";
const P = "src/lib/acc/mail-on-step-advance-guard.test.ts";
let s = fs.readFileSync(P, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const j = (a) => a.join(eol);

const OLD = j([
  'test("no approval engine mails a roster in a loop", () => {',
  "  /* The deleted shape, in all five: `for (const a of approvers) await",
  "     notify(...)`. A queue's own page is where that work is found; a message per",
  "     arrival is a message nobody reads. */",
  "  for (const file of FILES) {",
  "    const src = code(file);",
  "    const loops = src.match(/for\s*\([^)]*\)\s*\{?[\s\S]{0,200}?(await\s+(notify|queueEmail|notifyQuietly)\()/g) ?? [];",
  "    assert.equal(",
  "      loops.length,",
  "      0,",
  "      `${file} mails inside a loop again — that is the per-arrival notification the ` +",
  '        "2026-09-24 change removed from every form",',
  "    );",
  "  }",
  "});",
]);

const NEW = j([
  "/**",
  " * The ONE roster mail left, named so it is an exception on the record rather",
  " * than an oversight.",
  " *",
  " * `returnByAccount` (AP-17) tells the Admin desk that accounting has sent a",
  " * booking back to be redone. Structurally it is a mail to a queue, which is",
  " * what the 2026-09-24 change removed everywhere else; semantically it is a",
  ' * ส่งกลับ — work already done being refused — and the file\'s own comment',
  " * argues that a bounce is an exception worth an interruption where routine",
  " * arrivals are not. Kept on that reading, and left here in one line so that",
  " * removing it is a decision somebody takes rather than a sweep they run.",
  " *",
  " * It also inherits a defect the file records: it reads AP-1's `AccApprover`",
  " * roster while AP-17's Admin desk is `AccBookingApprover`, so it reaches",
  " * people who cannot act and misses people who can. Nobody has asked for that",
  " * to be fixed.",
  " */",
  'const ALLOWED_ROSTER_MAIL = /"ReadyForAdmin"/;',
  "",
  'test("no approval engine mails a roster in a loop", () => {',
  "  /* The deleted shape, in all five: `for (const a of approvers) await",
  "     notify(...)`. A queue's own page is where that work is found; a message per",
  "     arrival is a message nobody reads. */",
  "  for (const file of FILES) {",
  "    const src = code(file);",
  "    const loops = (",
  "      src.match(/for\s*\([^)]*\)\s*\{?[\s\S]{0,200}?(await\s+(notify|queueEmail|notifyQuietly)\()/g) ?? []",
  "    ).filter((m) => !ALLOWED_ROSTER_MAIL.test(m));",
  "    assert.equal(",
  "      loops.length,",
  "      0,",
  "      `${file} mails inside a loop again — that is the per-arrival notification the ` +",
  '        "2026-09-24 change removed from every form",',
  "    );",
  "  }",
  "});",
  "",
  'test("the one allowed roster mail is still the Admin bounce, and still the only one", () => {',
  "  /* If this goes red because the trigger was renamed, re-read",
  "     `ALLOWED_ROSTER_MAIL` before widening it: the exemption is for one",
  "     send, not for the shape. */",
  "  const src = code(\"src/lib/acc/travel-booking/approval.ts\");",
  "  const hits = src.match(/\"ReadyForAdmin\"/g) ?? [];",
  "  assert.equal(hits.length, 1, `expected exactly one ReadyForAdmin send, found ${hits.length}`);",
  "});",
]);

if (!s.includes(OLD)) throw new Error("guard anchor not found");
s = s.replace(OLD, NEW);
fs.writeFileSync(P, s);
console.log("ok");
