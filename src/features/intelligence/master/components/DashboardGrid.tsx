import React from "react";

interface Props {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

/**
 * Page-level layout. Sized to the viewport width — no horizontal scroll.
 * The center column carries `min-w-0` so its children can shrink instead of
 * pushing the grid wider than the viewport.
 *
 * Responsive columns:
 *   - < lg (phones + tablet portrait): single column. The side rails are
 *     hidden here and reached through the Tools / Filters full-screen sheets,
 *     so the charts get the full width instead of a cramped ~300px center.
 *   - lg (tablet landscape / small laptop): 3 columns with slimmer rails.
 *   - xl and up: 3 columns with the full-width rails.
 */
export function DashboardGrid({ left, center, right }: Props) {
  return (
    <div
      data-export-id="dashboard-root"
      className="grid min-h-dvh w-full max-w-full gap-1.5 p-1.5 md:gap-2 md:p-2 items-start grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_184px] xl:grid-cols-[240px_minmax(0,1fr)_200px]"
    >
      <div className="hidden lg:flex flex-col gap-2 min-w-0">{left}</div>
      <div className="flex flex-col gap-2 min-w-0">{center}</div>
      <div className="hidden lg:flex flex-col gap-2 min-w-0">{right}</div>
    </div>
  );
}
