/**
 * The organisation label shown under a person's name in the navbar.
 *
 * Derived from the email domain because the session carries no organisation
 * field — `{ id, name, email, role, nickname, color, photo }` and nothing else
 * (see "Auth" in CLAUDE.md). Adding one would mean a column, a migration and a
 * roster to maintain, for a line of text; the domain already says which company
 * the person belongs to and is guaranteed present on every signed-in session.
 *
 * The rule: drop the public suffix, take the label before it, capitalise the
 * first letter. `sattawat.c@rocksgroup.com` → `Rocksgroup`.
 *
 * Taking the *first* label of the domain instead would be one line shorter and
 * wrong for `mail.rocksgroup.com`, which would read "Mail". Taking the last is
 * wrong for every address at all, since that is the TLD. So the suffix is
 * removed first and the last of what remains is the answer.
 *
 * Imports nothing, so it is unit-tested without loading the app.
 */

/**
 * Suffix labels dropped from the end of a domain before the company name is
 * read. Not a public-suffix list and not trying to be — the full list is
 * thousands of entries, updated continuously, and this decides a caption.
 *
 * Any two-letter label is treated as a country code, which covers `.th`,
 * `.uk`, `.au` and the rest without naming them; the entries here are the
 * generic TLDs and the second-level labels that sit under a ccTLD. A domain
 * whose real name happens to be two letters would be mis-read, and that is
 * accepted: the caption would be missing, not wrong about a different company.
 */
const SUFFIX_LABELS = [
  "com",
  "net",
  "org",
  "edu",
  "gov",
  "mil",
  "int",
  "info",
  "biz",
  "co",
  "ac",
  "go",
  "or",
  "ne",
  "in",
];

function isSuffixLabel(label: string): boolean {
  return label.length === 2 || SUFFIX_LABELS.indexOf(label) !== -1;
}

/** `rocks-group` → `Rocks-Group`; `rocksgroup` → `Rocksgroup`. */
function capitalise(label: string): string {
  return label
    .split("-")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("-");
}

/**
 * The company label for an email address, or `null` when there is not one to be
 * had.
 *
 * `null` rather than a fallback string: the caller renders the second line only
 * when this answers, so an unreadable address drops the line rather than
 * printing a placeholder or a raw domain fragment under somebody's name.
 */
export function orgLabelFromEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;

  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at === -1) return null;

  const host = email.trim().toLowerCase().slice(at + 1);
  if (!host) return null;

  const labels = host.split(".").filter((l) => l.length > 0);
  if (labels.length === 0) return null;

  // Drop the suffix from the end — at most two labels, which covers `.com` and
  // `.co.th` alike. Never drop the last one standing: `x@localhost` should read
  // "Localhost" rather than nothing.
  while (labels.length > 1 && isSuffixLabel(labels[labels.length - 1])) {
    labels.pop();
  }
  // `x@co.th` reduces to the single label `co`, which is a suffix and not a
  // company. Nothing sensible is left, so say so.
  if (labels.length === 1 && isSuffixLabel(labels[0])) return null;

  return capitalise(labels[labels.length - 1]);
}
