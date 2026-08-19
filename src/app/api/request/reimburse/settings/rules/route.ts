import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/api-auth";
import {
  createRule,
  listActiveRules,
  listAllRules,
  reorderRules,
  setRuleActive,
  updateRuleText,
  validateRuleText,
} from "@/lib/acc/reimburse/settings-service";

/**
 * The acknowledgement checklist — read by every requester, edited by admins.
 *
 * One route, two audiences, deliberately not two routes: the form has been
 * fetching this path since Task 6 and the editor wants the same rows plus the
 * retired ones. Splitting it would leave two places that decide what a rule is.
 * The audiences are told apart by the query string and each is gated on its own
 * terms — see `GET` below.
 */

/** Who may edit the checklist. Matches AP-1's settings routes, which are the neighbouring precedent. */
const SETTINGS_ROLES = ["IT Admin", "System Admin"] as const;

/* ─────────────────────────── read ─────────────────────────── */

/**
 * GET /api/request/reimburse/settings/rules — the acknowledgement checklist.
 *
 * Default: **active rules only**, `requireAuth()`, because every signed-in user
 * has to tick every line of it before a request will submit. This is the shape
 * `ReimburseForm` and `ReimburseDetail` consume and it is unchanged.
 *
 * `?includeInactive=1`: the whole table, retired rules included, for the
 * Settings editor — and that answer is admin-only. A retired rule is not
 * secret, but the list of them is a statement about how the policy has changed
 * over time, and nothing outside Settings has a use for it.
 */
export async function GET(req: NextRequest) {
  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";

  const session = includeInactive
    ? await requireRole([...SETTINGS_ROLES])
    : await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = includeInactive ? await listAllRules() : await listActiveRules();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/rules] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ─────────────────────────── write ─────────────────────────── */

const BAD_ACTION = "คำสั่งไม่ถูกต้อง";
const BAD_ID = "ไม่พบระเบียบที่ต้องการแก้ไข";

interface RuleWriteBody {
  action?: unknown;
  id?: unknown;
  ruleText?: unknown;
  isActive?: unknown;
  ids?: unknown;
}

/** A positive integer id off the wire, or null. */
function ruleId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * POST /api/request/reimburse/settings/rules — create, reword, retire, reorder.
 *
 * One endpoint dispatching on `action`, the shape `/api/settings/uat-users`
 * already uses for a roster with the same handful of verbs.
 *
 * **There is no delete.** `AccReimburseRuleAck` carries a foreign key to every
 * rule a submitted request ticked, so removing the row would either be refused
 * by the database or — worse, if it were not — leave an approved claim unable to
 * say what its author agreed to. `setActive` is the whole retirement story.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;

  let body: RuleWriteBody;
  try {
    body = (await req.json()) as RuleWriteBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const userId = Number(session.user.id);

  try {
    switch (body.action) {
      case "create": {
        // Narrowed on `text`, not on `error`: the union's discriminant is
        // `text: string | null`, and a destructured `error: string | null` is
        // not a literal type TypeScript can narrow the sibling from.
        const v = validateRuleText(body.ruleText);
        if (v.text === null) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
        await createRule(v.text, userId);
        return NextResponse.json({ ok: true });
      }

      case "update": {
        const id = ruleId(body.id);
        if (id === null) return NextResponse.json({ ok: false, error: BAD_ID }, { status: 400 });
        const v = validateRuleText(body.ruleText);
        if (v.text === null) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
        await updateRuleText(id, v.text, userId);
        return NextResponse.json({ ok: true });
      }

      case "setActive": {
        const id = ruleId(body.id);
        if (id === null) return NextResponse.json({ ok: false, error: BAD_ID }, { status: 400 });
        await setRuleActive(id, body.isActive === true, userId);
        return NextResponse.json({ ok: true });
      }

      case "reorder": {
        if (!Array.isArray(body.ids)) {
          return NextResponse.json({ ok: false, error: BAD_ACTION }, { status: 400 });
        }
        const ids: number[] = [];
        for (const raw of body.ids) {
          const id = ruleId(raw);
          if (id === null) return NextResponse.json({ ok: false, error: BAD_ID }, { status: 400 });
          ids.push(id);
        }
        await reorderRules(ids, userId);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, error: BAD_ACTION }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/request/reimburse/settings/rules] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
