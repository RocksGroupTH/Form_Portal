import { NextResponse } from "next/server";

/** Successful response. Defaults to a short browser cache hint. */
export function jsonResponse<T>(
  data: T,
  status = 200,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, max-age=60",
      ...(extraHeaders ?? {}),
    },
  });
}

/** Error response. Never cached. */
export function errorResponse(err: unknown, status = 500): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { ok: false, error: msg },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
