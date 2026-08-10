export function avgTicket(netSales: number, ticketCount: number): number {
  return ticketCount > 0 ? netSales / ticketCount : 0;
}

export function ads(netSales: number, distinctDays: number): number {
  return distinctDays > 0 ? netSales / distinctDays : 0;
}

export function pctDiff(curr: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return (curr - prev) / prev;
}
