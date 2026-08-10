import { env } from "@/env";
import { formatHostPort } from "@/lib/db/sql-port";

/** Sentinel DbConnectionId — uses MSSQL_* from .env (same server as Fast_Core). */
export const APP_DB_CONNECTION_ID = 0;

export function isAppDbConnection(id: number | null | undefined): boolean {
  return id === APP_DB_CONNECTION_ID;
}

export function getAppMssqlLookup(): { id: number; code: string; name: string } {
  return {
    id: APP_DB_CONNECTION_ID,
    code: "APP_MSSQL",
    name: `App — ${formatHostPort(env.MSSQL_HOST, env.MSSQL_PORT)}`,
  };
}
