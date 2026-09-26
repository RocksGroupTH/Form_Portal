import test from "node:test";
import assert from "node:assert/strict";
import {
  FORM_OWNER_TOKEN,
  parseFormMessage,
  expandFormMessage,
  messageBodyProblem,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_BLOCKS,
  MAX_BLOCK_CHARS,
} from "./form-message-text";

/* ── parseFormMessage ────────────────────────────────────────────────── */

test("a blank line separates two blocks", () => {
  assert.deepEqual(parseFormMessage("one\n\ntwo"), ["one", "two"]);
});

test("a SINGLE newline stays inside one block — the rule AP-4 depends on", () => {
  assert.deepEqual(parseFormMessage("line one\nline two"), ["line one\nline two"]);
});

test("three or more newlines still separate exactly one boundary", () => {
  assert.deepEqual(parseFormMessage("a\n\n\n\nb"), ["a", "b"]);
});

test("CRLF is normalised before splitting", () => {
  assert.deepEqual(parseFormMessage("a\r\n\r\nb"), ["a", "b"]);
});

test("leading and trailing blank lines produce no empty blocks", () => {
  assert.deepEqual(parseFormMessage("\n\n  a  \n\n"), ["a"]);
});

test("a body of only whitespace is no blocks at all", () => {
  assert.deepEqual(parseFormMessage("   \n\n  \n "), []);
});

test("null and undefined are no blocks, not a crash", () => {
  assert.deepEqual(parseFormMessage(null), []);
  assert.deepEqual(parseFormMessage(undefined), []);
});

test("inner whitespace of a block is preserved — only the outer is trimmed", () => {
  assert.deepEqual(parseFormMessage("a\n  indented\n\nb"), ["a\n  indented", "b"]);
});

/* ── expandFormMessage ───────────────────────────────────────────────── */

const ONE = [{ email: "kanjanaporn.n@rocksgroup.com", displayName: "Kan Kanjanaporn Nabklang" }];
const TWO = [
  { email: "a@rocksgroup.com", displayName: "Ay One" },
  { email: "b@rocksgroup.com", displayName: "Bee Two" },
];

test("the token expands to name and address", () => {
  assert.deepEqual(
    expandFormMessage(`ติดต่อ: ${FORM_OWNER_TOKEN}`, ONE),
    ["ติดต่อ: Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)"],
  );
});

test("several owners are comma-joined", () => {
  assert.deepEqual(
    expandFormMessage(FORM_OWNER_TOKEN, TWO),
    ["Ay One (a@rocksgroup.com), Bee Two (b@rocksgroup.com)"],
  );
});

test("an owner with no display name renders as the bare address", () => {
  assert.deepEqual(
    expandFormMessage(FORM_OWNER_TOKEN, [{ email: "c@rocksgroup.com", displayName: null }]),
    ["c@rocksgroup.com"],
  );
});

test("with NO owners the token empties AND the trailing colon is trimmed", () => {
  assert.deepEqual(
    expandFormMessage(`กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ${FORM_OWNER_TOKEN}`, []),
    ["กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม"],
  );
});

test("a trailing · is trimmed too", () => {
  assert.deepEqual(expandFormMessage(`ถาม · ${FORM_OWNER_TOKEN}`, null), ["ถาม"]);
});

test("a block that is ONLY the token, with no owners, is dropped", () => {
  assert.deepEqual(expandFormMessage(`keep\n\n${FORM_OWNER_TOKEN}`, []), ["keep"]);
});

test("the token expands at every occurrence", () => {
  assert.deepEqual(
    expandFormMessage(`${FORM_OWNER_TOKEN} / ${FORM_OWNER_TOKEN}`, ONE),
    [
      "Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com) / "
        + "Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)",
    ],
  );
});

test("a mistyped token is left completely alone", () => {
  assert.deepEqual(expandFormMessage("ติดต่อ {เจ้าของform}", ONE), ["ติดต่อ {เจ้าของform}"]);
});

test("an owner row with a blank address is dropped, not rendered as empty brackets", () => {
  assert.deepEqual(
    expandFormMessage(FORM_OWNER_TOKEN, [{ email: "   ", displayName: "Ghost" }, ...ONE]),
    ["Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)"],
  );
});

/* ── messageBodyProblem ──────────────────────────────────────────────── */

test("an empty body is acceptable — it means no notice", () => {
  assert.equal(messageBodyProblem(""), null);
});

test("a body at exactly the character bound passes", () => {
  // Five blocks, each inside the per-block bound, summing to exactly 5,000
  // WITH the four blank-line separators counted. A single 5,000-char block
  // would trip MAX_BLOCK_CHARS first and test the wrong bound.
  const body = [
    "x".repeat(1000),
    "x".repeat(998),
    "x".repeat(998),
    "x".repeat(998),
    "x".repeat(998),
  ].join("\n\n");
  assert.equal(body.length, MAX_MESSAGE_CHARS);
  assert.equal(messageBodyProblem(body), null);
});

test("one character over the body bound is refused", () => {
  const over = [
    "x".repeat(1000),
    "x".repeat(999),
    "x".repeat(998),
    "x".repeat(998),
    "x".repeat(998),
  ].join("\n\n");
  assert.equal(over.length, MAX_MESSAGE_CHARS + 1);
  assert.ok(messageBodyProblem(over));
});

test("exactly the block limit passes and one more is refused", () => {
  const at = Array.from({ length: MAX_MESSAGE_BLOCKS }, (_, i) => `b${i}`).join("\n\n");
  assert.equal(messageBodyProblem(at), null);
  const over = Array.from({ length: MAX_MESSAGE_BLOCKS + 1 }, (_, i) => `b${i}`).join("\n\n");
  assert.ok(messageBodyProblem(over));
});

test("a single over-long block is refused even when the whole body fits", () => {
  assert.ok(messageBodyProblem("y".repeat(MAX_BLOCK_CHARS + 1)));
});

test("every refusal is Thai, so it can be shown to the admin as-is", () => {
  const msg = messageBodyProblem("x".repeat(MAX_MESSAGE_CHARS + 1));
  assert.ok(msg && /[฀-๿]/.test(msg));
});
