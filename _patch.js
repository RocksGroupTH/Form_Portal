const fs = require("fs");
const f = "src/lib/acc/brand-erp-environment-guard.test.ts";
let s = fs.readFileSync(f, "utf8").split("\r\n").join("\n");

const from = s.slice(s.indexOf('test("every statement on a split table'), s.indexOf('test("the three services'));
const to = `test("every statement on a split table bounds itself by the environment", () => {
  const offenders: string[] = [];
  for (const { rel, src } of FILES) {
    for (const fn of functions(src)) {
      const stmts = templates(fn.body).filter(
        (sql) => isStatement(sql) && SPLIT_TABLES.some((t) => sql.indexOf(t) !== -1),
      );
      if (stmts.length === 0) continue;

      /* An INSERT bounds itself by naming the column — there is no WHERE to
         put a predicate in. Anything else needs one. */
      for (const sql of stmts) {
        if (!/\bINSERT\b/i.test(sql)) continue;
        const cols = /\(([^)]*)\)\s*(?:\r?\n\s*)?VALUES/i.exec(sql);
        if (!cols || cols[1].indexOf(BRAND_ERP_ENVIRONMENT_COLUMN) === -1)
          offenders.push(\`\${rel} — \${fn.name}: an INSERT with no Environment column\`);
      }

      /* Counted per function, not merely present, because the predicate is
         often SEEDED INTO AN ARRAY the template interpolates —
         \`const conditions = [brandErpEnvPredicate()]\` — so the text a read
         needs is outside the read's own template. A presence test would then
         be satisfied by a SIBLING statement's call, and this exact file's
         earlier version was satisfied by the SELECT's column LIST while its
         WHERE went unbounded. One call per statement is the real rule. */
      const need = stmts.filter((sql) => !/\bINSERT\b/i.test(sql)).length;
      const have = fn.body.split("brandErpEnvPredicate").length - 1;
      if (have < need)
        offenders.push(
          \`\${rel} — \${fn.name}: \${need} statement(s) needing the environment, \${have} brandErpEnvPredicate call(s)\`,
        );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these read or write a per-brand Interface ERP table without bounding it to one environment. " +
      "Since migration 161 each table holds Production AND Sandbox rows: a read returns the other " +
      "environment's account or batch, and an unbounded delete-then-insert removes it:\n  " +
      offenders.join("\n  "),
  );
});

`;
if (s.indexOf(from) === -1) { console.log("MISS body"); process.exit(1); }
s = s.replace(from, to);

// Helpers the new test needs.
const hFrom = `function isStatement(sql: string): boolean {
  return /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql);
}`;
const hTo = `function isStatement(sql: string): boolean {
  return /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql);
}

/**
 * The file's top-level functions, as \`{ name, body }\`.
 *
 * The unit has to be the function rather than the statement, because the
 * predicate a statement depends on is frequently not inside it — see the
 * counting rule in the first test.
 */
function functions(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /\n(?:export )?(?:async )?function (\w+)/g;
  const marks: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) marks.push({ name: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    out.push({ name: marks[i].name, body: src.slice(marks[i].at, end) });
  }
  return out;
}`;
if (s.indexOf(hFrom) === -1) { console.log("MISS helper"); process.exit(1); }
s = s.replace(hFrom, hTo);

// The column constant, imported rather than retyped.
s = s.replace(
  `import path from "node:path";`,
  `import path from "node:path";
import { BRAND_ERP_ENVIRONMENT_COLUMN } from "@/lib/acc/brand-erp-environment";`,
);
fs.writeFileSync(f, s.split("\n").join("\r\n"));
console.log("patched");
