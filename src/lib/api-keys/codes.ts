/**
 * The shared vocabulary of API-key codes.
 *
 * **Imports nothing** — deliberately. The settings page is a client component,
 * and pulling these off `test-connection.ts` dragged the whole server chain
 * (`service.ts` → `db/mssql` → `next/headers`) into the browser bundle and
 * broke the build. Anything both halves need to agree on lives here.
 */

/** Codes with a connection tester. Others are stored and served, just not testable. */
export const TESTABLE_CODES = ["ANTHROPIC_API_KEY", "GOOGLE_MAPS_API_KEY", "ORS_API_KEY"];

/**
 * What each code is used for, for the settings list — so somebody can see, before
 * deactivating a key, what would stop working. A code that is not here still
 * resolves and serves exactly the same; this is a label, not a registry.
 */
export const KNOWN_CODE_USAGE: Record<string, string> = {
  ANTHROPIC_API_KEY: "AP-1 อ่านยอดใบเสร็จ · AP-17 ตรวจบัตรประชาชน · AP-3 อ่านใบเสร็จเคลียร์",
  GOOGLE_MAPS_API_KEY: "AP-1 แผนที่และระยะทาง",
  ORS_API_KEY: "AP-1 ค้นหาสถานที่ · AP-17 จุดขึ้นรถ",
};

/**
 * The Name an import gives a key — the product, not what it is used for.
 * Importing seeded Name from the usage text at first, which printed the same
 * sentence twice in one row.
 */
export const IMPORT_NAMES: Record<string, string> = {
  ANTHROPIC_API_KEY: "Anthropic",
  GOOGLE_MAPS_API_KEY: "Google Maps",
  ORS_API_KEY: "OpenRouteService",
};

/** Longest a CODE may be — `ApiKey.Code` is `nvarchar(64)` (migration 116). */
export const API_KEY_CODE_MAX = 64;

/** Longest a Name may be — `ApiKey.Name` is `nvarchar(200)`. */
export const API_KEY_NAME_MAX = 200;

/**
 * The one CODE normaliser, shared by the dialog and the service.
 *
 * It lived in `service.ts` while the dialog retyped its regex inline — two
 * copies of one rule, which is exactly the drift this file exists to prevent,
 * and it left the rule untestable besides: anything reachable from
 * `service.ts` drags `@/env` into the test run.
 *
 * It **coerces rather than rejects**, deliberately: a hyphen or a space becomes
 * `_`, so `ANTHROPIC-API-KEY` and `ANTHROPIC API KEY` both land on the code the
 * person meant. `apiKeyCodeError` refuses only what coercion cannot rescue.
 */
export function normalizeApiKeyCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

/**
 * Why this CODE cannot be stored, in Thai, or null when it can.
 *
 * Takes the **raw** value and normalises it itself, so no caller can validate
 * one string and store another.
 *
 * The all-underscore rule is the one worth explaining. Because normalising
 * turns every unusable character into `_`, three spaces arrive here as `___` —
 * non-empty, the right shape, and accepted by `CK_ApiKey_CodeShape`, whose test
 * is only `LEN(Code) > 0`. Nobody means to type that, so it is refused here
 * rather than stored as a real code that then has to be lived with: CODE is
 * immutable after creation and cannot be renamed away.
 *
 * The length bound matters for a duller reason. `Code` is `nvarchar(64)`, and
 * an over-long value reaches SQL Server as a truncation error whose English
 * text is shown to the admin verbatim — the duplicate path is the only one that
 * translates a driver error.
 */
export function apiKeyCodeError(raw: string): string | null {
  const code = normalizeApiKeyCode(raw);
  if (!code) return "กรุณากรอก CODE";
  if (code.length > API_KEY_CODE_MAX) return `CODE ยาวเกิน ${API_KEY_CODE_MAX} ตัวอักษร`;
  if (!/[A-Z0-9]/.test(code)) return "CODE ต้องมีตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว";
  return null;
}

/** Why this Name cannot be stored, in Thai, or null when it can. */
export function apiKeyNameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "กรุณากรอกชื่อ";
  if (name.length > API_KEY_NAME_MAX) return `ชื่อยาวเกิน ${API_KEY_NAME_MAX} ตัวอักษร`;
  return null;
}
