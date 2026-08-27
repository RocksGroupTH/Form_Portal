import { test } from "node:test";
import assert from "node:assert/strict";
import { onFileAttached, onFileRemoved } from "./booking-file-sync";

test("the row's first file clears what was there and owns the read", () => {
  assert.deepEqual(onFileAttached({ existingFileCount: 0 }), { clearFirst: true, readReplaces: true });
});

/**
 * A second file is another page of the same booking, not a new booking. Wiping
 * on it would destroy figures the first file's read had just produced.
 */
test("a later file changes nothing that is already recorded", () => {
  assert.deepEqual(onFileAttached({ existingFileCount: 1 }), { clearFirst: false, readReplaces: false });
  assert.deepEqual(onFileAttached({ existingFileCount: 5 }), { clearFirst: false, readReplaces: false });
});

test("removing the last file takes the figures with it", () => {
  assert.equal(onFileRemoved({ remainingFileCount: 0 }), true);
});

/** Something still backs the figures, so they stay. */
test("removing one of several leaves the figures alone", () => {
  assert.equal(onFileRemoved({ remainingFileCount: 1 }), false);
  assert.equal(onFileRemoved({ remainingFileCount: 3 }), false);
});
