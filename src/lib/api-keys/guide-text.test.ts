import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGuideText } from "./guide-text";

test("plain text is one token", () => {
  assert.deepEqual(parseGuideText("เปิดหน้า Console"), [
    { kind: "text", text: "เปิดหน้า Console" },
  ]);
});

test("backticks become code", () => {
  assert.deepEqual(parseGuideText("ขึ้นต้นด้วย `sk-ant-`"), [
    { kind: "text", text: "ขึ้นต้นด้วย " },
    { kind: "code", text: "sk-ant-" },
  ]);
});

test("double asterisks become bold", () => {
  assert.deepEqual(parseGuideText("ไปที่ **Create key** ต่อ"), [
    { kind: "text", text: "ไปที่ " },
    { kind: "bold", text: "Create key" },
    { kind: "text", text: " ต่อ" },
  ]);
});

test("bracket-paren becomes a link", () => {
  assert.deepEqual(parseGuideText("เปิด [Console](https://x.dev/) แล้ว"), [
    { kind: "text", text: "เปิด " },
    { kind: "link", text: "Console", href: "https://x.dev/" },
    { kind: "text", text: " แล้ว" },
  ]);
});

test("several kinds in one line keep their order", () => {
  assert.deepEqual(parseGuideText("**A** then `b` then [c](https://d.io)"), [
    { kind: "bold", text: "A" },
    { kind: "text", text: " then " },
    { kind: "code", text: "b" },
    { kind: "text", text: " then " },
    { kind: "link", text: "c", href: "https://d.io" },
  ]);
});

test("an unclosed marker stays literal rather than eating the rest of the line", () => {
  // Swallowing the tail would silently hide a step from the person reading it.
  assert.deepEqual(parseGuideText("ใส่ `sk-ant แล้วกดบันทึก"), [
    { kind: "text", text: "ใส่ `sk-ant แล้วกดบันทึก" },
  ]);
  assert.deepEqual(parseGuideText("กด **บันทึก"), [
    { kind: "text", text: "กด **บันทึก" },
  ]);
});

test("a link with no url stays literal", () => {
  assert.deepEqual(parseGuideText("ดู [ที่นี่] ต่อ"), [
    { kind: "text", text: "ดู [ที่นี่] ต่อ" },
  ]);
});

test("empty markers produce nothing surprising", () => {
  assert.deepEqual(parseGuideText(""), []);
  assert.deepEqual(parseGuideText("``"), [{ kind: "code", text: "" }]);
});

test("only http and https links are honoured", () => {
  // A guide is rendered as-is; a javascript: URL must never become an anchor.
  assert.deepEqual(parseGuideText("[x](javascript:alert(1))"), [
    { kind: "text", text: "[x](javascript:alert(1))" },
  ]);
});
