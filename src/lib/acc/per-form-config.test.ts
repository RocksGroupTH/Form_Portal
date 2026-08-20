import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickForForm,
  pickAllForForm,
  defaultsOnly,
  PER_FORM_PREDICATE,
  perFormPredicate,
  perFormOrderBy,
  perFormWriteMatch,
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

// --- pickAllForForm: the list form of the same rule ------------------------

const keyOf = (r: { key: string }) => r.key;

test("a list keeps one row per key, the override winning its own key", () => {
  const rows = [
    { key: "PCTH 540100", formCode: null, v: "default-540100" },
    { key: "PCTH 540100", formCode: "AP-4", v: "ap4-540100" },
    { key: "PCTH 540200", formCode: null, v: "default-540200" },
  ];
  assert.deepEqual(
    pickAllForForm(rows, "AP-4", keyOf).map((r) => r.v),
    ["ap4-540100", "default-540200"],
  );
  // A form with no override of its own sees the defaults untouched.
  assert.deepEqual(
    pickAllForForm(rows, "AP-1", keyOf).map((r) => r.v),
    ["default-540100", "default-540200"],
  );
});

test("a key that only another form defines is dropped, not leaked", () => {
  const rows = [
    { key: "PCTH 540100", formCode: "AP-4", v: "ap4-only" },
    { key: "PCTH 540200", formCode: null, v: "shared" },
  ];
  assert.deepEqual(
    pickAllForForm(rows, "AP-1", keyOf).map((r) => r.v),
    ["shared"],
  );
});

test("the output keeps each key's first appearance, so the SQL order survives", () => {
  const rows = [
    { key: "b", formCode: null, v: "b" },
    { key: "a", formCode: null, v: "a" },
    { key: "b", formCode: "AP-4", v: "b-override" },
  ];
  assert.deepEqual(
    pickAllForForm(rows, "AP-4", keyOf).map((r) => r.v),
    ["b-override", "a"],
  );
});

test("grouping does not depend on the override arriving first", () => {
  const ap4First = [
    { key: "k", formCode: "AP-4", v: "override" },
    { key: "k", formCode: null, v: "default" },
  ];
  const defaultFirst = [ap4First[1], ap4First[0]];
  assert.equal(pickAllForForm(ap4First, "AP-4", keyOf)[0].v, "override");
  assert.equal(pickAllForForm(defaultFirst, "AP-4", keyOf)[0].v, "override");
});

test("an empty list yields an empty list", () => {
  assert.deepEqual(pickAllForForm([] as { key: string; formCode: string | null }[], "AP-1", keyOf), []);
});

// --- perFormWriteMatch: the bound on an UPDATE or DELETE -------------------

test("the default is matched with IS NULL, because = never matches NULL", () => {
  assert.equal(perFormWriteMatch(null), "FormCode IS NULL");
  assert.equal(perFormWriteMatch(null, "t"), "t.FormCode IS NULL");
});

test("a named form is matched by equality, and is never the unbounded form", () => {
  assert.equal(perFormWriteMatch("AP-4"), "FormCode = @formCode");
  assert.equal(perFormWriteMatch("AP-4", "t"), "t.FormCode = @formCode");
  // A write bound must never widen to the read predicate: that would let one
  // statement sweep the default and every override for the brand together.
  assert.equal(perFormWriteMatch("AP-4").indexOf(" OR "), -1);
  assert.equal(perFormWriteMatch(null).indexOf(" OR "), -1);
});
