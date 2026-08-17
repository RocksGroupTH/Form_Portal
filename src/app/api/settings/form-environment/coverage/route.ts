import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireRole } from "@/lib/api-auth";
import { matchRule } from "@/lib/form-environment/classify-path";

/**
 * Lists every API route under src/app/api/request/ that classifyPath sends to
 * the Production default. A route added later without a rule shows up here
 * instead of silently reading the wrong database.
 *
 * This reads the source tree, so it only answers where the sources are on disk
 * — a dev checkout. A packaged build reports `available: false` rather than
 * failing, because the check is a development aid, not a runtime dependency.
 */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;

  const root = path.resolve(process.cwd(), "src/app/api/request");
  if (!fs.existsSync(root)) {
    return NextResponse.json({
      ok: true,
      data: { available: false, total: 0, unclassified: [], all: [] },
    });
  }

  const found: { route: string; classification: string }[] = [];

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "route.ts") {
        const rel = full
          .slice(path.resolve(process.cwd(), "src/app").length)
          .replace(/\\/g, "/")
          .replace(/\/route\.ts$/, "");
        // A rule whose result is null means "Production, deliberately"; no rule
        // at all means nobody has decided, which is what this check is for.
        const rule = matchRule(rel);
        found.push({
          route: rel,
          classification: rule ? rule.result ?? "PRODUCTION" : "UNCLASSIFIED",
        });
      }
    }
  };

  try {
    walk(root);
  } catch (err) {
    console.error("[api/settings/form-environment/coverage] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      available: true,
      total: found.length,
      unclassified: found.filter((f) => f.classification === "UNCLASSIFIED"),
      all: found.sort((a, b) => a.route.localeCompare(b.route)),
    },
  });
}
