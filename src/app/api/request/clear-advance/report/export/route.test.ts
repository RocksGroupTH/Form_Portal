import test from "node:test";
import assert from "node:assert/strict";
import { controlExportOrder, CONTROL_EXPORT_ORDER } from "@/lib/clr/report-export-order";

/**
 * What `?cols=` can do to the file, and what it cannot.
 *
 * The value comes from the reader's localStorage by way of a query string, so
 * it is untrusted twice over. The route must never answer with a file that has
 * a column missing, doubled, or invented — only with one whose columns are in a
 * different order.
 *
 * The route itself is not imported: it pulls `@/lib/db/mssql` → `@/env`, which
 * validates the environment at module scope and throws under `tsx` with no env
 * file loaded (see the note at the top of `src/lib/acc/payment-calendar-core.ts`).
 */

/** What the route does to `?cols=` before ordering: split on comma, drop empties. */
const parse = (raw: string | null) => (raw ?? "").split(",").filter(Boolean);

test("no cols parameter -> today's file, unchanged", () => {
  assert.deepEqual(controlExportOrder(parse(null)), CONTROL_EXPORT_ORDER);
  assert.deepEqual(controlExportOrder(parse("")), CONTROL_EXPORT_ORDER);
});

test("a stale or hand-edited value cannot lose or invent a column", () => {
  for (const raw of [",,,", "nope,alsonope", "requestNo,,requestNo", "<script>", "a".repeat(500)]) {
    assert.deepEqual(
      Array.from(controlExportOrder(parse(raw))).sort(),
      Array.from(CONTROL_EXPORT_ORDER).sort(),
      raw,
    );
  }
});

test("a real reordering is honoured", () => {
  const out = controlExportOrder(parse("overallStatus,requestNo"));
  assert.equal(out[0], "overallStatus");
  assert.equal(out[1], "requestNo");
});
