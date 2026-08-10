export const C = {
  navy: "#1A0608",
  navyLight: "#2D0C0E",
  red: "#e74c3c",
  blue: "#3498db",
  green: "#27ae60",
  teal: "#16a085",
  purple: "#8e44ad",
  orange: "#f39c12",
  dark: "#2c2c2c",
  muted: "#888888",
  light: "#fdf5f5",
  white: "#ffffff",
  border: "#ead9d9",
} as const;

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
  /** Visible only on localhost:3021 (local dev) */
  devHostOnly?: boolean;
  /** Settings hub — visible only to System Admin */
  systemAdminOnly?: boolean;
  /** Request hub — office/management variant: render the form icon with a small settings badge */
  manage?: boolean;
};

export const NAV: NavItem[] = [
  {
    id: "forms",
    label: "Forms",
    icon: "FileText",
    desc: "ฟอร์มทั้งหมดและคำขอที่ส่งได้",
    href: "/forms",
  },
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
    desc: "ฟอร์ม AP-17 · คิวจอง · รายงาน · ตั้งค่า",
    href: "/request/accounting/travel-booking",
    group: "Settings",
    groupTh: "ตั้งค่า",
    badge: "AP-17",
    devHostOnly: true,
    manage: true,
  },
];

/** Sub-cards on the Settings hub (/settings) — IT Admin / System Admin only */
export const SETTINGS_CARDS: NavItem[] = [
  {
    id: "maps",
    label: "Maps & Routing",
    icon: "Map",
    desc: "Google Maps API Key (AP-1 · ฟอร์ม)",
    href: "/settings/maps",
  },
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
    desc: "Production / UAT (Sandbox) toggle for Business Central Interface",
    href: "/settings/erp-interface",
    systemAdminOnly: true,
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
    id: "manage-forms",
    label: "Manage Forms",
    icon: "FileText",
    desc: "สร้างและแก้ไขฟอร์ม พร้อมตั้งค่าลำดับการอนุมัติ",
    href: "/forms/admin",
  },
  {
    id: "accounting-admin",
    label: "Accounting Admin",
    icon: "ClipboardList",
    desc: "คิวอนุมัติ รายงาน และตั้งค่าของ AP-1 / AP-17",
    href: "/request/accounting",
  },
];
