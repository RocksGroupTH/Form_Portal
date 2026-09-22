import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = () =>
  fs.readFileSync(path.join(process.cwd(), "src/lib/acc/travel-booking/requester-trips.ts"), "utf8");

test("the query is pinned to AP-17 and excludes drafts", () => {
  // AccRequest is shared by five forms. Without the FormCode pin this loader
  // hands AP-17's per-diem chain another form's date ranges.
  const s = SRC();
  assert.ok(s.includes("r.FormCode = 'AP-17'"), "the AP-17 pin is gone");
  assert.ok(s.includes("r.Status <> 'Draft'"), "drafts would collide with their own submit");
});

test("the requester is matched on StaffId OR EmployeeId, not one alone", () => {
  const s = SRC();
  assert.ok(s.includes("r.StaffId = @staffId"));
  assert.ok(s.includes("r.EmployeeId = @employeeId"));
});

test("excluded ids are bound, never interpolated", () => {
  // The one place a list becomes SQL. A template literal here is an injection
  // hole even though the values are internal ids.
  const s = SRC();
  assert.ok(/\.input\(`ex\$\{i\}`/.test(s), "excluded ids must be bound one parameter each");
  assert.ok(!/NOT IN \(\$\{input\.excludeRequestIds/.test(s), "excluded ids are interpolated");
});
