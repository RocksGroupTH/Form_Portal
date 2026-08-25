/**
 * "Does this key actually work?" for Settings → API Keys.
 *
 * Every tester takes the key **explicitly** rather than resolving one, so the
 * button checks the value on the row being looked at — including a deactivated
 * row, which `resolveApiKey` skips. A test that quietly checked a different key
 * from the one on screen would be worse than no test.
 *
 * Each call is the cheapest thing that still proves the credential:
 * `models.list` spends no tokens, and the two geocodes are single lookups.
 */
import Anthropic from "@anthropic-ai/sdk";
import { testGoogleMapsKey, GoogleMapsReferrerRestrictedError } from "@/lib/google-maps";
import { testOrsKey } from "@/lib/ors";
import { TESTABLE_CODES } from "@/lib/api-keys/codes";

export { TESTABLE_CODES };

export interface ConnectionTestResult {
  ok: boolean;
  /** Thai, shown as-is. */
  message: string;
}

/** How long to wait before calling it a failure. */
const TEST_TIMEOUT_MS = 15_000;

async function testAnthropic(key: string): Promise<ConnectionTestResult> {
  const client = new Anthropic({ apiKey: key, timeout: TEST_TIMEOUT_MS, maxRetries: 0 });
  // Listing models authenticates without generating anything — a working key
  // costs nothing to prove, which matters for a button people will press twice.
  const models = await client.models.list({ limit: 1 });
  const first = models.data[0]?.id;
  return {
    ok: true,
    message: first ? `เชื่อมต่อได้ — เห็นโมเดล ${first}` : "เชื่อมต่อได้",
  };
}

async function testGoogleMaps(key: string): Promise<ConnectionTestResult> {
  try {
    const count = await testGoogleMapsKey(key);
    return { ok: true, message: `เชื่อมต่อได้ — ค้นหาเจอ ${count} ผลลัพธ์` };
  } catch (e) {
    // Not a failure: a key locked to HTTP referrers cannot be called from a
    // server at all, and refusing it here would have somebody replace a key
    // that works perfectly well in the browser.
    if (e instanceof GoogleMapsReferrerRestrictedError) {
      return {
        ok: true,
        message: "key จำกัดเฉพาะ HTTP referrer — ทดสอบจากเซิร์ฟเวอร์ไม่ได้ แต่ใช้งานในเบราว์เซอร์ได้",
      };
    }
    throw e;
  }
}

async function testOrs(key: string): Promise<ConnectionTestResult> {
  const count = await testOrsKey(key);
  return { ok: true, message: `เชื่อมต่อได้ — ค้นหาเจอ ${count} ผลลัพธ์` };
}

export async function testApiKeyConnection(code: string, key: string): Promise<ConnectionTestResult> {
  try {
    switch (code) {
      case "ANTHROPIC_API_KEY":
        return await testAnthropic(key);
      case "GOOGLE_MAPS_API_KEY":
        return await testGoogleMaps(key);
      case "ORS_API_KEY":
        return await testOrs(key);
      default:
        return { ok: false, message: `ยังไม่มีวิธีทดสอบสำหรับ CODE "${code}"` };
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // A 401 is the answer people press this button to get, so name it plainly
    // rather than passing through the provider's English sentence.
    if (/401|authentication|invalid.*key|api key/i.test(raw)) {
      return { ok: false, message: "key ใช้ไม่ได้ — ผู้ให้บริการปฏิเสธ (401)" };
    }
    return { ok: false, message: `ทดสอบไม่สำเร็จ — ${raw}` };
  }
}
