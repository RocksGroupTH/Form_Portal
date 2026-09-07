import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseSubjectLog,
  perDiemLogSubjectKey,
  type PerDiemLogSubject,
} from "./allowance-log-rule";
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";

const HR_LOG: AllowanceLogEntry[] = [{ effectiveDate: "2026-01-01", amount: 270 }];
const UAT_LOG: AllowanceLogEntry[] = [{ effectiveDate: "2026-01-01", amount: 800 }];

function subject(over: Partial<PerDiemLogSubject>): PerDiemLogSubject {
  return { employeeId: "emp-1", staffId: 100, uat: false, ...over };
}

test("uat false with an HR log resolves to HR, even when an override happens to exist", () => {
  const overrides = new Map([[100, UAT_LOG]]);
  const hrLogs = new Map([["emp-1", HR_LOG]]);
  const result = chooseSubjectLog(subject({ uat: false }), overrides, hrLogs);
  assert.deepEqual(result, { log: HR_LOG, source: "hr" });
});

test("uat true with an override present resolves to the override, not HR", () => {
  const overrides = new Map([[100, UAT_LOG]]);
  const hrLogs = new Map([["emp-1", HR_LOG]]);
  const result = chooseSubjectLog(subject({ uat: true }), overrides, hrLogs);
  assert.deepEqual(result, { log: UAT_LOG, source: "uat" });
});

test("uat true with no override but an HR log falls back to HR", () => {
  const overrides = new Map<number, AllowanceLogEntry[]>();
  const hrLogs = new Map([["emp-1", HR_LOG]]);
  const result = chooseSubjectLog(subject({ uat: true }), overrides, hrLogs);
  assert.deepEqual(result, { log: HR_LOG, source: "hr" });
});

test("uat true with a null staffId cannot be looked up in overrides and falls back to HR", () => {
  const overrides = new Map([[100, UAT_LOG]]); // present under a DIFFERENT key — must not match by accident
  const hrLogs = new Map([["emp-1", HR_LOG]]);
  const result = chooseSubjectLog(subject({ uat: true, staffId: null }), overrides, hrLogs);
  assert.deepEqual(result, { log: HR_LOG, source: "hr" });
});

test("a null employeeId with no override answers { log: [], source: 'hr' }, never a throw", () => {
  const overrides = new Map<number, AllowanceLogEntry[]>();
  const hrLogs = new Map<string, AllowanceLogEntry[]>();
  assert.doesNotThrow(() => {
    const result = chooseSubjectLog(
      subject({ uat: true, staffId: null, employeeId: null }),
      overrides,
      hrLogs,
    );
    assert.deepEqual(result, { log: [], source: "hr" });
  });
});

test("a null employeeId with no HR entry for it also answers the empty HR log, not a throw", () => {
  const overrides = new Map<number, AllowanceLogEntry[]>();
  const hrLogs = new Map<string, AllowanceLogEntry[]>();
  const result = chooseSubjectLog(subject({ uat: false, employeeId: null }), overrides, hrLogs);
  assert.deepEqual(result, { log: [], source: "hr" });
});

test("two subjects differing only in uat produce different keys", () => {
  const prod = perDiemLogSubjectKey(subject({ uat: false }));
  const uat = perDiemLogSubjectKey(subject({ uat: true }));
  assert.notEqual(prod, uat);
});
