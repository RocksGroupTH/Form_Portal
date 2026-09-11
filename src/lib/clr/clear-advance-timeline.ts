import {
  CLR_HISTORICAL_STEP_ORDER,
  CLR_STEP_CODES,
  type ClrAnyStepCode,
} from "@/features/clear-advance/constants";

/**
 * The steps to draw on a request's approval timeline.
 *
 * The chain is two steps since head accounting was removed (2026-09-11), but
 * requests approved before that have a third approval row, and drawing only
 * the current chain would quietly rewrite their history — the timeline is the
 * only place a requester sees who signed their clearing.
 *
 * So: the chain always, in order, whether or not its rows exist yet (a draft
 * shows what is coming); plus any retired step this particular request
 * actually went through, in the place it used to occupy.
 */
export function clrTimelineSteps(stepsWithRows: Iterable<string>): ClrAnyStepCode[] {
  const present = new Set(stepsWithRows);
  const chain: readonly string[] = CLR_STEP_CODES;
  return CLR_HISTORICAL_STEP_ORDER.filter((c) => chain.includes(c) || present.has(c));
}
