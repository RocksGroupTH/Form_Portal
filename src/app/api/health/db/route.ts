import { NextResponse } from "next/server";
import { env } from "@/env";
import { getCorePool } from "@/lib/db/mssql";
import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import { isSystemAdminRole } from "@/lib/roles";

/**
 * GET /api/health/db — is the core database reachable?
 *
 * `auth.config.ts` exempts every `/api/health*` path from authentication so a
 * load balancer can probe it, which meant this endpoint published the MSSQL
 * host, port, service-account username, database name and the raw driver error
 * text to anyone who asked. That is a map of the estate plus a credential half,
 * from an unauthenticated GET.
 *
 * The reachability answer is genuinely useful to an anonymous probe, so it stays
 * — as a bare boolean and a status code, with nothing about the topology in it.
 * The detail is still available, to a System Admin, and always goes to the
 * server log where an operator can reach it without a session at all.
 *
 * `/api/health` (the liveness probe named in CLAUDE.md's deployment notes) is a
 * separate route and unchanged.
 */
export async function GET() {
  // `auth` is overloaded (route handler / middleware), so its ReturnType is
  // not the session shape — annotate explicitly.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    // A failure here is itself likely the outage being probed. Treat it as "not
    // an admin" and answer the anonymous shape.
  }
  const detailed = isSystemAdminRole(session?.user?.role);

  const detail = detailed
    ? {
        host: env.MSSQL_HOST,
        port: env.MSSQL_PORT,
        user: env.MSSQL_USER,
        coreDatabase: env.MSSQL_CORE_DATABASE,
      }
    : {};

  try {
    const pool = await getCorePool();
    await pool.request().query("SELECT 1 AS ok");
    return NextResponse.json({
      ok: true,
      data: { service: "form-portal", database: "reachable", ...detail },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Logged unconditionally: this is the line an operator needs, and it is the
    // reason the response no longer has to carry it.
    console.error("[health/db] core pool unreachable —", message);
    return NextResponse.json(
      {
        ok: false,
        data: { service: "form-portal", database: "unreachable", ...detail },
        ...(detailed ? { error: message } : {}),
      },
      { status: 503 },
    );
  }
}
