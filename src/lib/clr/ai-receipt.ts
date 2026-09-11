import "server-only";
import { resolveApiKey } from "@/lib/api-keys/service";
import {
  BRANCH_SUGGEST_SYSTEM,
  GL_SUGGEST_SYSTEM,
  RECEIPT_SYSTEM,
  RECEIPT_USER_TEXT,
  THAI_DATE_RULES,
  buildBranchSuggestUserText,
  buildGlSuggestUserText,
  parseReceiptDocs,
  pickSuggestedBranch,
  pickSuggestedGl,
  thaiPrintedDate,
  toDate,
  toNum,
  type BranchCandidate,
  type BranchSuggestion,
  type GlCandidate,
  type ReceiptRead,
} from "./ai-receipt-core";
import { needsStrongerRead } from "./receipt-escalation";

/**
 * Optional AI (Claude vision) receipt extraction. Runs when a key is available
 * from the portal API-key registry (DB → env fallback via resolveApiKey). When
 * absent this is a no-op and the caller uses the free Tesseract+regex path.
 */

const MODEL = process.env.ANTHROPIC_RECEIPT_MODEL || "claude-haiku-4-5-20251001";

/**
 * The model a suspect read is retried with — OFF unless configured.
 *
 * It defaulted to claude-sonnet-5, which reads a receipt perhaps ten times the
 * price of the small model. The trigger is narrow enough that most uploads
 * never reached it (`needsStrongerRead`: a VAT invoice whose seller tax id came
 * back empty, which the law says cannot happen — so the read was wrong, and a
 * rotated tax invoice is what earned the retry). Even so, the decision is that
 * this shop does not send receipts to the larger model at all (user,
 * 2026-09-12).
 *
 * What is given up: the rotated-invoice case now keeps the small model's
 * answer, tax id empty, and the account grid's own registry check is where it
 * gets caught.
 *
 * Set ANTHROPIC_RECEIPT_MODEL_ESCALATE to a model name to turn it back on —
 * no code change, and nothing else in this file needs to know.
 */
const ESCALATE_MODEL = process.env.ANTHROPIC_RECEIPT_MODEL_ESCALATE || MODEL;

/**
 * The ceiling on one reply.
 *
 * It was 4096, and that is what "AI อ่านได้ใบเดียว" was the whole time. A
 * nine-page bundle of nine invoices answers with more JSON than that, the reply
 * stops mid-entry, the array never closes, and `parseReceiptDocs` gets nothing
 * it can parse — so a read that saw everything returned one row, or none, and
 * said nothing about it. Measured on that bundle: stop_reason `max_tokens` and
 * zero rows at 4096; `end_turn`, 4,431 output tokens and seven rows at 8192.
 *
 * Not a cost: max_tokens is a ceiling, and a reply that needs 4,431 is billed
 * for 4,431 whatever this says.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Deliberately no `temperature`.
 *
 * Setting it to 0 is the obvious way to stop the same receipt reading three
 * different ways, and it does — on one invoice. On the nine-invoice bundle it
 * degenerates: greedy decoding falls into a repetition loop partway through a
 * Thai address and emits "นนนนนน…" until it runs out of tokens, 16,384 of them,
 * returning nothing. Measured 2026-09-12, the same file that reads cleanly in
 * 4,431 tokens with the parameter left alone (user: "ถ้าใส่ temperature 0 ถ้า 1
 * ไฟล์มีหลายใบกำกับ AI อ่านไม่ได้" — it was already true).
 *
 * So the run-to-run spread stays, and the answer to it is the two-block
 * transcription above plus the checks on the account grid, not the sampler.
 */
async function readOnce(
  client: import("@anthropic-ai/sdk").default,
  body: Omit<import("@anthropic-ai/sdk").Anthropic.MessageCreateParamsNonStreaming, "max_tokens">,
): Promise<{ text: string; truncated: boolean }> {
  const res = await client.messages.create({ ...body, max_tokens: MAX_OUTPUT_TOKENS });
  const part = res.content.find((c) => c.type === "text");
  return {
    text: part && "text" in part ? part.text : "",
    /* The reply ran out of room. Every complete entry before the cut is real
       and the rest is gone, so the caller says so rather than presenting a
       short read as a whole one. */
    truncated: res.stop_reason === "max_tokens",
  };
}

/**
 * Read every document in an upload with Claude vision. `images` is one image, or
 * the consecutive pages of one PDF — they go in a single call so a tax invoice
 * printed across four pages is recognised as ONE document, not four. Returns one
 * entry per invoice number plus the count of pages that were neither a receipt
 * nor a slip; an empty read means the key is missing or the call/parse failed, so
 * the caller can fall back cleanly.
 */
