import { NextResponse } from "next/server";
import { env } from "@/env";
import { getCorePool } from "@/lib/db/mssql";

/**
 * GET /api/health/db — verify app MSSQL config (dev troubleshooting)
 */
export async function GET() {
  try {
    const pool = await getCorePool();
    await pool.request().query("SELECT 1 AS ok");
    return NextResponse.json({
      ok: true,
      data: {
        host: env.MSSQL_HOST,
        port: env.MSSQL_PORT,
        user: env.MSSQL_USER,
        coreDatabase: env.MSSQL_CORE_DATABASE,
        message: "Connected to Fast_Core successfully",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      data: {
        host: env.MSSQL_HOST,
        port: env.MSSQL_PORT,
        user: env.MSSQL_USER,
        coreDatabase: env.MSSQL_CORE_DATABASE,
      },
      error: message,
    }, { status: 503 });
  }
}
