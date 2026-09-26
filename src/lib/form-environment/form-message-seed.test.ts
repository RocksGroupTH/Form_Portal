import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFormMessage, FORM_OWNER_TOKEN } from "./form-message-text";
import { AP1_HEADER_MESSAGE_LINES } from "@/features/accounting/constants";
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";

const SQL = readFileSync("migrations/164_core_form_message.sql", "utf8").replace(/\r\n?/g, "\n");

test("164 seeds AP-17 as its constant, blank-line joined", () => {
  assert.ok(SQL.includes(Array.from(AP17_HEADER_MESSAGE_LINES).join("\n\n")));
});

test("164's AP-1 seed opens with the three existing header lines", () => {
  assert.ok(SQL.includes(Array.from(AP1_HEADER_MESSAGE_LINES).join("\n\n")));
});

test("164's AP-1 seed carries the owner token as its last bullet", () => {
  assert.ok(SQL.includes(`กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ${FORM_OWNER_TOKEN}`));
});

test("no paste placeholder was left in the migration", () => {
  assert.ok(!/<<<|>>>/.test(SQL), "migration 164 still contains a <<<PASTE …>>> marker");
});

test("164 does not seed AP-2 or AP-3 — an absent row means 'use the constant'", () => {
  assert.ok(!SQL.includes("N'AP-2'"));
  assert.ok(!SQL.includes("N'AP-3'"));
});
