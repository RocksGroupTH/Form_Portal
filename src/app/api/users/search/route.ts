import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { searchADUsers, getADUserPhoto } from "@/lib/graph";

/**
 * GET /api/users/search?q=jirayu
 * Search Azure AD users by name or email. IT Admin+ only.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const q = req.nextUrl.searchParams.get("q") ?? "";
    if (q.length < 2) {
      return NextResponse.json({ ok: true, data: [] });
    }

    const users = await searchADUsers(q, 15);

    // Fetch photos in parallel
    const photos = await Promise.all(users.map((u) => getADUserPhoto(u.id)));

    const data = users.map((u, i) => ({
      id: u.id,
      name: u.displayName,
      email: u.mail ?? u.userPrincipalName,
      jobTitle: u.jobTitle,
      department: u.department,
      photo: photos[i],
    }));

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/users/search] GET", err);
    return NextResponse.json({ ok: false, error: "Search failed" }, { status: 500 });
  }
}
