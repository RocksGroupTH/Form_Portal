/**
 * A money field a person reads with thousand separators and types without them.
 *
 * `<input type="number">` cannot show `1,000` — a browser rejects the comma and
 * hands back an empty string — so a grouped amount has to be a text input that
 * formats itself. These are the two halves of that, kept pure so the rules are
 * tested without a DOM.
 *
 * **Grouping is for the eye, never for the state.** `parseAmountInput` runs on
 * every keystroke and what it returns is what is stored, sent and summed, so the
 * stored value stays the plain digits it has always been and nothing downstream
 * — `num()`, the totals, the payload — learns about commas. `formatAmountForDisplay`
 * is applied only when the field is not being typed in; a field that regroups
 * under the caret pushes it to the end on the first comma, which is the bug this
 * shape exists to avoid.
 */

/**
 * The keystrokes, reduced to a number the rest of the form can read.
 *
 * A **string**, not a number, because this runs mid-typing: `""`, `"1."` and
 * `"0"` are all states a person passes through and none of them survive a round
 * trip through `Number`. It is deliberately permissive about what it keeps and
 * strict about what it drops.
 *
 * - separators go, so a pasted `1,000` is worth the same as a typed one
 * - anything that is not a digit or a dot goes, including a minus: these fields
 *   carried `min="0"` as number inputs and still refuse a negative
 * - **the first dot is kept and the rest are dropped**, so `1.2.3` settles as
 *   `1.23` rather than being thrown away entirely — a stray dot is a slip, and
 *   erasing what somebody typed to punish it is the wrong trade in a grid where
 *   the number came off a receipt
 */
export function parseAmountInput(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "")
  );
}

/**
 * The same value, grouped, for a field nobody is typing in.
 *
 * The fraction is shown **exactly as it was entered** — `1000.5` reads as
 * `1,000.5`, not `1,000.50`. These fields have never padded to two places, and
 * padding here would mean a field that changes what it says the moment it loses
 * focus, on a form where the number came off a receipt and is checked against
 * it.
 *
 * A trailing dot survives for the same reason: `1000.` is somebody mid-decimal
 * who clicked away, and `1,000.` says what they left rather than quietly
 * finishing the thought for them.
 */
export function formatAmountForDisplay(raw: string | null | undefined): string {
  const value = parseAmountInput(raw);
  if (value === "") return "";

  const dot = value.indexOf(".");
  const whole = dot === -1 ? value : value.slice(0, dot);
  const rest = dot === -1 ? "" : value.slice(dot);

  // An empty whole part is `.5` — grouped, that is still `.5`.
  const grouped = whole === "" ? "" : Number(whole).toLocaleString("en-US");
  return grouped + rest;
}
