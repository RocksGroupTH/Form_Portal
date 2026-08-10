import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { sendEmail } from "@/lib/graph";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ── POST /api/intelligence/reports/send-email ── */

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const body = await req.json();
    const { reportName, fileName, excelBase64 } = body as {
      reportName?: string;
      fileName?: string;
      excelBase64?: string;
    };

    if (!reportName || !fileName || !excelBase64) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    // Graph API has ~4MB total message limit; cap base64 at 3MB (~2.25MB file)
    if (excelBase64.length > 3 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "File too large (max ~2MB). Try a shorter date range." }, { status: 400 });
    }

    const userEmail = session.user?.email;
    const userName = session.user?.name ?? "User";
    if (!userEmail) {
      return NextResponse.json({ ok: false, error: "No email in session" }, { status: 400 });
    }

    const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });

    await sendEmail({
      to: userEmail,
      subject: `[Rocks Fast] ${reportName} Report`,
      bodyHtml: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
          <h2 style="color: #1a1a1a; margin-bottom: 4px;">Fast Intelligence Report</h2>
          <p style="color: #666; margin-top: 0;">Hi ${esc(userName)},</p>
          <p style="color: #333;">Your <strong>${esc(reportName)}</strong> report is attached as an Excel file.</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Report</td>
              <td style="padding: 4px 0; color: #333; font-weight: 600;">${esc(reportName)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">File</td>
              <td style="padding: 4px 0; color: #333;">${esc(fileName)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Sent at</td>
              <td style="padding: 4px 0; color: #333;">${esc(now)}</td>
            </tr>
          </table>
          <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
          <p style="color: #999; font-size: 12px;">Sent from Rocks Fast Intelligence</p>
        </div>
      `,
      attachments: [
        {
          name: fileName,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: excelBase64,
        },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/intelligence/reports/send-email] POST", err);
    return NextResponse.json(
      { ok: false, error: "Failed to send email" },
      { status: 500 },
    );
  }
}
