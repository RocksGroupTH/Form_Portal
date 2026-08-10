import type { config as MssqlConfig } from "mssql";

/** mssql port: 0 or unset = omit port (SQL Server default instance) */
export function resolveSqlPort(port: number | undefined | null): number | undefined {
  if (port == null || port === 0) return undefined;
  return port;
}

/** Display host:port — omit :0 */
export function formatHostPort(host: string, port: number): string {
  if (!port) return host;
  return `${host}:${port}`;
}

/** Empty, "-", or "—" = no database (connect to server default, do not set config.database) */
export function normalizeDatabaseName(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "—") return undefined;
  return trimmed;
}

/** For DB storage: null when empty / placeholder */
export function parseDatabaseInput(value: string): string | null {
  return normalizeDatabaseName(value) ?? null;
}

/** Apply port to mssql config; removes `port` when 0 */
export function applySqlPort(config: MssqlConfig, port: number | undefined | null): MssqlConfig {
  const resolved = resolveSqlPort(port);
  if (resolved === undefined) {
    const next = { ...config };
    delete next.port;
    return next;
  }
  return { ...config, port: resolved };
}
