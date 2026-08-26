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