export async function extractReceiptsWithAI(
  images: Buffer[],
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png",
): Promise<ReceiptRead> {
  const nothing: ReceiptRead = { docs: [], skippedPages: 0, branchHint: null };
  if (images.length === 0) return nothing;
  try {
    const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
    if (!apiKey) return nothing;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const res = await readOnce(client, {
      model: MODEL,
      system: RECEIPT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: mediaType, data: img.toString("base64") },
            })),
            { type: "text" as const, text: RECEIPT_USER_TEXT },
          ],
        },
      ],
    });
    const first = { ...parseReceiptDocs(res.text), replyTruncated: res.truncated };

    // A VAT invoice whose seller tax id came back empty was misread, not
    // unlabelled — read it again with the stronger model. Once only, and only
    // for the documents that earned it.
    if (ESCALATE_MODEL !== MODEL && needsStrongerRead(first.docs)) {
      try {
        const retry = await readWithModel(client, images, mediaType, ESCALATE_MODEL);
        // Keep the better answer, not merely the newer one: if the second pass
        // reads nothing, the first is still what we had.
        if (retry.docs.length > 0) return retry;
      } catch { /* the first read stands */ }
    }
    return first;
  } catch {
    return nothing;
  }
}

/** One vision call for the pages of a single upload. */
async function readWithModel(
  client: import("@anthropic-ai/sdk").default,
  images: Buffer[],
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif",
  model: string,
): Promise<ReceiptRead> {
  const res = await readOnce(client, {
    model,
    system: RECEIPT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: mediaType, data: img.toString("base64") },
          })),
          { type: "text" as const, text: RECEIPT_USER_TEXT },
        ],
      },
    ],
  });
  return { ...parseReceiptDocs(res.text), replyTruncated: res.truncated };
}

/**
 * Suggest ONE expense account for a receipt description (§10). `candidates` must
 * already be the branch-filtered set the line is allowed to charge — the model
 * only ever chooses from it, and anything it answers that is not in the list is
 * dropped here. Returns "" when there is nothing to suggest; advisory only.
 */
export async function suggestGlAccountWithAI(
  description: string,
  candidates: GlCandidate[],
): Promise<string> {
  const text = description.trim();
  if (!text || candidates.length === 0) return "";
  try {
    const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
    if (!apiKey) return "";
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 32,
      system: GL_SUGGEST_SYSTEM,
      messages: [{ role: "user", content: buildGlSuggestUserText(text, candidates) }],
    });
    const textPart = res.content.find((c) => c.type === "text");
    const raw = textPart && "text" in textPart ? textPart.text : "";
    return pickSuggestedGl(raw, candidates.map((c) => c.glAccountNo));
  } catch {
    return "";
  }
}

/**
 * Suggest ONE branch for an upload from the note saying what the spend was for.
 * `candidates` is the brand's whole BRANCH list, built on the server; anything
 * the model answers that is not in it is dropped, so the reviewer is never
 * offered a branch they could not have picked by hand. Advisory and editable —
 * `close` says the model had near-ties, which the modal marks for the eye.
 */
export async function suggestBranchWithAI(
  hint: string,
  candidates: BranchCandidate[],
): Promise<BranchSuggestion> {
  const none: BranchSuggestion = { code: "", close: false };
  const text = hint.trim();
  if (!text || candidates.length === 0) return none;
  try {
    const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
    if (!apiKey) return none;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 64,
      system: BRANCH_SUGGEST_SYSTEM,
      messages: [{ role: "user", content: buildBranchSuggestUserText(text, candidates) }],
    });
    const textPart = res.content.find((c) => c.type === "text");
    const raw = textPart && "text" in textPart ? textPart.text : "";
    return pickSuggestedBranch(raw, candidates.map((c) => c.code));
  } catch {
    return none;
  }
}

const SLIP_SYSTEM = [
  "You read Thai/English bank transfer slips (PromptPay, mobile banking, eSavings) and return ONE JSON object only.",
  "No prose, no markdown fences. Use null when a value is not present — never guess.",
  "Rules:",
  '- amount: the transferred amount as a number in THB (no commas, no currency symbol).',
  "- date: the transaction date.",
  "- dateText: that same date copied character for character, exactly as printed on the slip",
  '  — "08 ก.ย. 2026". Do not reformat it or convert the year; it is read by rule on our side.',
  "Reading a date:",
  THAI_DATE_RULES,
].join("\n");

const SLIP_USER_TEXT =
  'Extract this transfer slip. Return only JSON with keys: amount, date, dateText.';

type SlipAiJson = { amount?: number | string | null; date?: string | null; dateText?: string | null };

export interface SlipAiResult {
  amount: number | null;
  date: string | null;
}

/**
 * Extract transfer amount + date from a bank slip image using Claude vision.
 * Returns null when the key is missing or the call/parse fails — caller falls back to Tesseract.
 */
export async function extractSlipWithAI(
  buffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png",
): Promise<SlipAiResult | null> {
  try {
    const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
    if (!apiKey) return null;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SLIP_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
            { type: "text", text: SLIP_USER_TEXT },
          ],
        },
      ],
    });
    const textPart = res.content.find((c) => c.type === "text");
    const raw = textPart && "text" in textPart ? textPart.text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const j = JSON.parse(match[0]) as SlipAiJson;
    const amount = toNum(j.amount);
    // Same rule as the bundle path: the month comes off the printed text when
    // we can read it, and only falls back to the model's own conversion.
    const date = toDate(thaiPrintedDate(j.dateText) ?? j.date);
    if (amount == null && !date) return null;
    return { amount, date };
  } catch {
    return null;
  }
}
