import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { resolveGoogleMapsKey } from "@/lib/google-maps";
import { requireAuth } from "@/lib/api-auth";

const CACHE_DIR = path.join(process.cwd(), ".cache", "map-preview");

function isValidCoord(lat: number, long: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(long) &&
    lat >= -90 && lat <= 90 &&
    long >= -180 && long <= 180 &&
    !(lat === 0 && long === 0)
  );
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

function buildFilename(shopCode: string, lat: number, long: number): string {
  return `${sanitize(shopCode)}-${lat.toFixed(6)}-${long.toFixed(6)}.png`;
}

/**
 * GET /api/map-preview?shopCode=XX&lat=13.7&long=100.5
 * Returns a cached static map image from Google Static Maps API.
 */
export async function GET(req: NextRequest) {
  try {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { searchParams } = req.nextUrl;
  const shopCode = searchParams.get("shopCode");
  const latStr = searchParams.get("lat");
  const longStr = searchParams.get("long");

  if (!shopCode || !latStr || !longStr) {
    return NextResponse.json({ ok: false, error: "Missing shopCode, lat, or long" }, { status: 400 });
  }

  const lat = parseFloat(latStr);
  const long = parseFloat(longStr);

  if (!isValidCoord(lat, long)) {
    return NextResponse.json({ ok: false, error: "Invalid coordinates" }, { status: 400 });
  }

  const filename = buildFilename(shopCode, lat, long);
  const filePath = path.join(CACHE_DIR, filename);

  // Serve cached image if exists
  try {
    const cached = await fs.readFile(filePath);
    return new NextResponse(cached, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, immutable" },
    });
  } catch {
    // not cached
  }

  const { key: apiKey } = await resolveGoogleMapsKey();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Google Maps API key not configured" }, { status: 500 });
  }

  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${long}&zoom=15&size=640x160&scale=2&markers=color:red%7C${lat},${long}&key=${apiKey}`;

  try {
    const res = await fetch(mapUrl);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Google Maps API returned ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Non-image response" }, { status: 502 });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Clean old images for this shopCode
    try {
      const prefix = sanitize(shopCode) + "-";
      const files = await fs.readdir(CACHE_DIR);
      for (const f of files) {
        if (f.startsWith(prefix) && f.endsWith(".png") && f !== filename) {
          await fs.unlink(path.join(CACHE_DIR, f)).catch(() => {});
        }
      }
    } catch { /* not critical */ }

    await fs.writeFile(filePath, buffer);
    return new NextResponse(buffer, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, immutable" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to fetch map image" }, { status: 502 });
  }
  } catch (err) {
    console.error("[api/map-preview] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
