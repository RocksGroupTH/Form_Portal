import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { canAccessAccountArea } from "@/lib/acc/access";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/* ── GET /api/request/travel-booking/files/[fileId] ──
   Streams the file inline (mirrors AP-1/AP-15's files/[fileId] route). Access is limited to
   people who can see the parent request: its owner, its manager (approver), or account-area
   (admin/accounting — who attach and review the booking_* files). */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // Tester-only on a UAT record, before any of it is read. See `uatActorGate`.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  const { fileId } = await params;

  try {
    const pool = await getAccPool();
    const result = await pool
      .request()
      .input("id", sql.Int, Number(fileId))
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`
        SELECT f.Id, f.StoragePath, f.StorageBackend, f.ContentType, f.FileName,
               r.CreatedBy, r.ManagerStaffId
        FROM [dbo].[AccRequestFile] f
        INNER JOIN [dbo].[AccRequest] r ON r.Id = f.RequestId
        WHERE f.Id = @id AND r.FormCode = @form
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "File not found" },
        { status: 404 },
      );
    }

    const file = result.recordset[0] as {
      StoragePath: string; StorageBackend: string; ContentType: string | null; FileName: string;
      CreatedBy: number | null; ManagerStaffId: number | null;
    };

    const userId = Number(session.user.id);
    const isOwner = file.CreatedBy != null && file.CreatedBy === userId;
    let isManager = false;
    let isAccountArea = false;
    if (!isOwner) {
      const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
      isAccountArea = await canAccessAccountArea(loginEmail, session.user.role);
      if (!isAccountArea && loginEmail) {
        const { employee } = await findActiveEmployeeByEmail(loginEmail);
        const staffId = employee?.staffId ?? null;
        isManager = staffId != null && file.ManagerStaffId != null && staffId === file.ManagerStaffId;
      }
    }
    if (!isOwner && !isManager && !isAccountArea) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const buffer =
      file.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(file.StoragePath)
        : await downloadFile(file.StoragePath);

    // The stored ContentType is whatever the uploader declared, and rows
    // written before the attachment guard existed may claim anything. Derive
    // the type from the bytes and serve non-image formats as a download.
    return new Response(new Uint8Array(buffer), {
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: file.FileName }),
    });
  } catch (err) {
    console.error("GET /api/request/travel-booking/files/[fileId] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
