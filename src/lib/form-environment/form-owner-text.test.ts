import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORM_OWNER_FALLBACK,
  formatFormOwner,
  formOwnerNotice,
} from "./form-owner-text";

/**
 * The line at the foot of every form telling a requester who to ask.
 *
 * It existed before the owners did, as a bare sentence naming nobody. The user
 * asked on 2026-09-24 for the names and addresses to be appended — and the
 * thing that must keep working is the case where there are none, because
 * migration 163 seeds nothing and every form starts that way.
 */

test("one owner reads ชื่อ (อีเมล)", () => {
  assert.equal(
    formOwnerNotice([{ email: "a@rocksgroup.com", displayName: "Somchai Jaidee" }]),
    `${FORM_OWNER_FALLBACK}: Somchai Jaidee (a@rocksgroup.com)`,
  );
});

test("several are separated by commas, in the order given", () => {
  // The service orders by display name; this must not reorder them again and
  // disagree with the settings grid an admin just looked at.
  assert.equal(
    formOwnerNotice([
      { email: "a@rocksgroup.com", displayName: "Anan" },
      { email: "b@rocksgroup.com", displayName: "Bee" },
    ]),
    `${FORM_OWNER_FALLBACK}: Anan (a@rocksgroup.com), Bee (b@rocksgroup.com)`,
  );
});

test("no owner falls back to the sentence the forms carried before", () => {
  /* Not to an empty line: the requester still needs telling that cancelling
     late means asking somebody, even while the page cannot say who. This is
     every form on the day 163 lands. */
  assert.equal(formOwnerNotice([]), FORM_OWNER_FALLBACK);
  assert.equal(formOwnerNotice(null), FORM_OWNER_FALLBACK);
  assert.equal(formOwnerNotice(undefined), FORM_OWNER_FALLBACK);
});

test("a payload that failed to load reads the same as no owner", () => {
  // The client passes `data?.forms?.[code]?.owners`, which is undefined on a
  // failed fetch. A contact line must never be why a form renders an error.
  assert.equal(formOwnerNotice(undefined), FORM_OWNER_FALLBACK);
});

test("an owner with no name shows the address alone, not an empty bracket", () => {
  assert.equal(formatFormOwner({ email: "a@rocksgroup.com" }), "a@rocksgroup.com");
  assert.equal(formatFormOwner({ email: "a@rocksgroup.com", displayName: "  " }), "a@rocksgroup.com");
  assert.equal(
    formOwnerNotice([{ email: "a@rocksgroup.com", displayName: null }]),
    `${FORM_OWNER_FALLBACK}: a@rocksgroup.com`,
  );
});

test("an owner with no address is dropped rather than rendered", () => {
  /* The settings page cannot write one — it requires a directory pick — but
     the column is nullable and this line is not the place to find that out. */
  assert.equal(
    formOwnerNotice([
      { email: "", displayName: "Ghost" },
      { email: "a@rocksgroup.com", displayName: "Anan" },
    ]),
    `${FORM_OWNER_FALLBACK}: Anan (a@rocksgroup.com)`,
  );
  assert.equal(formOwnerNotice([{ email: "   ", displayName: "Ghost" }]), FORM_OWNER_FALLBACK);
});

test("the fallback is the exact sentence, so the line does not change when nobody is named", () => {
  assert.equal(FORM_OWNER_FALLBACK, "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม");
});
