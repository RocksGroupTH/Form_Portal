/**
 * "Where do I get this key?" — one short manual per code, shown on the row in
 * Settings → API Keys.
 *
 * **Data, not JSX**, and this file imports nothing: adding a provider means
 * adding an entry here, and the settings page is a client component that must
 * not pull a server module into the browser bundle (see `./codes.ts`).
 * Formatting is the three inline forms `./guide-text.ts` understands.
 *
 * `{origin}` is replaced at render with the site the reader is on, so the
 * Google referrer step shows the address they actually need to allow rather
 * than a placeholder they have to translate.
 */

export interface KeyGuide {
  /** Panel heading. */
  title: string;
  steps: string[];
  /** Cautions and gotchas — rendered under the steps, quieter. */
  notes?: string[];
}

export const KEY_GUIDES: Record<string, KeyGuide> = {
  ANTHROPIC_API_KEY: {
    title: "วิธีขอ Anthropic API Key",
    steps: [
      "เปิด [Anthropic Console](https://console.anthropic.com/) แล้วเข้าสู่ระบบด้วยบัญชีขององค์กร",
      "ไปที่ **Settings → API keys** → กด **Create key**",
      "ตั้งชื่อให้รู้ว่าใช้ที่ไหน เช่น `Form Portal — production`",
      "คัดลอกค่าที่ขึ้นมา **ทันที** — ปิดหน้าต่างแล้วเปิดดูซ้ำไม่ได้ ต้องออก key ใหม่",
      "วางในช่อง KEY ด้านบน → **เพิ่ม key** → กด **ทดสอบการเชื่อมต่อ**",
    ],
    notes: [
      "บัญชีต้องมีเครดิตที่ **Plans & Billing** ไม่งั้นจะเรียกไม่ผ่านแม้ key ถูกต้อง",
      "ปุ่มทดสอบเรียก `models.list` ซึ่ง **ไม่เสีย token** กดซ้ำได้ไม่ต้องกังวลค่าใช้จ่าย",
      "key ขึ้นต้นด้วย `sk-ant-` ยาวราว 108 ตัวอักษร — ถ้าสั้นกว่านั้นแปลว่าคัดลอกไม่ครบ",
      "ถ้า key หมดอายุหรือถูกเพิกถอน **AP-17 จะแนบบัตรประชาชนไม่ได้ทั้งบริษัท** เพราะด่านตรวจบัตรตั้งไว้ให้ปิดตาย ส่วน AP-1 แค่กรอกยอดเอง",
    ],
  },

  GOOGLE_MAPS_API_KEY: {
    title: "วิธีตั้งค่า Google Maps API",
    steps: [
      "เปิด [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview) และเลือกโปรเจกต์ (หรือสร้างใหม่)",
      "เปิดใช้งาน APIs: **Maps JavaScript API**, **Places API (New)**, **Directions API**, **Geocoding API**",
      "ไปที่ APIs & Services → Credentials → Create credentials → **API key**",
      "จำกัด Key (แนะนำ): Application restrictions = **HTTP referrers** — เพิ่ม `{origin}/*` และ `http://localhost:3081/*` สำหรับ dev",
      "API restrictions: จำกัดเฉพาะ Maps JavaScript, Places (New), Directions, Geocoding",
      "วาง API Key ด้านบนแล้วกด **เพิ่ม key** → **ทดสอบการเชื่อมต่อ**",
    ],
    notes: [
      "**เจอ REQUEST_DENIED?** ปุ่มทดสอบเรียก Geocoding จาก server แต่ HTTP referrer อนุญาตเฉพาะ request จากเว็บ — ระบบจะรายงานว่า “จำกัดเฉพาะ referrer” และถือว่าผ่าน ไม่ต้องเปลี่ยน key",
      "ถ้ายัง error จริง ให้ตรวจ: เปิด **Billing**, เปิด **Geocoding API**, และเพิ่ม Geocoding ใน API restrictions",
      "Google Maps ต้องเปิด Billing ในโปรเจกต์ Cloud (มี free tier รายเดือน) — ดู [ราคา Google Maps Platform](https://developers.google.com/maps/billing-and-pricing/pricing)",
    ],
  },

  ORS_API_KEY: {
    title: "วิธีขอ OpenRouteService Key",
    steps: [
      "เปิด [OpenRouteService — สมัคร/เข้าสู่ระบบ](https://openrouteservice.org/dev/#/signup)",
      "ยืนยันอีเมลแล้วไปที่ **Dashboard → Tokens**",
      "ขอ token แผน **Free** แล้วตั้งชื่อ เช่น `Form Portal`",
      "คัดลอก token → วางในช่อง KEY ด้านบน → **เพิ่ม key** → **ทดสอบการเชื่อมต่อ**",
    ],
    notes: [
      "แผนฟรีจำกัดโควตาต่อวันและต่อนาที — ถ้าค้นหาสถานที่แล้วไม่ขึ้นผลลัพธ์ ให้ดูโควตาใน Dashboard ก่อนสงสัยว่า key เสีย",
      "ใช้กับ AP-1 (ค้นหาสถานที่และระยะทาง) และ AP-17 (จุดขึ้นรถ/ขึ้นเครื่อง)",
    ],
  },
};

/** Substitute `{origin}` with the address the reader is actually on. */
export function applyGuideOrigin(text: string, origin: string): string {
  return text.split("{origin}").join(origin);
}
