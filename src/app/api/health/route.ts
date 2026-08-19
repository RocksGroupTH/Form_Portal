import { NextResponse } from "next/server";

/**
 * GET /api/health — lightweight liveness probe (no DB).
 * Use after deploy: curl http://127.0.0.1:3081/api/health
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      service: "form-portal",
      nodeEnv: process.env.NODE_ENV ?? "development",
      uptimeSec: Math.floor(process.uptime()),
    },
  });
}
