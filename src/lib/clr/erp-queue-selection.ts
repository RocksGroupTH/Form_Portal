/**
 * Which of the ticked AP-3 ERP-queue rows may still be acted on.
 *
 * The Interface ERP tab keeps its tick marks in a Set of request ids that
 * outlives the rows themselves. The list is revalidated after every mutation;
 * the Set is not. So an id stayed ticked after its row had left the sendable
 * list, and cancelling a ticked "รอส่ง" row is where that showed: ADC26-09003
 * and ADC26-09006 were cancelled a minute apart on 2026-09-10 and both were
 * still handed to the preview afterwards, which drew a BC journal for two
 * clearings that can never post. The send had always refused that case; the
 * counter and the preview had not, so the three disagreed about what was
 * selected.
 *
 * The selection is therefore never read out of the Set directly. It is read
 * through here, against the ids that are sendable right now, so a tick on a row
 * that has since been cancelled, sent by someone else, pulled back, or filtered
 * out of the chosen brand simply stops counting — for the counters, the
 * preview, and the send alike, without each caller and each future mutation
 * having to remember to prune it.
 *
 * The order is the table's rather than the order the boxes were clicked, so the
 * preview reads down the screen in the same order as the rows above it.
 */
export function effectiveSelection(
  selected: ReadonlySet<number>,
  selectableIds: readonly number[],
): number[] {
  return selectableIds.filter((id) => selected.has(id));
}
