/**
 * Who may host a shared room, and who may attach to one — AP-17 package E.
 *
 * The **host** is the request with a real accommodation booking; the **guest**
 * is the request that attaches to it, books no room of its own, and still
 * draws per diem (spec §1 — the user's own words, *"(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)"*).
 *
 * **This is the first place in this application where one person's request is
 * bound to another's**, so every refusal here is requester-facing rather than
 * a bare code: "cannot attach" tells a guest nothing about whether the
 * colleague booked no room, is already somebody else's guest, or is cancelled.
 *
 * **One hop only.** A host may not itself be a guest (`canHost`), and a guest
 * may not itself be a host (`canAttach`) — spec §3: *"A guest's request may
 * not itself be a host."* Both directions of that same invariant have to be
 * enforced at every insert, because nothing at the schema level stops a row
 * naming a `HostRequestId` that is itself somebody's `GuestRequestId`. Without
 * both checks a chain of any depth — or the named cycle, A hosts B while B
 * hosts A — could be built one attach at a time, and the cascade (§4) is only
 * sound at depth one: it is what makes cancellation terminate.
 *
 * Pure and import-free so it is unit-tested without a database — the same
 * discipline `date-overlap.ts` and `perdiem-dependency.ts` already keep.
 */

export interface ShareCandidate {
  requestId: number;
  requestNo: string | null;
  status: string;
  /** Derived from the option rows, never posted — see `derive-flags.ts`. */
  needsRoomBooking: boolean;
  /** True when this request is itself already a guest of someone. */
  isGuest: boolean;
  /**
   * The requests currently attached to this one as guests (rows where this
   * candidate is `HostRequestId`), if any — used for the cycle/chain test.
   * Non-empty means this candidate is presently acting as a host, which is
   * exactly the state `canAttach` must refuse turning into a guest.
   */
  hostsFor: number[];
}

/**
 * Every reason this module refuses, as a closed union rather than a bare
 * `string`.
 *
 * Task 4's service and Task 7's picker both branch on these, and a plain
 * `string` gives neither a compiler backstop — a typo or a retired code reads
 * as an unreachable arm that silently never fires, on a control whose whole
 * job is telling a requester WHY they were refused. Adding a reason without
 * handling it is now a type error at every exhaustive consumer.
 */
export type ShareRefusalCode =
  | "host_not_alive"
  | "host_no_room"
  | "host_is_guest"
  | "self_attach"
  | "guest_already_hosts"
  | "guest_has_host";

export type ShareRefusal = { code: ShareRefusalCode; message: string };

/**
 * Dead, and so unusable as a host — the exact exclusion `continuation-chain.ts`,
 * `date-overlap.ts`, `requester-trips.ts` and `perdiem-dependency.ts` already
 * use for "alive". A seventh definition that disagreed would be the bug this
 * feature's whole risk is: one person's request moving another's.
 *
 * **Exported so `room-share-cascade.ts` reuses this exact array** rather than
 * writing its own — that module decides what happens to a host's guests, and
 * it is this same feature, so a second copy here would be the disagreement
 * this comment already warns against, not a new one.
 */
export const DEAD: readonly string[] = ["Cancelled", "Rejected"];

/** `requestNo`, or the same Draft fallback `date-overlap.ts` uses — never "null" at the reader. */
function requestLabel(candidate: ShareCandidate): string {
  return candidate.requestNo ?? "คำขอฉบับร่าง";
}

/**
 * May `candidate` be offered — and attached to — as a room-share host?
 *
 * Used both to filter the picker's list of hostable requests (spec §6: alive,
 * not already a guest, `needsRoomBooking = true`) and, via `canAttach` below,
 * to re-validate a specific chosen host server-side at attach time.
 */
export function canHost(candidate: ShareCandidate): ShareRefusal | null {
  if (DEAD.indexOf(candidate.status) !== -1) {
    return {
      code: "host_not_alive",
      message: `ไม่สามารถเลือก ${requestLabel(candidate)} เป็นห้องพักร่วมได้ เนื่องจากคำขอนี้ถูกยกเลิกหรือถูกปฏิเสธไปแล้ว`,
    };
  }
  if (!candidate.needsRoomBooking) {
    return {
      code: "host_no_room",
      message: `ไม่สามารถเลือก ${requestLabel(candidate)} เป็นห้องพักร่วมได้ เนื่องจากคำขอนี้ไม่มีการจองห้องพัก`,
    };
  }
  if (candidate.isGuest) {
    // One hop only (spec §3) — naming the request that is already a guest:
    // here, `candidate` itself, since `canHost` is asked about exactly one.
    return {
      code: "host_is_guest",
      message: `ไม่สามารถเลือก ${requestLabel(candidate)} เป็นห้องพักร่วมได้ เนื่องจากคำขอนี้เป็นผู้เข้าพักร่วมของคำขออื่นอยู่แล้ว`,
    };
  }
  return null;
}

/**
 * May `guest` attach to `host`?
 *
 * Checks the relationship first — self-attach, and the guest's own state,
 * both of which `canHost(host)` alone could never catch — then delegates host
 * eligibility to `canHost`, so the two functions can never disagree about
 * what makes a host usable.
 */
export function canAttach(guest: ShareCandidate, host: ShareCandidate): ShareRefusal | null {
  if (guest.requestId === host.requestId) {
    return {
      code: "self_attach",
      message: "ไม่สามารถเลือกคำขอของตัวเองเป็นห้องพักร่วมได้",
    };
  }

  // "A guest's request may not itself be a host" (spec §3) — unconditional,
  // not scoped to the specific host being attached to. A request presently
  // hosting anyone at all is a request that has already used its one hop, and
  // the mutual cycle named in the spec (A hosts B, B attempts to host A) is
  // exactly one instance of this: A's hostsFor already contains B.
  if (guest.hostsFor.length > 0) {
    return {
      code: "guest_already_hosts",
      message: `ไม่สามารถแนบ ${requestLabel(guest)} เป็นผู้เข้าพักร่วมได้ เนื่องจากคำขอนี้มีผู้เข้าพักร่วมแนบอยู่แล้ว`,
    };
  }

  if (guest.isGuest) {
    // The unique index on `GuestRequestId` is the backstop; this message is
    // what lets a requester understand the refusal before they hit it.
    return {
      code: "guest_has_host",
      message: `ไม่สามารถแนบ ${requestLabel(guest)} เป็นผู้เข้าพักร่วมได้ เนื่องจากคำขอนี้แนบกับห้องพักร่วมอื่นอยู่แล้ว`,
    };
  }

  return canHost(host);
}
