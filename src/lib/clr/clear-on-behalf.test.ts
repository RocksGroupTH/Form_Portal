import { test } from "node:test";
import assert from "node:assert/strict";
import { mayClearFor } from "./clear-on-behalf";

const ME = { staffId: 10177, departmentId: 7 };

test("you may always clear for yourself", () => {
  assert.equal(mayClearFor(ME, ME), true);
  // Even with no department on file — the ordinary case must not depend on HR
  // having filled that in.
  assert.equal(
    mayClearFor({ staffId: 10177, departmentId: null }, { staffId: 10177, departmentId: null }),
    true,
  );
});

test("a colleague in the same department is allowed", () => {
  assert.equal(mayClearFor(ME, { staffId: 10090, departmentId: 7 }), true);
});

test("somebody in another department is refused", () => {
  assert.equal(mayClearFor(ME, { staffId: 10105, departmentId: 9 }), false);
});

test("a missing department on either side is not a match", () => {
  // Two people HR has no department for are not thereby colleagues; treating
  // them as such would make every incomplete record a hole in the rule.
  assert.equal(mayClearFor(ME, { staffId: 10090, departmentId: null }), false);
  assert.equal(mayClearFor({ staffId: 10177, departmentId: null }, { staffId: 10090, departmentId: 7 }), false);
  assert.equal(
    mayClearFor({ staffId: 10177, departmentId: null }, { staffId: 10090, departmentId: null }),
    false,
  );
});

test("an unidentifiable person is refused, never waved through", () => {
  assert.equal(mayClearFor({ staffId: null, departmentId: 7 }, { staffId: 10090, departmentId: 7 }), false);
  assert.equal(mayClearFor(ME, { staffId: null, departmentId: 7 }), false);
  assert.equal(mayClearFor({}, {}), false);
});

test("the same department id does not make two different people the same person", () => {
  // Guards against an implementation that compares departments and forgets the
  // self case is about the person, not the department.
  assert.equal(mayClearFor(ME, { staffId: 10090, departmentId: 7 }), true);
  assert.equal(mayClearFor(ME, { staffId: 10090, departmentId: 8 }), false);
});
