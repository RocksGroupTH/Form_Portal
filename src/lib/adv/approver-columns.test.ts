import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADV_CLR_FORMS,
  type AdvClrForm,
} from "./settings-tabs";
import {
  advClrApproverColumnsForForm,
  advClrApproverEndpoint,
  advClrApproverWriteBody,
  isAdvClrApproverRole,
} from "./approver-columns";

/* ── the shape AP-4's grid could NOT simply be copied into ── */

test("AP-2 has one column per approver ROLE, not one per person", () => {
  // AccAdvanceApprover is unique on (Email, ApproverRole) — migration 083,
  // whose header says "One person may serve at both levels" — over the three
  // roles migrations 082 and 086 allow. A single tick would have had to guess
  // which level it meant, on the roster that decides who approves money.
  const roles = advClrApproverColumnsForForm("AP-2").map((c) => c.role);
  assert.deepEqual(roles, ["HEAD_ACC", "DIRECTOR", "ACC_OFFICER"]);
});

test("AP-3 has exactly one, and it is not the retired HEAD role", () => {
  // listAllClrApprovers filters WHERE Role = 'ACCOUNT'; the HEAD rows are kept
  // as history and read by nothing, so a column for them would approve nothing.
  const roles = advClrApproverColumnsForForm("AP-3").map((c) => c.role);
  assert.deepEqual(roles, ["ACCOUNT"]);
  assert.equal(isAdvClrApproverRole("AP-3", "HEAD"), false);
});

test("no role is shared between the two forms — the rosters are different tables", () => {
  for (const c of advClrApproverColumnsForForm("AP-2")) {
    assert.equal(isAdvClrApproverRole("AP-3", c.role), false, `${c.role} leaked to AP-3`);
  }
  for (const c of advClrApproverColumnsForForm("AP-3")) {
    assert.equal(isAdvClrApproverRole("AP-2", c.role), false, `${c.role} leaked to AP-2`);
  }
});

test("every column carries a header, a full name and a hint", () => {
  for (const form of ADV_CLR_FORMS) {
    for (const c of advClrApproverColumnsForForm(form)) {
      assert.ok(c.short.trim().length > 0, `${form}/${c.role} has no header`);
      assert.ok(c.label.trim().length > 0, `${form}/${c.role} has no label`);
      assert.ok(c.hint.trim().length > 0, `${form}/${c.role} has no hint`);
    }
  }
});

test("each form names its own endpoint, and they are two", () => {
  assert.equal(advClrApproverEndpoint("AP-2"), "/api/request/advance/settings/approvers");
  assert.equal(
    advClrApproverEndpoint("AP-3"),
    "/api/request/clear-advance/settings/approvers",
  );
  assert.notEqual(advClrApproverEndpoint("AP-2"), advClrApproverEndpoint("AP-3"));
});

/* ── the write body ── */

test("unticking something that does not exist writes NOTHING", () => {
  // Without this the caller falls through to the create branch and writes a
  // brand-new approver row with IsActive = 0 — a roster entry nobody asked
  // for, from the gesture that means "no".
  for (const form of ADV_CLR_FORMS) {
    const role = advClrApproverColumnsForForm(form)[0].role;
    assert.equal(
      advClrApproverWriteBody(form, { id: null, email: "a@b.com", role, isActive: false }),
      null,
    );
  }
});

test("an existing row is switched by id and never re-created by email", () => {
  // AP-2's route only runs its candidate check (บัญชี · ผู้บริหาร · IT) when the
  // body carries no id, so switching somebody back on has to keep working
  // after they have moved department — which is what a soft delete is for.
  const ap2 = advClrApproverWriteBody("AP-2", {
    id: 7,
    email: "a@b.com",
    role: "HEAD_ACC",
    isActive: true,
  });
  assert.deepEqual(ap2, { id: 7, isActive: true });
  assert.equal("email" in (ap2 as Record<string, unknown>), false);

  // AP-3's own upsert rewrites the row, so its API contract asks for role and
  // email beside the id — the same body its panel has always sent.
  assert.deepEqual(
    advClrApproverWriteBody("AP-3", {
      id: 9,
      email: "a@b.com",
      role: "ACCOUNT",
      isActive: false,
    }),
    { id: 9, role: "ACCOUNT", email: "a@b.com", isActive: false },
  );
});

test("creating names the role in each route's own spelling", () => {
  assert.deepEqual(
    advClrApproverWriteBody("AP-2", {
      id: null,
      email: " A@B.com ",
      role: "ACC_OFFICER",
      isActive: true,
    }),
    { email: "A@B.com", approverRole: "ACC_OFFICER", isActive: true },
  );
  assert.deepEqual(
    advClrApproverWriteBody("AP-3", {
      id: null,
      email: "a@b.com",
      role: "ACCOUNT",
      isActive: true,
    }),
    { role: "ACCOUNT", email: "a@b.com", isActive: true },
  );
});

test("a role the form does not have is refused, with or without an id", () => {
  // The table has no CHECK that would stop a made-up role reaching it on AP-2,
  // and AP-3's upsert throws on anything but ACCOUNT — refusing here means the
  // grid can never be the thing that sends one.
  for (const bad of ["ACCOUNT", "HEAD", "", "acc_officer"]) {
    assert.equal(
      advClrApproverWriteBody("AP-2", { id: null, email: "a@b.com", role: bad, isActive: true }),
      null,
      `AP-2 accepted ${bad}`,
    );
    assert.equal(
      advClrApproverWriteBody("AP-2", { id: 3, email: "a@b.com", role: bad, isActive: false }),
      null,
      `AP-2 accepted ${bad} on an edit`,
    );
  }
  for (const bad of ["HEAD_ACC", "DIRECTOR", "HEAD"]) {
    assert.equal(
      advClrApproverWriteBody("AP-3", { id: null, email: "a@b.com", role: bad, isActive: true }),
      null,
      `AP-3 accepted ${bad}`,
    );
  }
});

test("creating without an email writes nothing", () => {
  for (const form of ADV_CLR_FORMS) {
    const role = advClrApproverColumnsForForm(form)[0].role;
    for (const email of ["", "   "]) {
      assert.equal(
        advClrApproverWriteBody(form, { id: null, email, role, isActive: true }),
        null,
        `${form} created a row with no email`,
      );
    }
  }
});

test("every form in ADV_CLR_FORMS has at least one approver column", () => {
  // A form with none would render an empty group heading and a grid that
  // silently cannot say who approves it.
  for (const form of ADV_CLR_FORMS as readonly AdvClrForm[]) {
    assert.ok(advClrApproverColumnsForForm(form).length > 0, `${form} has no approver column`);
  }
});
