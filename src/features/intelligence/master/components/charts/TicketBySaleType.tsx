"use client";

import { useMemo } from "react";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { TicketBySaleTypeRow } from "@/features/intelligence/master/types";
import { formatMonthYearShort, formatTHB } from "@/features/intelligence/master/lib/format";
import { ChartEmpty, ChartError, ChartSkeleton } from "./ChartState";

/**
 * "Average Ticket by Sale Type"
 *   AVG_TICKET = SUM(NetSalse) / COUNT(unique_order_code), per (month × order_type).
 *
 * Renders a compact 3-row table (Delivery / Dine-In / Take Away) — designed
 * to fit the card height without internal scroll.
 */
export function TicketBySaleType({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading, error } = useMasterData<TicketBySaleTypeRow[]>(
    "/api/intelligence/dashboards/master/ticket-by-sale-type",
    apiQs
  );

  const { months, orderTypes, byKey } = useMemo(() => {
    const monthsSet = new Set<string>();
    const typesSet = new Set<string>();
    const byKey = new Map<string, TicketBySaleTypeRow>();
    for (const r of data ?? []) {
      monthsSet.add(r.ym);
      typesSet.add(r.order_type);
      byKey.set(`${r.ym}|${r.order_type}`, r);
    }
    // Chronological order (Feb-26 → Mar-26 → Apr-26) — every chart uses this.
    const months = Array.from(monthsSet).sort((a, b) => a.localeCompare(b));
    // Stable canonical order for the 3 sale modes.
    const PRIORITY = ["Delivery", "Dine-In", "Take Away"];
    const orderTypes = Array.from(typesSet).sort((a, b) => {
      const ai = PRIORITY.indexOf(a);
      const bi = PRIORITY.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
    return { months, orderTypes, byKey };
  }, [data]);

  return (
    <div className="card p-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold font-display"
          style={{ color: "var(--text-muted)" }}
        >
          Average Ticket by Sale Channel
        </div>
        <div
          className="text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          SUM(NetSalse) / COUNT(DISTINCT unique_order_code)
        </div>
      </div>
      {error ? (
        <ChartError message={error.message} />
      ) : isLoading || !data ? (
        <div className="h-[88px]">
          <ChartSkeleton />
        </div>
      ) : data.length === 0 ? (
        <div className="h-[88px] flex items-center justify-center">
          <ChartEmpty icon="📊" title="No sale-type data" />
        </div>
      ) : (
        <table className="w-full text-[12px] tabular-nums border-collapse chart-enter">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="text-left font-medium pr-2 py-0.5 w-[88px]">
                Sale Mode
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className="text-right font-medium px-1.5 py-0.5 whitespace-nowrap"
                >
                  {formatMonthYearShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderTypes.map((t) => (
              <tr key={t} style={{ borderTop: "1px solid var(--border-card)" }}>
                <td
                  className="pr-2 py-1 truncate max-w-[88px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t}
                </td>
                {months.map((m) => {
                  const r = byKey.get(`${m}|${t}`);
                  // API already returns SUM(NetSalse)/COUNT(unique_order_code) as
                  // `avgPerTicket`.
                  const avg =
                    r && r.ticketCount > 0 ? r.avgPerTicket : null;
                  return (
                    <td
                      key={m}
                      className="px-1.5 py-1 text-right whitespace-nowrap font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {avg === null ? (
                        <span
                          className="font-normal"
                          style={{ color: "var(--text-muted)" }}
                        >
                          —
                        </span>
                      ) : (
                        formatTHB(avg, 2)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
