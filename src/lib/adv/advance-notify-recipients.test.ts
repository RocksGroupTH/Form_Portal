import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceNotifyList, isOnBehalf } from "./advance-notify-recipients";

const FOR = "butsaba.o@rocksgroup.com";   // the person it is for
const BY = "officer@rocksgroup.com";      // the person who filed it
const APPROVER = "nipaporn.s@rocksgroup.com";

test("filed by somebody else is on-behalf; filed by yourself is not", () => {
  assert.equal(isOnBehalf({ requesterEmail: FOR, filerEmail: BY }), true);
  assert.equal(isOnBehalf({ requesterEmail: FOR, filerEmail: FOR }), false);
});

test("the comparison ignores case and surrounding space, on BOTH sides", () => {
  // The two sides come from different systems — HR's COALESCE(Email,
  // EmailCompBr) and the portal login — so the same person can be spelled two
  // ways, and it can be either side that is spelled oddly. Normalising only the
  // filer leaves a self-filed request reading as on-behalf whenever HR is the
  // one holding the capitals.
  assert.equal(isOnBehalf({ requesterEmail: FOR, filerEmail: "  BUTSABA.O@RocksGroup.com " }), false);
  assert.equal(isOnBehalf({ requesterEmail: "  BUTSABA.O@RocksGroup.com ", filerEmail: FOR }), false);
  assert.deepEqual(
    advanceNotifyList([], { requesterEmail: " " + FOR.toUpperCase() + " ", filerEmail: FOR }),
    [],
  );
});

test("an unknown filer is not on-behalf", () => {
  // Absence must not turn a self-filed request into an on-behalf one, which
  // would mail the requester about the submit they just performed.
  for (const filerEmail of [null, undefined, "", "   "]) {
    assert.equal(isOnBehalf({ requesterEmail: FOR, filerEmail }), false);
  }
});

test("the filer is added to a trigger that only named the requester", () => {
  assert.deepEqual(
    advanceNotifyList([FOR], { requesterEmail: FOR, filerEmail: BY }),
    [FOR, BY],
  );
});

test("on submit, the person it was filed for is told as well", () => {
  // The submit mail names the approvers; neither of the two people involved is
  // on it, and the requester has no idea a request went out in their name.
  assert.deepEqual(
    advanceNotifyList([APPROVER], { requesterEmail: FOR, filerEmail: BY }, { alsoRequester: true }),
    [APPROVER, BY, FOR],
  );
});

test("a self-filed request gains nobody, on any trigger", () => {
  assert.deepEqual(
    advanceNotifyList([APPROVER], { requesterEmail: FOR, filerEmail: FOR }, { alsoRequester: true }),
    [APPROVER],
  );
  assert.deepEqual(
    advanceNotifyList([FOR], { requesterEmail: FOR, filerEmail: FOR }),
    [FOR],
  );
});

test("alsoRequester is off by default, so only submit tells the requester", () => {
  assert.deepEqual(
    advanceNotifyList([APPROVER], { requesterEmail: FOR, filerEmail: BY }),
    [APPROVER, BY],
  );
});

test("a filer already on the roster is not mailed twice", () => {
  // Cancelled already unions the head roster with the requester, and the filer
  // is frequently on that roster.
  assert.deepEqual(
    advanceNotifyList([BY, FOR], { requesterEmail: FOR, filerEmail: BY }),
    [BY, FOR],
  );
});

test("duplicates and blanks in the caller's own list are dropped", () => {
  assert.deepEqual(
    advanceNotifyList([APPROVER, "", null, " " + APPROVER.toUpperCase() + " ", undefined], { requesterEmail: FOR, filerEmail: BY }),
    [APPROVER, BY],
  );
});

test("the first spelling wins, so the queue reads the way the caller wrote it", () => {
  assert.deepEqual(
    advanceNotifyList([APPROVER.toUpperCase()], { requesterEmail: FOR, filerEmail: APPROVER }),
    [APPROVER.toUpperCase()],
  );
});

test("a request with no requester email still reaches its filer", () => {
  // A blank requester makes the filer different from it, which is the right
  // answer: somebody filed it, and they are the only address there is.
  assert.deepEqual(advanceNotifyList([], { requesterEmail: null, filerEmail: BY }), [BY]);
});

test("the input list is not mutated", () => {
  const base = [APPROVER];
  advanceNotifyList(base, { requesterEmail: FOR, filerEmail: BY }, { alsoRequester: true });
  assert.deepEqual(base, [APPROVER]);
});
