/** Google Maps libraries */
export const GOOGLE_MAPS_LIBRARIES: ("marker")[] = ["marker"];

/** Brand marker color palette */
export const BRAND_MARKER_COLORS = [
  "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed",
  "#ec4899", "#06b6d4", "#ea580c", "#84cc16", "#6366f1",
] as const;

/** Brand code → color overrides (use "c1/c2" for dual-color pins) */
export const BRAND_COLOR_OVERRIDES: Record<string, string> = {
  Rocks: "#dc2626",
  PCTH: "#16a34a/#FFEA00",
  PCMY: "#FFEA00/#16a34a",
  KSI: "#5A4118/#F6B446",
  UNO: "#dc2626/#1a1a1a",
};

export function parseBrandColor(color: string): [string, string | null] {
  const idx = color.indexOf("/");
  if (idx === -1) return [color, null];
  return [color.slice(0, idx), color.slice(idx + 1)];
}

export function getBrandColor(index: number): string {
  return BRAND_MARKER_COLORS[index % BRAND_MARKER_COLORS.length];
}

const PIN_PATH = "M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z";

export function createPinSvg(color: string): string {
  const [c1, c2] = parseBrandColor(color);
  if (c2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><defs><clipPath id="l"><rect x="0" y="0" width="14" height="40"/></clipPath><clipPath id="r"><rect x="14" y="0" width="14" height="40"/></clipPath></defs><path d="${PIN_PATH}" fill="${c1}" clip-path="url(#l)"/><path d="${PIN_PATH}" fill="${c2}" clip-path="url(#r)"/><path d="${PIN_PATH}" fill="none" stroke="white" stroke-width="1.5"/><circle cx="14" cy="13" r="5.5" fill="white"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="${PIN_PATH}" fill="${c1}" stroke="white" stroke-width="1.5"/><circle cx="14" cy="13" r="5.5" fill="white"/></svg>`;
}

/** Status badge config */
export const STORE_STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  Open: { color: "#16a34a", bg: "#16a34a14" },
  Active: { color: "#16a34a", bg: "#16a34a14" },
  Operating: { color: "#16a34a", bg: "#16a34a14" },
  Closed: { color: "#dc2626", bg: "#dc262614" },
  Inactive: { color: "#dc2626", bg: "#dc262614" },
  "Permanently Closed": { color: "#dc2626", bg: "#dc262614" },
  "Transfer Code": { color: "#dc2626", bg: "#dc262614" },
  "Temporary Closed": { color: "#f59e0b", bg: "#f59e0b14" },
  "Temporarily Closed": { color: "#f59e0b", bg: "#f59e0b14" },
  Renovating: { color: "#7c3aed", bg: "#7c3aed14" },
  "Re-Location": { color: "#7c3aed", bg: "#7c3aed14" },
  Tentative: { color: "#6366f1", bg: "#6366f114" },
  "Confirm Location": { color: "#0891b2", bg: "#0891b214" },
  "Confirm Opening date": { color: "#0891b2", bg: "#0891b214" },
};

export const STORE_TYPE_COLORS: Record<string, string> = {
  COCO: "#2563eb",
  DOCO: "#7c3aed",
  DODO: "#16a34a",
  "DODO-A": "#0d9488",
  "DODO-M": "#0891b2",
  EXPR: "#d97706",
  "Food Truck": "#ea580c",
  KSI: "#ea580c",
  LICSN: "#6366f1",
  SE: "#be185d",
};

export function getStoreTypeColor(type: string | null | undefined): string {
  if (!type) return "#64748b";
  return STORE_TYPE_COLORS[type] || "#64748b";
}

export function getStatusStyle(status: string | null) {
  if (!status) return { color: "var(--text-muted)", bg: "var(--bg-selected)" };
  return STORE_STATUS_CONFIG[status] ?? { color: "var(--text-muted)", bg: "var(--bg-selected)" };
}
