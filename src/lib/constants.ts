export type NavItem = {
  id: string;
  label: string;
  icon: string;
  desc: string;
  href: string;
  group?: string;
  groupTh?: string;
  badge?: string;
  /** Hub card only — show Soon watermark, not clickable */
  soon?: boolean;
  /** Visible only on localhost:3081 (local dev) */
  devHostOnly?: boolean;
  /** Settings hub — visible only to System Admin */
  systemAdminOnly?: boolean;
  /** Request hub — office/management variant: render the form icon with a small settings badge */
  manage?: boolean;
};

/**
 * Form Builder (`/forms`) is gone. Its entry points were removed first (this
 * tab, the Manage Forms settings card, the Home catalogue's general-forms
 * section), and the pages, the sixteen `/api/forms` routes and
 * `src/features/forms` were then deleted outright — an unused subsystem whose
 * upload, approval-claim and payload-validation paths were unauthenticated
 * enough to be worth removing rather than repairing. The `OfficeForm*` tables
 * are left in place; nothing reads them.
 */
export const NAV: NavItem[] = [
  {
    id: "my-request",
    label: "My Requests",
    icon: "Send",
    desc: "คำขอที่คุณส่งและสถานะ",
    href: "/my-request",
  },
  {
    id: "my-work",
    label: "My Work",
    icon: "ClipboardCheck",
    desc: "คำขอที่รอคุณอนุมัติหรือเกี่ยวข้อง",
    href: "/my-work",
  },
];

/**
 * Sub-cards shown on the Request hub page (/request).
 * Each represents a category of request the user can make.
 * Optional `group` / `groupTh` fields are used by the hub to render section headers.
 * Optional `badge` is displayed as a small form-code chip on the card.
 */
export const REQUEST_CARDS: NavItem[] = [
  {
    id: "travel-expense-form",
    label: "กรอกคำขอเบิกค่าเดินทาง",
    icon: "Route",
    desc: "สร้างคำขอใหม่ / ฉบับร่างของฉัน",
    href: "/request/travel-expense",
    group: "Accounting",
    groupTh: "บัญชี",
    badge: "AP-1",
  },
  {
    id: "advance-form",
    label: "กรอกคำขอเบิกเงินทดรองจ่าย",
    icon: "Wallet",
    desc: "สร้างคำขอใหม่ / ฉบับร่างของฉัน",
    href: "/request/advance",
    group: "Accounting",
    groupTh: "บัญชี",
    badge: "AP-2",
  },
  {
    id: "clear-advance-form",
    label: "เคลียร์คืนเงินทดรองจ่าย",
    icon: "ReceiptText",
    desc: "เคลียร์คืนเงินทดรองจ่ายที่เบิกไป (AP-2)",
    href: "/request/clear-advance",
    group: "Accounting",
    groupTh: "บัญชี",
    badge: "AP-3",
  },
  {
    id: "travel-expense",
    label: "เบิกค่าเดินทาง (ออฟฟิต)",
    icon: "Route",
    desc: "ฟอร์ม AP-1 · อนุมัติ · รายงาน · ตั้งค่า",
    href: "/request/accounting",
    group: "Settings",
    groupTh: "ตั้งค่า",
    badge: "AP-1",
    devHostOnly: true,
    manage: true,
  },
  {
    id: "advance",
    label: "เบิกเงินทดรองจ่าย (ออฟฟิต)",
    icon: "Wallet",
    desc: "AP-2 · รออนุมัติ · คำขอ · ตั้งค่า",
    href: "/request/advance/admin",
    group: "Settings",
    groupTh: "ตั้งค่า",
    badge: "AP-2",
    devHostOnly: true,
    manage: true,
  },
  {
    id: "clear-advance",
    label: "เคลียร์คืนเงินทดรองจ่าย (AP-3)",
    icon: "ReceiptText",
    desc: "AP-3 · รออนุมัติ · ผู้อนุมัติ · G/L · รายงาน",
    href: "/request/clear-advance/admin",
    group: "Settings",
    groupTh: "ตั้งค่า",
    badge: "AP-3",
    devHostOnly: true,
    manage: true,
  },
  {
    id: "travel-booking-form",
    label: "จองที่พัก/ตั๋วโดยสาร",
    icon: "Luggage",
    desc: "ขอจองที่พัก/ตั๋วโดยสารสำหรับไปทำงานต่างจังหวัด (หลายคำขอในครั้งเดียว)",
    href: "/request/travel-booking",
    group: "Accounting",
    groupTh: "บัญชี",
    badge: "AP-17",
  },
  {
    id: "travel-booking",
    label: "จองที่พัก/ตั๋วโดยสาร (ออฟฟิต)",
    icon: "Luggage",
    desc: "ฟอร์ม AP-17 · คิวจอง · อนุมัติ (บัญชี) · รายงาน · ตั้งค่า",
    href: "/request/accounting/travel-booking",
    group: "Settings",
    groupTh: "ตั้งค่า",
    badge: "AP-17",
    // Deliberately **not** devHostOnly, unlike its AP-1 neighbour, and it was
    // until 2026-08-27. The accounting sign-off queue used to have its own
    // card here precisely so it stayed reachable on the live host; that card
    // has moved onto this hub, which makes this the only door to it. Left
    // devHostOnly, Admin would hand requests to a queue nobody outside
    // localhost could open, and they would pile up with no visible cause.
    // Hiding this card hid a link, never data: every page behind it fetches
    // its own /access and renders "no access" for anyone the roster and the
    // admin roles do not admit.
    manage: true,
  },
  {
    id: "reimburse-settings",
    label: "ขอเบิกเงินคืนพนักงาน (ออฟฟิต)",
    icon: "Receipt",
    desc: "ฟอร์ม AP-4 · แบรนด์ · ระเบียบการจ่าย · ผู้อนุมัติบัญชี · สิทธิ์เข้าถึง",
    href: "/request/reimburse/settings",
    group: "Settings",
    groupTh: "ตั้งค่า",
    badge: "AP-4",
    // Deliberately **not** `devHostOnly`, unlike its two neighbours.
    //
    // For AP-1 and AP-17 that flag is cosmetic — their approver and brand tables
    // are populated, so hiding the card off localhost hides a page nobody needs.
    // AP-4 ships with `AccReimburseApprover` empty, so until a System Admin adds
    // somebody every claim stops dead at the ACCOUNT step, and migration 092
    // seeds `AccFormBrand` with `ROCKS`, which is not one of the four brands in
    // `src/lib/brand.ts`. Both are fixed here and nowhere else. The card was
    // hiding the one page needed to commission the form, on the only host where
    // commissioning happens, while the page itself is `requireRole`-gated
    // server-side and was therefore authorized anyway.
    manage: true,
  },
  {
    id: "reimburse-form",
    label: "ขอเบิกเงินคืนพนักงาน",
    icon: "Receipt",
    desc: "เบิกเงินที่สำรองจ่ายไปก่อน / ฉบับร่างของฉัน",
    href: "/request/reimburse",
    group: "Accounting",
    groupTh: "บัญชี",
    badge: "AP-4",
  },
];

