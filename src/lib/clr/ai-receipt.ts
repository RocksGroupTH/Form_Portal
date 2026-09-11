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
 * Reading a receipt is transcription, so there is nothing for sampling to be
 * creative about — and nothing set this, which means every call ran at the
 * SDK default of 1.0. That is why one nine-page bundle came back as one row on
 * one run, six on the next and seven on the one after, with ฿1,344.60 on a page
 * reading as ฿1,256.64 the second time: a claim whose total depends on when it
 * was uploaded (user, 2026-09-11).
 *
 * It does not make the model right, only repeatable — the same pages give the
 * same answer, so a wrong read can be reproduced and fixed rather than argued
 * about. Nothing else about the call changes.
 */
const READ_TEMPERATURE = 0;

/**
 * The model a suspect read is retried with. Most receipts never reach it: see
 * `needsStrongerRead` for the one signal that sends them, and what a rotated
 * tax invoice did to the small model to earn it.
 *
 * Set to the same value as MODEL to turn escalation off.
 */
const ESCALATE_MODEL = process.env.ANTHROPIC_RECEIPT_MODEL_ESCALATE || "claude-sonnet-5";

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
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: READ_TEMPERATURE,
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
    const textPart = res.content.find((c) => c.type === "text");
    const first = parseReceiptDocs(textPart && "text" in textPart ? textPart.text : "");

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
  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: READ_TEMPERATURE,
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
  const textPart = res.content.find((c) => c.type === "text");
  return parseReceiptDocs(textPart && "text" in textPart ? textPart.text : "");
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
      temperature: READ_TEMPERATURE,
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
      temperature: READ_TEMPERATURE,
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
      temperature: READ_TEMPERATURE,
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
