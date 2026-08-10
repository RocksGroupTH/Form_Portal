import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { errorResponse } from "@/lib/intelligence/api-helpers";

/**
 * Preview thumbnail uses sharp to downscale the PNG the client supplied
 * to export-pdf. Lands in Phase 3.
 */
export async function POST(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  return errorResponse("Preview thumbnail not yet implemented (Phase 3)", 501);
}
