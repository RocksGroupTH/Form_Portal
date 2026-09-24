import { isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

/**
 * Whether the manager-step bypass exists in this process at all.
 *
 * It used to be decided by the request's `Host` header alone: a request
 * arriving with `Host: localhost:3081` let **any** signed-in user approve,
 * reject or return any AP-1 or AP-17 request at the manager step, and the
 * approval was recorded as the assigned manager's. `auth.config.ts` sets
 * `trustHost: true`, so Next takes the header as given, and nothing in the
 * chain guaranteed a deployed reverse proxy would overwrite it — the whole
 * control was a string the client sends.
 *
 * Two conditions now, both required, both server-side:
 *
 *  - the process is not a production build, so a deployed app cannot have it;
 *  - `ACC_MANAGER_DEV_BYPASS=1` is set explicitly. Default-off, so a developer
 *    opts in per machine rather than inheriting it from the port number.
 *
 * Read once at module load: it is a property of the deployment, not of a
 * request, and evaluating it per request invites the same mistake back.
 */
const DEV_BYPASS_AVAILABLE =
  process.env.NODE_ENV !== "production" && process.env.ACC_MANAGER_DEV_BYPASS === "1";

/**
 * True when the manager step may be actioned by any signed-in user.
 *
 * The host is still checked — it keeps the bypass off a dev machine's LAN
 * address — but it is now the narrowest of the three conditions, not the only
 * one.
 */
export function isManagerDevBypassHost(host?: string | null): boolean {
  if (!DEV_BYPASS_AVAILABLE) return false;
  return isErpSandboxHostAllowed(host);
}

/** True when the actor's HR StaffId matches the manager assigned on the request (HR snapshot). */
export function isAssignedManager(
  actorStaffId: number | null | undefined,
  requestManagerStaffId: number | null | undefined,
): boolean {
  return (
    actorStaffId != null &&
    requestManagerStaffId != null &&
    actorStaffId === requestManagerStaffId
  );
}

/**
 * The manager a request is addressed to **today**, as it travels to the client.
 *
 * Declared here rather than in `@/lib/acc/current-manager` because the detail
 * pages import it: that module reaches `@/env` and a pool, and this one
 * deliberately reaches neither, which is what lets a `"use client"` component
 * hold the type and call the predicate below without dragging a database
 * driver into the browser bundle — the build break CLAUDE.md records for
 * `api-keys/codes.ts`. `CurrentManager` over there is structurally identical
 * on purpose.
 */
export interface CurrentManagerRef {
  staffId: number;
  email: string | null;
}

/** Whoever is asking to act. */
export interface ManagerStepActor {
  staffId: number | null | undefined;
  email: string | null | undefined;
}

/**
 * Everything known about who this request's manager step belongs to.
 *
 * Three sources, and the order they are consulted in is the whole rule — see
 * `mayActOnManagerStep`.
 */
export interface ManagerStepAssignment {
  /**
   * HR's answer **today** (`UatTester`'s, in UAT), or `null` when it has
   * nothing usable to say. Resolved by `resolveCurrentManagerForRequest`
   * (`@/lib/acc/current-manager`), whose header explains why `null` abstains
   * rather than refuses. Structural rather than imported, so this module keeps
   * its "reaches no pool, imports no environment" property and stays
   * unit-testable.
   */
  current: CurrentManagerRef | null | undefined;
  /** `AccRequest.ManagerStaffId` — what HR said when the request was submitted. */
  snapshotStaffId: number | null | undefined;
  /** The `MANAGER` approval row, carrying the same snapshot plus its status. */
  approval:
    | { assignedTo: number | null; assignedEmail: string | null; status: string }
    | null
    | undefined;
}

/**
 * True when the actor may action the pending MANAGER approval step.
 *
 * **The current manager wins outright.** When `assignment.current` names
 * somebody, that person is the only one admitted and the two snapshot arms are
 * not consulted at all — so a manager replaced in HR loses the pending action
 * immediately, which is the point of resolving it live (the user's decision,
 * 2026-09-24). They keep *read* access through `request-acl-policy`, which is a
 * different question and answered separately.
 *
 * **A `null` current manager falls back to the snapshot**, reproducing the
 * behaviour this function had before the live resolution existed. That arm is
 * reached when HR holds no active row for the requester, no `ManagerStaffId` on
 * it, or a `ManagerStaffId` naming somebody who has left. Missing data must not
 * be read as "nobody may approve this" — see `current-manager.ts`'s header.
 *
 * Taken as objects rather than six positional arguments deliberately: every
 * one of the ids is `number | null`, so `snapshotStaffId` and `assignedTo`
 * transpose without a type error, and this decides who may approve money. The
 * rename off `canActManagerStep` is part of the same change — it turns all
 * thirteen call sites into compile errors rather than letting one keep the old
 * snapshot-only behaviour in silence, the tactic
 * `erp-interface-brand-source-guard.test.ts` records for `isErpInterfaceBrand`.
 */
export function mayActOnManagerStep(
  actor: ManagerStepActor,
  assignment: ManagerStepAssignment,
  opts?: { devHostBypass?: boolean },
): boolean {
  const { current, snapshotStaffId, approval } = assignment;
  if (approval && approval.status !== "Pending") return false;
  if (opts?.devHostBypass) return true;

  const actorEmail = actor.email?.trim().toLowerCase() || null;

  if (current) {
    if (isAssignedManager(actor.staffId, current.staffId)) return true;
    // The email arm covers an actor whose own HR lookup came back empty: they
    // still sign in as somebody, and that somebody may be the manager HR names.
    const live = current.email?.trim().toLowerCase() || null;
    return !!(actorEmail && live && actorEmail === live);
  }

  if (isAssignedManager(actor.staffId, snapshotStaffId)) return true;
  if (actor.staffId != null && approval?.assignedTo === actor.staffId) return true;
  const assigned = approval?.assignedEmail?.trim().toLowerCase() || null;
  return !!(actorEmail && assigned && actorEmail === assigned);
}

/** `mayActOnManagerStep` with the dev-host bypass folded in, for route handlers. */
export function mayActOnManagerStepApi(
  actor: ManagerStepActor,
  assignment: ManagerStepAssignment,
  host?: string | null,
): boolean {
  return mayActOnManagerStep(actor, assignment, {
    devHostBypass: isManagerDevBypassHost(host),
  });
}

export const MANAGER_AUTH_ERROR =
  "ไม่มีสิทธิ์ — คุณไม่ใช่ผู้จัดการที่ HR มอบหมายสำหรับคำขอนี้";
