import "server-only";
import { resolveApiKey } from "@/lib/api-keys/service";
import {
  GL_SUGGEST_SYSTEM,
  RECEIPT_SYSTEM,
  RECEIPT_USER_TEXT,
  buildGlSuggestUserText,
  parseReceiptDocs,
  pickSuggestedGl,
  toNum,
  toStr,
  type GlCandidate,
  type ReceiptDoc,
} from "./ai-receipt-core";

/**
 * Optional AI (Claude vision) receipt extraction. Runs when a key is available
 * from the portal API-key registry (DB → env fallback via resolveApiKey). When
 * absent this is a no-op and the caller uses the free Tesseract+regex path.
 */

const MODEL = process.env.ANTHROPIC_RECEIPT_MODEL || "claude-haiku-4-5-20251001";

/**
 * Read every document in a receipt image (PNG/JPEG/WebP buffer) with Claude
 * vision. One image can hold several tax invoices, so this returns one entry per
 * invoice number — empty when the key is missing or the call/parse fails, so the
 * caller can fall back cleanly.
 */
export async function extractReceiptsWithAI(
  buffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png",
): Promise<ReceiptDoc[]> {
  try {
    const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
    if (!apiKey) return [];
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: RECEIPT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
            { type: "text", text: RECEIPT_USER_TEXT },
          ],
        },
      ],
    });
    const textPart = res.content.find((c) => c.type === "text");
    return parseReceiptDocs(textPart && "text" in textPart ? textPart.text : "");
  } catch {
    return [];
  }
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

const SLIP_SYSTEM = [
  "You read Thai/English bank transfer slips (PromptPay, mobile banking, eSavings) and return ONE JSON object only.",
  "No prose, no markdown fences. Use null when a value is not present — never guess.",
  "Rules:",
  '- amount: the transferred amount as a number in THB (no commas, no currency symbol).',
  '- date: the transaction date as "YYYY-MM-DD". Convert Buddhist year (พ.ศ.) to CE (−543).',
].join("\n");

const SLIP_USER_TEXT =
  'Extract this transfer slip. Return only JSON with keys: amount, date.';

type SlipAiJson = { amount?: number | string | null; date?: string | null };

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
    const date = toStr(j.date);
    if (amount == null && !date) return null;
    return { amount, date };
  } catch {
    return null;
  }
}
