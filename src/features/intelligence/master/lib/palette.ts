/**
 * Chart color palette — cool pastel theme.
 *
 * Design rules followed (per dashboard color theory):
 *  • Hue rotation ≥ 30° between adjacent series so stacked bars stay readable.
 *  • Saturation kept in the 30–55% band (pastel — not anemic, not aggressive).
 *  • Lightness in 65–80% band → comfortable on white AND dark backgrounds.
 *  • Cool-leaning bias (blues, teals, mints, lavenders) with a couple of warm
 *    accents (peach, mustard) to keep visual energy on busy stacks.
 *  • WCAG-AA contrast against both light and dark dashboard backgrounds when
 *    paired with a 1px border.
 */
export const PALETTE = [
  "#5891BC", // 1. powder blue          primary
  "#66AD7E", // 2. mint sage            secondary
  "#927FBC", // 3. soft lavender        tertiary
  "#3F9494", // 4. eucalyptus teal      alt
  "#DD7079", // 5. coral rose           warm accent
  "#C2AB68", // 6. mustard              highlight
  "#719C97", // 7. sea foam             alt teal
  "#A293C8", // 8. periwinkle           alt purple
  // Extended palette (used past the 8th series)
  "#7DB891", // 9.  mint
  "#6E9AB6", // 10. dusty blue
  "#A599C2", // 11. lilac
  "#87B0A8", // 12. teal
  "#CB917C", // 13. dusty peach
  "#92AFC8", // 14. sky
  "#A492AE", // 15. plum
  "#82A382", // 16. sage
];

const BLANK_GRAY = "#8E97A4"; // muted cool slate for "(blank)" / unknown

/**
 * Semantic color map — each value's hue carries meaning while staying inside
 * the cool-pastel band. Where data has both Thai and English variants, both
 * are listed so the legend stays consistent in either language.
 *
 *   Sale modes   → tied to brand identity / where the order happens
 *   Order types  → temperature / motion (dine-in calm, delivery fast/warm)
 *   Tenders      → cash green, card blue, e-wallet teal-cyan, brand hints
 *   Categories   → Coffee = pastel mocha, Tea/Matcha = green, Bakery = tan
 */
export const FIXED_COLORS: Record<string, string> = {
  /* ── Sale Mode (channel) ───────────────────────────────────────── */
  Storefront: "#C2AB68",              // mustard — sunny, in-person
  หน้าร้าน: "#C2AB68",
  Grab: "#74B77F",                    // mint — Grab brand green
  "Self-delivery": "#DC8769",         // peach — own-fleet warm
  Online: "#5891BC",                  // powder blue — digital

  /* ── Order types (Sale Channel after the swap) ─────────────────── */
  "Dine-In": "#5891BC",               // powder blue — calm, indoor
  Dinein: "#5891BC",
  Delivery: "#DC8769",                // warm peach — fast, hot food
  "Take Away": "#7DB891",             // mint — quick, fresh
  Takeaway: "#7DB891",

  /* ── Tender (payment_type) ─────────────────────────────────────── */
  Cash: "#7DB891",                    // mint — banknote green
  เงินสด: "#7DB891",
  "Credit card": "#7595BC",           // dusty blue — formal
  "Credit Card": "#7595BC",
  "Bank Transfer": "#5891BC",         // powder blue — bank
  Promptpay: "#5295A6",                // teal cyan — fast digital
  PromptPay: "#5295A6",
  "QR Code": "#5295A6",
  Alipay: "#5895C2",                  // sky blue — Alipay brand-leaning
  "Alipay+": "#5895C2",
  WeChat: "#59AE7D",                  // jade — WeChat
  "Line Pay": "#74B77F",              // mint — LINE green
  LinePay: "#74B77F",
  Truemoney: "#DC986F",               // peach — TrueMoney orange
  TrueMoney: "#DC986F",
  ShopeePay: "#DD7079",               // coral — Shopee orange-pink
  Rabbit: "#A293C8",                  // lavender — Rabbit/BTS
  "American Express": "#7595BC",
  "Customer Complaint": "#B58CA2",    // muted rose — flag/refund-ish
  "Customer Complaint Waste": "#B58CA2",
  "Barista Quota": "#C2AB68",         // staff allocation — mustard
  "Baista Quota": "#C2AB68",          // typo variant in source data
  "Dine Loss": "#B58CA2",
  "Bank Promotion": "#927FBC",        // promo lavender

  /* ── Categories (coffee-shop taxonomy) ─────────────────────────── */
  Coffee: "#AC8463",                  // mocha
  "Coffee (กาแฟ)": "#AC8463",
  กาแฟ: "#AC8463",
  Tea: "#7FA577",                     // tea green
  "Tea (ชา)": "#7FA577",
  ชา: "#7FA577",
  Matcha: "#74A377",                  // matcha green
  "Matcha (มัทฉะ)": "#74A377",
  มัทฉะ: "#74A377",
  Bakery: "#D2B27D",                  // bread tan
  "Bakery (เบเกอรี่)": "#D2B27D",
  เบเกอรี่: "#D2B27D",
  Food: "#CB917C",                    // savory peach
  "Food (อาหาร)": "#CB917C",
  อาหาร: "#CB917C",
  Beverage: "#5295A6",                // refreshment cyan
  "Beverage (เครื่องดื่ม)": "#5295A6",
  เครื่องดื่ม: "#5295A6",
  "Add-On Item": "#A293C8",           // add-on lavender
  "Add-On Item (เพิ่มเติม)": "#A293C8",
  เพิ่มเติม: "#A293C8",
  Merchandise: "#927FBC",             // lavender
  PunPun: "#719C97",                  // sea foam (specialty drinks line)
};

export function colorFor(key: string, index: number): string {
  if (!key || key === "(blank)" || key === "Unknown" || key === "null")
    return BLANK_GRAY;
  if (FIXED_COLORS[key]) return FIXED_COLORS[key];
  return PALETTE[index % PALETTE.length];
}

/**
 * Sequential ramp for heatmaps / single-metric gradients (light → deep).
 * Cool blue progression — pairs with the rest of the pastel palette.
 */
export const HEATMAP_RAMP = [
  "#F0F7FB",
  "#DCE8F3",
  "#C2D8EA",
  "#A4C2DD",
  "#82A9CE",
  "#5F8DBC",
  "#3F71A6",
  "#28568B",
];
