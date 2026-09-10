import assert from "node:assert/strict";
import { test } from "node:test";
import { makeColumnPrefs } from "./queue-column-prefs";

const COLS = [{ key: "a" }, { key: "b" }, { key: "c" }];

test("every column is shown by default when no subset is named", () => {
  const prefs = makeColumnPrefs(COLS, "cols", "order");
  assert.deepEqual(prefs.defaultVisible, { a: true, b: true, c: true });
});

test("a named subset is shown and the rest start hidden", () => {
  const prefs = makeColumnPrefs(COLS, "cols", "order", ["a", "c"]);
  assert.deepEqual(prefs.defaultVisible, { a: true, b: false, c: true });
});

/**
 * A table with 18 columns and 10 shown by default (AP-3's Control report) must
 * be able to say so, or reusing this factory would silently show all 18 to
 * every reader who had never opened the picker.
 */
test("a subset naming a column that no longer exists is ignored, not trusted", () => {
  const prefs = makeColumnPrefs(COLS, "cols", "order", ["a", "gone"]);
  assert.deepEqual(prefs.defaultVisible, { a: true, b: false, c: false });
});

test("mergeOrder drops stored keys that no longer exist", () => {
  const prefs = makeColumnPrefs(COLS, "cols", "order");
  assert.deepEqual(prefs.mergeOrder(["c", "gone", "a", "b"]), ["c", "a", "b"]);
});

test("mergeOrder appends a column the stored order has never seen", () => {
  const prefs = makeColumnPrefs(COLS, "cols", "order");
  assert.deepEqual(prefs.mergeOrder(["c", "a"]), ["c", "a", "b"]);
});
