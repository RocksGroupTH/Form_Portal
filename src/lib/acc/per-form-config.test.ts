import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickForForm,
  defaultsOnly,
  PER_FORM_PREDICATE,
  perFormPredicate,
  perFormOrderBy,
} from "./per-form-config";

const DEFAULT_ROW = { formCode: null, v: "default" };
const AP1_ROW = { formCode: "AP-1", v: "ap1" };
const AP4_ROW = { formCode: "AP-4", v: "ap4" };

test("a form-specific row beats the default", () => {
  assert.equal(pickForForm([DEFAULT_ROW, AP1_ROW], "AP-1")?.v, "ap1");
  assert.equal(pickForForm([AP1_ROW, DEFAULT_ROW], "AP-1")?.v, "ap1");
});

test("a form with no row of its own falls back to the default", () => {
  assert.equal(pickForForm([DEFAULT_ROW, AP1_ROW], "AP-4")?.v, "default");
});

test("another form's row is never returned", () => {
  assert.equal(pickForForm([AP1_ROW], "AP-4"), null);
  assert.equal(pickForForm([AP1_ROW, AP4_ROW], "AP-17"), null);
});

test("no rows at all yields null, not undefined", () => {
  assert.equal(pickForForm([], "AP-1"), null);
});

test("defaultsOnly keeps exactly the shared rows", () => {
  assert.deepEqual(defaultsOnly([DEFAULT_ROW, AP1_ROW, AP4_ROW]), [DEFAULT_ROW]);
});

test("the predicate names both arms, so a caller cannot half-apply it", () => {
  assert.ok(PER_FORM_PREDICATE.indexOf("@formCode") !== -1);
  assert.ok(PER_FORM_PREDICATE.indexOf("IS NULL") !== -1);
});

test("the order by puts the form-specific row first", () => {
  assert.ok(perFormOrderBy().indexOf("IS NULL THEN 1 ELSE 0") !== -1);
  assert.ok(perFormOrderBy("t").indexOf("t.FormCode") !== -1);
});

test("the predicate takes an alias, so a joined query need not hand-write it", () => {
  assert.equal(perFormPredicate(), "(FormCode = @formCode OR FormCode IS NULL)");
  assert.equal(perFormPredicate("t"), "(t.FormCode = @formCode OR t.FormCode IS NULL)");
  // Both arms carry the alias — aliasing one and not the other is the mistake
  // this replaces, and it reads as valid SQL right up until it is ambiguous.
  assert.equal(perFormPredicate("m").indexOf("(FormCode"), -1);
});
