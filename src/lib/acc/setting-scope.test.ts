import { test } from "node:test";
import assert from "node:assert/strict";
import { isEnvironmentSpecificSettingKey } from "./setting-scope";
import { idCardReuseConsentKey } from "@/features/travel-booking/constants";

test("ERP_INTERFACE_ENV keeps its exact-match behaviour", () => {
  assert.equal(isEnvironmentSpecificSettingKey("ERP_INTERFACE_ENV"), true);
  // Exact, not a prefix: a differently-named key must not inherit the exclusion.
  assert.equal(isEnvironmentSpecificSettingKey("ERP_INTERFACE_ENVIRONMENT"), false);
  assert.equal(isEnvironmentSpecificSettingKey("ERP_INTERFACE_ENV.AP1"), false);
  assert.equal(isEnvironmentSpecificSettingKey("erp_interface_env"), false);
});

test("every AP-17 ID-card reuse consent key is per-database", () => {
  // The real key builder, so a rename of either side breaks this test rather
  // than silently re-enabling the dual-write.
  assert.equal(isEnvironmentSpecificSettingKey(idCardReuseConsentKey(12345)), true);
  assert.equal(isEnvironmentSpecificSettingKey(idCardReuseConsentKey(1)), true);
  assert.equal(isEnvironmentSpecificSettingKey("ap17.idcard.reuse.900001"), true);
});

test("a near miss on the consent prefix is still shared configuration", () => {
  assert.equal(isEnvironmentSpecificSettingKey("ap17.idcard.reuse"), false);
  assert.equal(isEnvironmentSpecificSettingKey("ap17.idcard"), false);
  assert.equal(isEnvironmentSpecificSettingKey("AP17.IDCARD.REUSE.1"), false);
  assert.equal(isEnvironmentSpecificSettingKey("x.ap17.idcard.reuse.1"), false);
});

test("ordinary settings are still dual-written", () => {
  assert.equal(isEnvironmentSpecificSettingKey("ap17.perdiem.default"), false);
  assert.equal(isEnvironmentSpecificSettingKey("SOME_SHARED_KEY"), false);
  assert.equal(isEnvironmentSpecificSettingKey(""), false);
});
