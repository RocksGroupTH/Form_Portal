import { buildAccActor } from "@/lib/acc/actor-context";

/**
 * The actor behind an AP-4 route's session, for anything reading
 * `AccReimburseApprover`/`AccReimburseApproverBrand` — the brand-scope filter
 * on `listReimburseAccountQueue`/`listReimburseErpQueue`, and (on
 * `approvals/route.ts`) the `isReimburseApprover` notice.
 *
 * Shared by `approvals/route.ts` and `erp-queue/route.ts` on purpose (fix
 * round 1, M4): each used to build this independently, and the two builds
 * disagreed — `approvals/route.ts` passed the queue `actor.email` (trimmed,
 * `buildAccActor`'s own normalisation), while `erp-queue/route.ts` passed the
 * raw, untrimmed session email straight through. Functionally near-identical
 * (an untrimmed email almost never differs from Entra's own value), but the
 * two routes' comments claimed to mirror each other while their code did not
 * — this is what makes that claim true.
 *
 * Degrades `staffId` to `null` on a failed HR lookup rather than failing the
 * whole request: `loadApproverScopeByStaffId` still has the login email to
 * fall back to, the same fallback `findActiveApprover` uses everywhere else.
 * A pool failure genuinely inside a route's OWN queue read (`getAccPool`) is
 * a different failure surface and is left to that route's own top-level
 * `try` — this only shields the HR half.
 */
export interface ReimburseRouteActor {
  userId: number;
  email: string | null;
  staffId: number | null;
}

export async function resolveReimburseRouteActor(
  userId: number,
  email: string | null,
  logTag: string,
): Promise<ReimburseRouteActor> {
  try {
    return await buildAccActor(userId, email);
  } catch (err) {
    console.error(`[${logTag}] buildAccActor failed — falling back to email match only`, err);
    return { userId, email: email?.trim() || null, staffId: null };
  }
}
