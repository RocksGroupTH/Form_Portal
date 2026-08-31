import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVINCE_NAME_MAX,
  provinceAnswered,
  resolveProvinceChoice,
  sanitizeProvinceName,
} from "./province-choice";

/**
 * ข้อ8 accepts a place from the managed list **or** one the requester types.
 *
 * The list is the better answer where it has one — an id survives a rename, and
 * the report filters on it — so a chosen id always wins. Free text exists so a
 * trip somewhere nobody has added yet is not blocked behind an admin, which is
 * what a required field with an "ask an admin" empty state amounted to.
 */

/* ── sanitising ───────────────────────────────────────────────────────── */

test("a typed name is trimmed", () => {
  assert.equal(sanitizeProvinceName("  ลอนดอน  "), "ลอนดอน");
  assert.equal(sanitizeProvinceName("London"), "London");
});

test("blank in every form becomes null", () => {
  for (const v of ["", "   ", "\t", "\n", null, undefined]) {
    assert.equal(sanitizeProvinceName(v), null, `should be null: ${JSON.stringify(v)}`);
  }
});

/**
 * `ProvinceName` is NVARCHAR(100). Truncating silently would store a clipped
 * place name that reads as a real one, so an over-long value is refused instead
 * — the caller decides what to tell the person.
 */
test("an over-long name is refused, never truncated", () => {
  const ok = "ก".repeat(PROVINCE_NAME_MAX);
  assert.equal(sanitizeProvinceName(ok), ok);
  assert.equal(sanitizeProvinceName("ก".repeat(PROVINCE_NAME_MAX + 1)), null);
});

test("inner whitespace is left alone — a place name may contain spaces", () => {
  assert.equal(sanitizeProvinceName(" New  York "), "New  York");
});

/* ── the choice ───────────────────────────────────────────────────────── */

test("an id from the list wins, and the typed text is dropped", () => {
  assert.deepEqual(resolveProvinceChoice({ provinceId: 12, provinceName: "พิมพ์เอง" }), {
    provinceId: 12,
    provinceName: null,
    kind: "listed",
  });
});

/**
 * The name is deliberately null for a listed place: the server reads it from
 * TravelProvince by id, so echoing back whatever the client had would let a
 * stale label overwrite a renamed row.
 */
test("a listed place carries no name of its own", () => {
  assert.equal(resolveProvinceChoice({ provinceId: 3, provinceName: null }).provinceName, null);
});

test("no id and a typed name is free text", () => {
  assert.deepEqual(resolveProvinceChoice({ provinceId: null, provinceName: " ลอนดอน " }), {
    provinceId: null,
    provinceName: "ลอนดอน",
    kind: "typed",
  });
});

test("neither is unanswered", () => {
  for (const v of [
    { provinceId: null, provinceName: null },
    { provinceId: null, provinceName: "   " },
    { provinceId: 0, provinceName: "" },
  ]) {
    assert.deepEqual(resolveProvinceChoice(v), {
      provinceId: null,
      provinceName: null,
      kind: "none",
    });
  }
});

/** An over-long typed name is unanswered rather than silently clipped. */
test("an over-long typed name does not become a destination", () => {
  const r = resolveProvinceChoice({
    provinceId: null,
    provinceName: "ก".repeat(PROVINCE_NAME_MAX + 1),
  });
  assert.equal(r.kind, "none");
  assert.equal(r.provinceName, null);
});

/* ── the validator's question ─────────────────────────────────────────── */

test("answered means either an id or a name", () => {
  assert.equal(provinceAnswered({ provinceId: 5, provinceName: null }), true);
  assert.equal(provinceAnswered({ provinceId: null, provinceName: "ลอนดอน" }), true);
  assert.equal(provinceAnswered({ provinceId: null, provinceName: null }), false);
  assert.equal(provinceAnswered({ provinceId: null, provinceName: "  " }), false);
});

/**
 * `provinceAnswered` and `resolveProvinceChoice` must never disagree: the client
 * gates submit on one and the server stores the other, and a gap between them is
 * a request that passes validation and stores no destination.
 */
test("answered is exactly 'the choice resolves to something'", () => {
  const cases = [
    { provinceId: 12, provinceName: "x" },
    { provinceId: null, provinceName: "ลอนดอน" },
    { provinceId: null, provinceName: null },
    { provinceId: null, provinceName: "   " },
    { provinceId: 0, provinceName: "" },
    { provinceId: null, provinceName: "ก".repeat(PROVINCE_NAME_MAX + 1) },
  ];
  for (const c of cases) {
    assert.equal(
      provinceAnswered(c),
      resolveProvinceChoice(c).kind !== "none",
      `disagreed on ${JSON.stringify(c).slice(0, 60)}`,
    );
  }
});
