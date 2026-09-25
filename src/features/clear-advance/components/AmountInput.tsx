"use client";

import { useState } from "react";
import { formatAmountForDisplay, parseAmountInput } from "@/lib/clr/amount-input-core";

/**
 * A money field that reads `1,000` and stores `1000`.
 *
 * It replaces `<input type="number">`, which cannot do this at all: a browser
 * refuses the comma and hands the field back as an empty string. So the element
 * is `type="text"` with `inputMode="decimal"`, which still brings up the numeric
 * keypad on a phone.
 *
 * **It groups only while nobody is typing in it.** A field that regroups under
 * the caret moves it to the end the moment a comma appears — type `1000` and the
 * cursor jumps after the first three digits. Focused, this shows exactly what is
 * stored and behaves like the plain field it replaced; blurred, it groups. The
 * `focused` flag is the whole mechanism.
 *
 * What reaches `onChange` is always the parsed value, never the displayed one,
 * so the rest of the form keeps the plain digit string it has always had and no
 * total, sum or payload learns about separators.
 */
export function AmountInput({
  value,
  onChange,
  disabled,
  className,
  style,
  placeholder = "0.00",
  ariaInvalid,
}: {
  /** The stored value — plain digits, no separators. */
  value: string;
  /** Receives the parsed value, never what is on screen. */
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  /**
   * Marks the field as failing validation, the same way the plain `<input>`
   * this replaces did. Only the refund amount uses it — it is the one money
   * field on this form with a rule of its own to break — but it has to survive
   * the swap, or a field the form has flagged stops announcing it.
   */
  ariaInvalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      style={style}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={ariaInvalid}
      value={focused ? value : formatAmountForDisplay(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      /* Parsed on the way in, so a pasted "฿1,234.50" is worth the same as a
         typed one and the stored value never carries a separator. */
      onChange={(e) => onChange(parseAmountInput(e.target.value))}
    />
  );
}
