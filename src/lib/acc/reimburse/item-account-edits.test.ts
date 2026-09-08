import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_MAX_LEN,
  ITEM_ACCOUNT_EDITS_EMPTY_ERROR,
  ITEM_ACCOUNT_EDIT_INVALID_ERROR,
  ITEM_ACCOUNT_TOO_LONG_ERROR,
  parseItemAccountEdits,
} from "./item-account-edits";

test("a normal edit list parses, trimmed", () => {
  const r = parseItemAccountEdits([
    { id: 1, category: " 5100-01 " },
    { id: 2, category: null },
  ]);
  assert.deepEqual(r, {
    edits: [
      { id: 1, category: "5100-01" },
      { id: 2, category: null },
    ],
    error: null,
  });
});

test("an empty string clears the value, same as null", () => {
  const r = parseItemAccountEdits([{ id: 1, category: "   " }]);
  assert.deepEqual(r, { edits: [{ id: 1, category: null }], error: null });
});

test("not an array, or an empty one, is refused", () => {
  assert.deepEqual(parseItemAccountEdits(null), { edits: null, error: ITEM_ACCOUNT_EDITS_EMPTY_ERROR });
  assert.deepEqual(parseItemAccountEdits(undefined), { edits: null, error: ITEM_ACCOUNT_EDITS_EMPTY_ERROR });
  assert.deepEqual(parseItemAccountEdits([]), { edits: null, error: ITEM_ACCOUNT_EDITS_EMPTY_ERROR });
  assert.deepEqual(parseItemAccountEdits("nope"), { edits: null, error: ITEM_ACCOUNT_EDITS_EMPTY_ERROR });
});

test("a non-integer or non-positive id refuses the whole body", () => {
  for (const bad of [0, -1, 1.5, "abc", null, undefined]) {
    const r = parseItemAccountEdits([{ id: bad, category: "x" }]);
    assert.deepEqual(r, { edits: null, error: ITEM_ACCOUNT_EDIT_INVALID_ERROR }, JSON.stringify(bad));
  }
});

test("a category that is not a string (and not null/undefined) refuses the whole body", () => {
  const r = parseItemAccountEdits([{ id: 1, category: 123 }]);
  assert.deepEqual(r, { edits: null, error: ITEM_ACCOUNT_EDIT_INVALID_ERROR });
});

test("an entry that is not an object refuses the whole body", () => {
  const r = parseItemAccountEdits([1, 2]);
  assert.deepEqual(r, { edits: null, error: ITEM_ACCOUNT_EDIT_INVALID_ERROR });
});

/**
 * `AccReimburseItem.Category` is `NVARCHAR(50)` — see the module header for
 * why this refuses rather than lets the driver truncate silently.
 */
test("a category over the column's length is refused, not truncated", () => {
  const long = "a".repeat(CATEGORY_MAX_LEN + 1);
  const r = parseItemAccountEdits([{ id: 1, category: long }]);
  assert.deepEqual(r, { edits: null, error: ITEM_ACCOUNT_TOO_LONG_ERROR });
});

test("exactly the column's length is accepted", () => {
  const max = "a".repeat(CATEGORY_MAX_LEN);
  const r = parseItemAccountEdits([{ id: 1, category: max }]);
  assert.deepEqual(r, { edits: [{ id: 1, category: max }], error: null });
});

test("a repeated id keeps its first occurrence and drops the rest", () => {
  const r = parseItemAccountEdits([
    { id: 1, category: "first" },
    { id: 1, category: "second" },
  ]);
  assert.deepEqual(r, { edits: [{ id: 1, category: "first" }], error: null });
});
