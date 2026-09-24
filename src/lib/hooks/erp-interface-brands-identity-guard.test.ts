import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **`useErpInterfaceBrands` must not hand back a fresh array when it has no
 * data.**
 *
 * `return { brands: data ?? [] }` allocates on every render while the fetch is
 * in flight — and for ever if it fails. Thirteen call sites put that value in a
 * dependency array; in `ApproverInterfaceBrandTable` it reaches an effect that
 * calls `setChecked`, so each render produced a new array, which reran the
 * effect, which set state, which rendered. AP-1's สิทธิ์เข้าถึง tab threw
 * *"Maximum update depth exceeded"* on every load until 2026-09-24.
 *
 * **This is a source pin and it is the only layer available.** The hook is
 * `"use client"` and reaches SWR, so no test here can render it; the defect is
 * invisible to `tsc` (both spellings have the identical type) and invisible to
 * every behavioural test, because the loop needs React. What a reader can be
 * told is: the empty answer is one module-level value, and the identity
 * guarantee that `ERP_INTERFACE_BRANDS` used to give away for free — it was a
 * module constant — has to be written by hand now that a hook replaced it.
 *
 * It does **not** prove the other thirteen consumers are safe. It proves the
 * one thing they all rest on.
 */

const SRC = path.resolve(process.cwd(), "src/lib/hooks/useErpInterfaceBrands.ts");

function code(): string {
  return fs
    .readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the empty answer is a module-level constant, not a literal", () => {
  const src = code();
  const decl = /^const\s+(\w+)\s*:\s*ErpInterfaceBrandOption\[\]\s*=\s*\[\];/m.exec(src);
  assert.ok(decl, "expected a module-level `const X: ErpInterfaceBrandOption[] = [];`");
  assert.ok(
    new RegExp(`Object\\.freeze\\(${decl[1]}\\)`).test(src),
    `${decl[1]} must be frozen — it is shared by every caller and every render, so one push reaches all of them`,
  );
});

test("the hook returns that constant and never a fresh array", () => {
  const src = code();
  const ret = /return\s*\{\s*brands:\s*data\s*\?\?\s*([^,]+),/.exec(src);
  assert.ok(ret, "expected `return { brands: data ?? …, …}`");
  const fallback = ret[1].trim();
  assert.notEqual(
    fallback,
    "[]",
    "`data ?? []` allocates per render and loops ApproverInterfaceBrandTable's effect — use the module constant",
  );
  assert.match(fallback, /^[A-Z_][A-Z0-9_]*$/, `expected a module constant, found ${fallback}`);
});
