import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getHrPool } from "@/lib/hr/pool";
import { sql } from "@/lib/db/mssql";
import { pickEmployeePhotoUrl } from "@/lib/hr/photo-url";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ staffId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const staffId = Number((await params).staffId);
  if (!Number.isFinite(staffId) || staffId <= 0) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const pool = await getHrPool();
    const r = await pool
      .request()
      .input("sid", sql.Int, staffId)
      .query<{ PhotoOverrideUrl: string | null; PhotoUrl: string | null }>(`
        SELECT TOP 1 PhotoOverrideUrl, PhotoUrl
        FROM dbo.Employee
        WHERE StaffId = @sid AND Status = 'Active'
      `);

    const row = r.recordset[0];
    const raw = pickEmployeePhotoUrl(row?.PhotoOverrideUrl, row?.PhotoUrl);

    if (!raw) {
      return new NextResponse(null, { status: 404 });
    }

    if (raw.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.*)$/.exec(raw);
      if (!match) {
        return new NextResponse(null, { status: 404 });
      }
      const mime = match[1];
      const buffer = Buffer.from(match[2], "base64");
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=86400",
        },
      });
    }

    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
      return NextResponse.redirect(raw, 302);
    }

    return new NextResponse(null, { status: 404 });
  } catch (err) {
    console.error("[api/hr/photo/[staffId]] GET", err instanceof Error ? err.message : err);
    return new NextResponse(null, { status: 500 });
  }
}
