"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Info, X } from "lucide-react";
import { BackButton } from "@/components/layout/BackButton";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { useReportFilters } from "@/features/intelligence/hooks/useReportFilters";
import { ReportLoading } from "@/features/intelligence/components/ReportLoading";
import { ReportKpiBar } from "@/features/intelligence/components/ReportKpiBar";
import { ReportEmptyState } from "@/features/intelligence/components/ReportEmptyState";
import { DataTable } from "@/features/intelligence/components/DataTable";
import { QuickDateFilter } from "@/features/intelligence/components/QuickDateFilter";
import { type ColumnDef } from "@tanstack/react-table";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const fmtBaht = (n: number) =>
  (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRevenue = (n: number) => <span style={{ color: "#2563eb" }}>{fmtBaht(n)}</span>;
const fmtCost = (n: number) => <span style={{ color: "#dc2626" }}>{fmtBaht(n)}</span>;
const fmtNum = (n: number) => (n ?? 0).toLocaleString();


interface Row {
  date: string;
  time: string;
  receiptNo: string;
  branchName: string;
  menuName: string;
  category: string;
  quantity: number;
  price: number;
  amount: number;
  discount: number;
  paymentType: string;
  orderType: string;
  channel: string;
}

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "date", header: "Date", enableGrouping: true },
  { accessorKey: "time", header: "Time", enableGrouping: false },
  { accessorKey: "receiptNo", header: "Receipt", enableGrouping: true },
  { accessorKey: "branchName", header: "Branch", enableGrouping: true },
  { accessorKey: "menuName", header: "Menu", enableGrouping: true },
  { accessorKey: "category", header: "Category", enableGrouping: true },
  {
    accessorKey: "quantity",
    header: "Qty",
    cell: ({ getValue }) => (getValue() as number ?? 0).toLocaleString(),
    aggregatedCell: ({ getValue }) => <strong>{(getValue() as number ?? 0).toLocaleString()}</strong>,
    aggregationFn: "sum",
    enableGrouping: false,
  },
  {
    accessorKey: "price",
    header: "Price",
    cell: ({ getValue }) => fmtBaht(getValue() as number),
    aggregatedCell: ({ row }) => {
      const leaves = row.getLeafRows();
      const totalAmt = leaves.reduce((s, r) => s + ((r.original as Row).amount ?? 0), 0);
      const totalQty = leaves.reduce((s, r) => s + ((r.original as Row).quantity ?? 0), 0);
      return <strong>{fmtBaht(totalQty > 0 ? totalAmt / totalQty : 0)}</strong>;
    },
    aggregationFn: () => 0,
    enableGrouping: false,
  },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ getValue }) => fmtRevenue(getValue() as number),
    aggregatedCell: ({ getValue }) => <strong>{fmtRevenue(getValue() as number)}</strong>,
    aggregationFn: "sum",
    enableGrouping: false,
  },
  {
    accessorKey: "discount",
    header: "Discount",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v ? fmtCost(v) : "—";
    },
    aggregatedCell: ({ getValue }) => <strong>{fmtCost(getValue() as number)}</strong>,
    aggregationFn: "sum",
    enableGrouping: false,
  },
  { accessorKey: "paymentType", header: "Payment", enableGrouping: true },
  { accessorKey: "orderType", header: "Order Type", enableGrouping: true },
  { accessorKey: "channel", header: "Channel", enableGrouping: true },
];

export default function TransactionReportPage() {
  return <Suspense><TransactionContent /></Suspense>;
}

function TransactionContent() {
  const searchParams = useSearchParams();
  const [brand] = useState(searchParams.get("brand") ?? "UNO");
  const { from, to, branch, setFrom, setTo, setBranch } = useReportFilters("transaction");

  const params = new URLSearchParams({ brand, from, to });
  if (branch) params.set("branch", branch);

  const { data, isLoading } = useSWR<{ ok: boolean; data: Row[] }>(
    `/api/intelligence/reports/transaction?${params}`,
    fetcher,
  );

  const rows = data?.data ?? [];
  const branches = useBranches(brand);
  const branchLabel = branch ? branches.find((b) => b.branchId === branch)?.branchName : "";

  const kpis = useMemo(() => {
    if (rows.length === 0) return [];
    const revenue = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const discount = rows.reduce((s, r) => s + (r.discount ?? 0), 0);
    const receipts = new Set(rows.map((r) => r.receiptNo)).size;
    const items = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    return [
      { label: "Revenue", value: fmtBaht(revenue), color: "#2563eb" },
      { label: "Discount", value: fmtBaht(discount), color: "#dc2626" },
      { label: "Receipts", value: fmtNum(receipts) },
      { label: "Items", value: fmtNum(items) },
    ];
  }, [rows]);

  return (
    <PageContainer className="py-3 px-3 sm:px-0 flex-1 flex flex-col min-h-0" maxWidth="2k">
      {/* Row 1: Title + KPIs */}
      <PageHeaderCard className="flex items-center gap-2 flex-wrap mb-3">
        <BackButton href={`/intelligence?brand=${brand}`} />
        <h1 className="text-[20px] sm:text-[22px] font-bold" style={{ color: "var(--text-heading)" }}>
          Transaction Report
        </h1>
        <span className="relative group">
          <Info size={14} style={{ color: "var(--text-faint)", cursor: "help" }} />
          <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2.5 py-1.5 rounded-lg text-[10px] font-normal whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-40" style={{ background: "var(--bg-dropdown)", color: "var(--text-muted)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
            Bill-level detail — receipt, items, amount, payment, staff &middot; Source: Foodstory POS
          </span>
        </span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
          {brand}
        </span>
        {branchLabel && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-lg" style={{ background: "var(--bg-badge)", color: "var(--text-primary)" }}>
            {branchLabel}
            <button onClick={() => setBranch("")} className="cursor-pointer bg-transparent border-none p-0 flex items-center" style={{ color: "var(--text-muted)" }}><X size={10} /></button>
          </span>
        )}
        {!isLoading && rows.length > 0 && (
          <>
            <div className="flex-1" />
            <ReportKpiBar items={kpis} />
          </>
        )}
      </PageHeaderCard>


      {/* Row 2: Filters */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <QuickDateFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div className="h-5 w-px mx-1 hidden sm:block" style={{ background: "var(--border-light)" }} />
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="rounded-lg px-2 py-1 text-[12px] outline-none"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
        >
          <option value="">All Branches</option>
          {branches.map((b) => (
            <option key={b.branchId} value={b.branchId}>{b.branchName}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <ReportLoading />
      ) : (
          <DataTable data={rows} columns={columns} groupBy={["branchName"]} reportName="Transaction" emptyState={<ReportEmptyState branch={branchLabel} from={from} to={to} />} />
      )}
    </PageContainer>
  );
}
