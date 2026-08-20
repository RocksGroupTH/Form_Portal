import { sql } from "@/lib/acc/pool";

/**
 * The three writes that move reward stock, and nothing else.
 *
 * `stock.ts` is the arithmetic — pure, unit-tested, no imports. This is the SQL
 * that changes the counters, kept in one file so every mutation of `LockedQty`
 * and `IssuedQty` in the codebase is visible in a single place. Nothing outside
 * this module may write those two columns.
 *
 * Every function takes a transaction and does its work with a **conditional
 * UPDATE whose row count is checked**, per the repo rule: never read the
 * counters and then write them back. AP-11 is the first form on this backbone
 * whose submit consumes a finite resource, and a read-then-write would let two
 * concurrent submits both see "1 left" and both take it.
 */

/** A `mssql` transaction or pool — anything that hands back a `Request`. */
export interface SqlRunner {
  request(): sql.Request;
}

/**
 * Take `qty` for a new submit.
 *
 * Returns false when the reward cannot supply it — closed, not yet started,
 * expired, gone, or simply short. The caller rolls back and answers 409; it must
 * not retry, because nothing about a second attempt would be different.
 *
 * The availability conditions are re-tested here rather than trusted from the
 * card list the requester saw: that list was rendered from a read, and a read is
 * not a reservation. This predicate is the reservation.
 */
export async function takeStock(tx: SqlRunner, rewardId: number, qty: number): Promise<boolean> {
  const r = await tx
    .request()
    .input("rid", sql.Int, rewardId)
    .input("qty", sql.Int, qty)
    .query(
      `UPDATE [dbo].[AccReward]
          SET LockedQty = LockedQty + @qty, UpdatedAt = SYSDATETIME()
        WHERE Id = @rid
          AND IsActive = 1
          AND (StartDate  IS NULL OR StartDate  <= CAST(SYSDATETIME() AS date))
          AND (ExpireDate IS NULL OR ExpireDate >= CAST(SYSDATETIME() AS date))
          AND Qty - LockedQty - IssuedQty >= @qty;
       SELECT @@ROWCOUNT AS n`,
    );
  return (r.recordset[0].n as number) === 1;
}

/**
 * Give `qty` back — the Reject path, and the only path that returns stock.
 *
 * The owner's rule is that a Return or an abandoned request keeps its hold, so
 * this is called from exactly two places: manager reject and Assist AP reject.
 *
 * `LockedQty >= @qty` in the predicate makes a double release impossible: the
 * second one matches no row and the row count says so. It is tolerated rather
 * than thrown on, because a reject that has already released is not an error
 * worth failing the transaction over — but it is worth not double-crediting.
 */
export async function releaseStock(
  tx: SqlRunner,
  rewardId: number | null,
  qty: number,
): Promise<void> {
  if (rewardId == null || qty <= 0) return;
  await tx
    .request()
    .input("rid", sql.Int, rewardId)
    .input("qty", sql.Int, qty)
    .query(
      `UPDATE [dbo].[AccReward]
          SET LockedQty = LockedQty - @qty, UpdatedAt = SYSDATETIME()
        WHERE Id = @rid AND LockedQty >= @qty`,
    );
}

/**
 * Hand the goods over — move `qty` from held to issued.
 *
 * One statement, so the total (`LockedQty + IssuedQty`) never changes; if it
 * were two, a failure between them would either free stock nobody returned or
 * count it twice against `CK_AccReward_Stock`.
 */
export async function issueStock(
  tx: SqlRunner,
  rewardId: number | null,
  qty: number,
): Promise<void> {
  if (rewardId == null || qty <= 0) return;
  await tx
    .request()
    .input("rid", sql.Int, rewardId)
    .input("qty", sql.Int, qty)
    .query(
      `UPDATE [dbo].[AccReward]
          SET LockedQty = LockedQty - @qty,
              IssuedQty = IssuedQty + @qty,
              UpdatedAt = SYSDATETIME()
        WHERE Id = @rid AND LockedQty >= @qty`,
    );
}

/**
 * Move an existing hold to `newRewardId` × `newQty`, whatever it was before.
 *
 * Used on the resubmit of a `Returned` request, which keeps its hold while the
 * requester edits — and they may edit both the quantity and the reward. Three
 * cases, in the order they are handled:
 *
 * - **Different reward** — release the old hold in full, take the new one in
 *   full. Not a delta: the two counters belong to different rows.
 * - **Same reward, more wanted** — take only the increase, conditionally, so it
 *   can still fail when somebody else took the difference meanwhile.
 * - **Same reward, less or equal** — give back the difference. Cannot fail.
 *
 * Returns false when the extra is not available; the caller rolls back.
 */
export async function moveHold(
  tx: SqlRunner,
  held: { rewardId: number | null; qty: number },
  newRewardId: number,
  newQty: number,
): Promise<boolean> {
  if (held.rewardId !== newRewardId) {
    if (!(await takeStock(tx, newRewardId, newQty))) return false;
    await releaseStock(tx, held.rewardId, held.qty);
    return true;
  }

  const delta = newQty - held.qty;
  if (delta === 0) return true;
  if (delta < 0) {
    await releaseStock(tx, newRewardId, -delta);
    return true;
  }
  return takeStock(tx, newRewardId, delta);
}

/**
 * Record what a request now holds, alongside the `AccReward` counter change and
 * inside the same transaction.
 *
 * `AccRewardRequest.LockedQty` is the request's own copy of its hold, separate
 * from `Qty` (what is being asked for) because a Returned request keeps its hold
 * while its `Qty` is edited. Every release and every issue reads this, not `Qty`.
 */
export async function writeHold(
  tx: SqlRunner,
  requestId: number,
  rewardId: number | null,
  qty: number,
): Promise<void> {
  await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("reward", sql.Int, rewardId)
    .input("qty", sql.Int, Math.max(0, qty))
    .query(
      `UPDATE [dbo].[AccRewardRequest]
          SET LockedQty = @qty, LockedRewardId = @reward, UpdatedAt = SYSDATETIME()
        WHERE RequestId = @rid`,
    );
}

/**
 * The reward and quantity a request is currently holding.
 *
 * Reads `LockedRewardId`/`LockedQty`, never `RewardId`/`Qty` — those are the
 * request's *intent*, which on a Returned request can have moved on from what is
 * actually reserved.
 *
 * Read inside the caller's transaction so the release or issue that follows acts
 * on the same row the guard saw.
 */
export async function readHeldStock(
  tx: SqlRunner,
  requestId: number,
): Promise<{ rewardId: number | null; qty: number } | null> {
  const r = await tx
    .request()
    .input("rid", sql.Int, requestId)
    .query(
      `SELECT LockedRewardId, LockedQty FROM [dbo].[AccRewardRequest] WHERE RequestId = @rid`,
    );
  if (!r.recordset.length) return null;
  return {
    rewardId: (r.recordset[0].LockedRewardId as number) ?? null,
    qty: (r.recordset[0].LockedQty as number) ?? 0,
  };
}
