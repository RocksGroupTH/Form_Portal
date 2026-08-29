import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addSectionItem, newRowLocalId } from "./travel-sections";
import type { TravelExpenseDetail } from "@/features/accounting/types";

/**
 * Every newly created expense row must carry a `localId`.
 *
 * Without one, `ExpenseRows` falls back to keying on the array index — and both
 * row creators PREPEND, so every existing row's index shifts. React then keeps
 * each component instance at its position and rebinds it to whichever row moved
 * into that slot, carrying an in-flight receipt read with it: the reading
 * indicator sits on one row while the file it is reading sits on another, and
 * the amount lands in the wrong place.
 *
 * This was fixed once at `addItem`'s call site and stayed broken in the Grab
 * sections, because the second creator was never touched. The source scan below
 * is what makes a third creator impossible to miss.
 */

test("a section row is created with an identity", () => {
  const day = {
    sections: [{ vehicleId: 2, vehicleName: "Grab", isManualEntry: true, items: [] }],
    items: [],
  } as unknown as TravelExpenseDetail;

  const after = addSectionItem(day, 0, "fare");
  const created = (after.sections ?? [])[0]?.items?.[0];
  assert.ok(created, "no row was created");
  assert.equal(typeof created.localId, "string");
  assert.ok((created.localId ?? "").length > 0);
});

test("two rows created in a row do not collide", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i++) ids.add(newRowLocalId());
  assert.equal(ids.size, 200);
});

test("a new row goes to the front, which is why identity is needed at all", () => {
  const day = {
    sections: [
      {
        vehicleId: 2,
        vehicleName: "Grab",
        isManualEntry: true,
        items: [{ itemType: "fare", amount: 99, localId: "existing" }],
      },
    ],
    items: [],
  } as unknown as TravelExpenseDetail;

  const items = (addSectionItem(day, 0, "fare").sections ?? [])[0]?.items ?? [];
  assert.equal(items.length, 2);
  assert.equal(items[1].localId, "existing", "the existing row moved from index 0 to index 1");
});

/**
 * The guard on the two creators. Reads the source rather than calling them,
 * because the failure it protects against is a *third* creator being added
 * without one — which no unit test of the existing two would ever notice.
 */
test("every literal that builds an expense row assigns a localId", () => {
  const files = [
    "src/features/accounting/lib/travel-sections.ts",
    "src/features/accounting/hooks/useTravelExpenseForm.ts",
  ];

  const offenders: string[] = [];
  let found = 0;

  for (const rel of files) {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
    // A row literal is recognised by `itemType` beside `amount: 0` — the shape
    // both creators use for a blank row. `[^{}]` already spans newlines, so no
    // `s` flag is needed — and the ES5 target rejects it anyway (TS1501).
    const re = /\{[^{}]*itemType[^{}]*amount:\s*0[^{}]*\}/g;
    for (const m of src.match(re) ?? []) {
      found++;
      if (m.indexOf("localId") === -1) offenders.push(`${rel}: ${m.replace(/\s+/g, " ").slice(0, 90)}`);
    }
  }

  assert.ok(found >= 2, `expected to find both row creators, found ${found}`);
  assert.deepEqual(
    offenders,
    [],
    "these create an expense row without a localId, so ExpenseRows will key it on its array index:\n" +
      offenders.join("\n"),
  );
});
