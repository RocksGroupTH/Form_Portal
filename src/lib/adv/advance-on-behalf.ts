import { findById } from "@/lib/team-member/service";
import type { OnBehalfPair } from "@/lib/adv/advance-notify-recipients";

/**
 * The on-behalf pair for one AP-2 request: who it is for, and who filed it.
 *
 * `AccRequest.CreatedBy` is the anchor rather than `SubmittedBy`, because it is
 * the person who owns the draft and who has to edit it when it comes back.
 * `SubmittedBy` is usually the same, but an admin pressing submit on somebody
 * else's draft would make it name the wrong person for every later trigger.
 *
 * **Best effort, deliberately.** The filer's address lives in `TeamMember`, in
 * a different database from the request. A notification must not fail — and
 * must not become *fewer* notifications than before — because that read did
 * not answer, so anything unexpected returns a pair with no filer, and
 * `advanceNotifyList` then adds nobody.
 */
export async function resolveOnBehalfPair(req: {
  requesterEmail?: string | null;
  createdBy?: number | null;
}): Promise<OnBehalfPair> {
  const requesterEmail = req.requesterEmail ?? null;
  const createdBy = req.createdBy ?? null;
  if (!createdBy) return { requesterEmail, filerEmail: null };

  try {
    const member = await findById(createdBy);
    return { requesterEmail, filerEmail: member?.email ?? null };
  } catch (err) {
    console.error("[AP-2] could not resolve the filer for CreatedBy", createdBy, "—", err);
    return { requesterEmail, filerEmail: null };
  }
}