/**
 * Sub-cards on the Settings hub (/settings) — IT Admin / System Admin only.
 *
 * The hub renders these in array order, so this order is the page. It runs
 * outward from the plumbing: the databases and Business Central connection, what
 * each brand points at, the ERP's UAT side, then the one external API key; then
 * the people — who may sign in, which forms are open in which environment, and
 * who tests them; and last the Accounting hub, which is daily operating rather
 * than configuration.
 */
export const SETTINGS_CARDS: NavItem[] = [
  {
    id: "connections",
    label: "Database Connections",
    icon: "Server",
    desc: "Manage external MSSQL servers and connection credentials",
    href: "/settings/connections",
  },
  {
    id: "bc-connections",
    label: "Business Central",
    icon: "Boxes",
    desc: "OAuth2 and API connection settings for Dynamics 365 BC",
    href: "/settings/bc-connections",
  },
  {
    id: "brand-config",
    label: "Brand Configuration",
    icon: "Layers",
    desc: "Configure BC and ERP SQL for each brand",
    href: "/settings/brand-config",
  },
  {
    id: "erp-interface",
    label: "ERP Interface Environment",
    icon: "FlaskConical",
    desc: "ตั้งค่า BC company และ connection ของฝั่ง UAT (Sandbox) — ฟอร์มไหนใช้ UAT กำหนดที่ Form Environment",
    href: "/settings/erp-interface",
    systemAdminOnly: true,
  },
  {
    id: "api-keys",
    label: "API Keys",
    icon: "KeyRound",
    desc: "Anthropic · Google Maps · OpenRouteService — วันหมดอายุและประวัติการเปลี่ยน",
    href: "/settings/api-keys",
  },
  {
    id: "users",
    label: "Users & Roles",
    icon: "Shield",
    desc: "จัดการผู้ใช้ บทบาท และการซิงก์จาก Active Directory",
    href: "/settings/users",
    systemAdminOnly: true,
  },
  {
    id: "form-environment",
    label: "Form Environment",
    icon: "FlaskConical",
    desc: "เปิด/ปิด Production และ UAT ของแต่ละฟอร์มแยกกัน",
    href: "/settings/form-environment",
    systemAdminOnly: true,
  },
  {
    id: "uat-users",
    label: "UAT Users",
    icon: "FlaskConical",
    desc: "รายชื่อผู้ทดสอบ และผู้จัดการสำหรับ UAT ของแต่ละคน",
    href: "/settings/uat-users",
    systemAdminOnly: true,
  },
  {
    id: "accounting-admin",
    label: "Accounting Admin",
    icon: "ClipboardList",
    desc: "คิวอนุมัติ รายงาน และตั้งค่าของ AP-1 / AP-4 / AP-17",
    // The Request hub narrowed to its management cards. /request/accounting is
    // AP-1's own hub and would leave out AP-17, which this card promises.
    href: "/request?group=Settings",
  },
];
