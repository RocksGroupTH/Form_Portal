import { getAppPool } from "@/lib/db/mssql";
import { PORTAL_HR_DATABASE } from "@/lib/hr/constants";

/** Cached pool for Rocks_Portal_HR on the app MSSQL server. */
export function getHrPool() {
  return getAppPool(PORTAL_HR_DATABASE);
}
