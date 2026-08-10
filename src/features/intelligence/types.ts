/* ── Daily Sales ── */

export interface DailySalesRow {
  date: string;
  revenue: number;
  billCount: number;
  itemCount: number;
  avgTicket: number;
}

export interface ChannelRow {
  channel: string;
  revenue: number;
  bills: number;
}

export interface DailySalesData {
  daily: (DailySalesRow & Record<string, number>)[];
  channels: ChannelRow[];
  channelNames: string[];
  kpi: {
    totalRevenue: number;
    totalBills: number;
    totalItems: number;
    avgTicket: number;
    avgDailyRevenue: number;
    daysCount: number;
  };
}

/* ── Branch Performance ── */

export interface BranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  revenue: number;
  billCount: number;
  avgTicket: number;
  itemCount: number;
}

export interface BranchData {
  branches: BranchRow[];
}

/* ── Top Products ── */

export interface ProductRow {
  menuName: string;
  category: string;
  revenue: number;
  quantity: number;
  avgPrice: number;
}

export interface CategoryRow {
  category: string;
  revenue: number;
  quantity: number;
}

export interface TopProductsData {
  products: ProductRow[];
  categories: CategoryRow[];
  totalRevenue: number;
  totalQuantity: number;
}

/* ── Payment Mix ── */

export interface TenderRow {
  tenderGroup: string;
  revenue: number;
  bills: number;
}

export interface PaymentMixData {
  daily: (Record<string, number> & { date: string })[];
  tenders: TenderRow[];
  tenderNames: string[];
  kpi: {
    totalRevenue: number;
    totalBills: number;
    cashRevenue: number;
    cashPct: number;
    digitalRevenue: number;
    digitalPct: number;
    topMethod: string;
  };
}

/* ── Report Catalog ── */

export type ReportType = "tableau" | "custom";

export interface IntelReport {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  reportType: ReportType;
  tableauViewUrl: string | null;
  customRoute: string | null;
  allowedRoles: string[] | null;
  sortOrder: number;
  isFavorite?: boolean;
}
