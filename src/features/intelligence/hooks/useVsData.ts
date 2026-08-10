import useSWR from "swr";
import { getComparisonRange } from "@/features/intelligence/constants";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Fetch comparison (VS) data for a dashboard.
 * Returns null when vs is false or data hasn't loaded.
 */
export function useVsData(
  vs: boolean,
  period: string,
  from: string,
  to: string,
  brand: string,
  apiPath: string,
  branch?: string,
) {
  const [vsFrom, vsTo] = vs ? getComparisonRange(period, from, to) : ["", ""];
  const vsParams = new URLSearchParams({ brand, from: vsFrom, to: vsTo });
  if (branch) vsParams.set("branch", branch);

  const { data: vsApiData } = useSWR(
    vs ? `${apiPath}?${vsParams}` : null,
    fetcher,
  );

  return (vsApiData?.data ?? null) as Record<string, unknown> | null;
}
