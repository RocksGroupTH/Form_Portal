/**
 * The tiny inline markup the API-key setup guides are written in, so a guide
 * stays **data** rather than a slab of JSX. Adding a provider should mean adding
 * an entry to `./guides.ts`, not editing a component.
 *
 * Three forms, and nothing else: `` `code` ``, `**bold**`, `[label](https://…)`.
 * Pure — imports nothing, so it is unit-tested without a browser.
 *
 * An unclosed marker stays literal rather than consuming the rest of the line.
 * That matters more than it looks: swallowing the tail would silently hide a
 * step from the person following the instructions.
 */

export type GuideToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

/**
 * `[label](url)`, `` `code` ``, `**bold**` — in that order of attempt, so a URL
 * containing a backtick or asterisk cannot be split by them.
 */
const PATTERN = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)|`([^`\n]*)`|\*\*([^*\n]+)\*\*/;

export function parseGuideText(input: string): GuideToken[] {
  const out: GuideToken[] = [];
  let rest = input;

  while (rest.length > 0) {
    const m = PATTERN.exec(rest);
    if (!m || m.index === undefined) break;

    if (m.index > 0) out.push({ kind: "text", text: rest.slice(0, m.index) });

    if (m[2] !== undefined) {
      // Only http(s) reaches the anchor — the pattern itself refuses anything
      // else, so a `javascript:` URL in a guide renders as literal text.
      out.push({ kind: "link", text: m[1] ?? "", href: m[2] });
    } else if (m[3] !== undefined) {
      out.push({ kind: "code", text: m[3] });
    } else {
      out.push({ kind: "bold", text: m[4] });
    }

    rest = rest.slice(m.index + m[0].length);
  }

  if (rest.length > 0) out.push({ kind: "text", text: rest });
  return out;
}
