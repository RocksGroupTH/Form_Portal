import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { errorResponse } from "@/lib/intelligence/api-helpers";

/**
 * PDF export receives a base64 PNG from the client (rendered via html2canvas)
 * and wraps it in a styled PDF. Implementation lands in Phase 3 — this stub
 * keeps the route reachable so the export modal can detect it.
 */
export async function POST(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  return errorResponse("PDF export not yet implemented (Phase 3)", 501);
}
