import { filterRowsByInterfaceTarget } from "@/features/accounting/lib/erp-interface-target";
import type { ErpInterfaceStatus, ErpPrepStatus } from "@/features/accounting/constants";

/** The row fields that decide whether a document joins an ERP send batch. */
export interface ErpSendBatchCandidate {
  brandCode: string | null;
  prepStatus: ErpPrepStatus;
  erpInterfaceStatus: ErpInterfaceStatus | null;
}

/**
 * The documents one POST …/send actually pushes to Business Central: the rows
 * mapped to this interface target that are ready and not already Sent.
 *
 * Defined once and shared on purpose. `sendErpInterfaceBatch` picks the batch
 * with it, and `ErpPrepQueue` echoes exactly these ids so the server can refuse
 * (409) a click bound to a queue that has moved. Two copies of this predicate
 * drifting apart would make every send a false 409, so there is only one.
 *
 * Note what is deliberately *not* in here: the whole Approved queue. Comparing
 * against that made any approval anywhere in Accounting — another brand,
 * another interface target, an AP-17 booking — invalidate an open prep page
 * with a message about environments that had not changed.
 */
export function selectErpSendBatchRows<T extends ErpSendBatchCandidate>(
  rows: T[],
  interfaceByClaim: Record<string, string>,
  interfaceTarget: string,
): T[] {
  return filterRowsByInterfaceTarget(rows, interfaceByClaim, interfaceTarget).filter(
    (r) => r.prepStatus === "ready" && r.erpInterfaceStatus !== "Sent",
  );
}

/**
 * Order-independent equality over request ids — the client must echo the same
 * batch the server picks, and neither side promises an order. Ids are unique
 * within a batch (they are `AccRequest.Id`), so length plus membership is
 * exact; a list containing duplicates is treated as unequal, which is the safe
 * direction for a staleness gate.
 */
export function sameRequestIdSet(
  a: readonly number[],
  b: readonly number[],
): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== a.length || setB.size !== b.length) return false;
  for (const id of b) {
    if (!setA.has(id)) return false;
  }
  return true;
}
