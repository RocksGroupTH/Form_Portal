export type ViewKey =
  | "Sale Channel"
  | "Sale Mode"
  | "Tender"
  | "Hourly"
  | "Category"
  | "Menu Name"
  | "Ticket Count"
  | "Ticket Average";

export type ColorByKey =
  | "channel"
  | "order_type"
  | "payment_type"
  | "hour"
  | "category"
  | "menu_name";

/** Y-axis metric the main chart plots.
 *   netSales    → SUM(NetSalse)              (THB)
 *   ticketCount → COUNT(DISTINCT unique_order_code) (integer tickets)
 *   ticketAvg   → SUM(NetSalse)/COUNT(DISTINCT unique_order_code) (THB / ticket) */
export type MetricKey = "netSales" | "ticketCount" | "ticketAvg";

export const VIEW_TO_COLORBY: Record<ViewKey, ColorByKey> = {
  // Label semantics swapped per user request:
  //   "Sale Channel" now displays order_type (Dine-In / Take Away / Delivery)
  //   "Sale Mode"    now displays channel    (Storefront / Grab / …)
  "Sale Channel": "order_type",
  "Sale Mode": "channel",
  Tender: "payment_type",
  Hourly: "hour",
  Category: "category",
  "Menu Name": "menu_name",
  // Ticket Count + Ticket Average both stack by `channel`.
  "Ticket Count": "channel",
  "Ticket Average": "channel",
};

export const VIEW_TO_METRIC: Record<ViewKey, MetricKey> = {
  "Sale Channel": "netSales",
  "Sale Mode": "netSales",
  Tender: "netSales",
  Hourly: "netSales",
  Category: "netSales",
  "Menu Name": "netSales",
  "Ticket Count": "ticketCount",
  "Ticket Average": "ticketAvg",
};

export type FilterKey =
  | "ym"
  | "branch_id"
  | "branch_name"
  | "category"
  | "channel"
  | "menu_code"
  | "menu_name"
  | "order_type"
  | "payment_type"
  | "void_flag"
  | "is_revenue";

export const FILTER_KEYS: FilterKey[] = [
  "ym",
  "branch_id",
  "branch_name",
  "category",
  "channel",
  "menu_code",
  "menu_name",
  "order_type",
  "payment_type",
  "void_flag",
  "is_revenue",
];

export type Filters = Partial<Record<FilterKey, string[]>>;

export interface KpiRow {
  ym: string;
  netSales: number;
  avgTicket: number;
  ads: number;
  ticketCount: number;
  momPct: number | null;
}

export interface TicketBySaleTypeRow {
  ym: string;
  order_type: string;
  ticketCount: number;
  avgPerTicket: number;
}

export interface ModeProportionRow {
  ym: string;
  order_type: string;
  share: number;
}

export interface HourlyRow {
  hour: number;
  netSales: number;
  ads: number;
}

export interface SalesByRow {
  day: string;
  dim: string;
  netSales: number;
}

export interface ByStoreRow {
  branch_name: string;
  order_type: string;
  netSales: number;
}

export interface AdsTrendRow {
  branch_name: string;
  ym: string;
  ads: number;
}
