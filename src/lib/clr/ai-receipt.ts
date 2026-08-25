import "server-only";
import { resolveApiKey } from "@/lib/api-keys/service";
import type { ReceiptExtractResult } from "./slip-verify";

/**
 * Optional AI (Claude vision) receipt extraction. Runs when a key is available
 * from the portal API-key registry (DB → env fallback via resolveApiKey). When
 * absent this is a no-op and the caller uses the free Tesseract+regex path.
 */

const MODEL = process.env.ANTHROPIC_RECEIPT_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM = [
  "You read Thai/English receipts & tax invoices and return ONE JSON object only.",
  "No prose, no markdown fences. Use null when a value is not present — never guess.",
  "Rules:",
  '- date: the document date as "YYYY-MM-DD". Convert Buddhist year (พ.ศ.) to CE (−543).',
  "- description: the main item/service description (keep original language).",
  "- docNo: document / tax-invoice number.",
  "- amountBeforeVat, vat, wht: numbers in THB (no commas). wht = ภาษีหัก ณ ที่จ่าย amount.",
  "- taxId: payee 13-digit tax id, digits only.",
  "- payeeName, payeeAddress: the seller/payee name and address (original language).",
].join("\n");

const USER_TEXT =
  'Extract this receipt. Return only JSON with keys: date, description, docNo, ' +
  'amountBeforeVat, vat, wht, taxId, payeeName, payeeAddress.';

type AiJson = {
  date?: string | null;
  description?: string | null;
  docNo?: string | null;
  amountBeforeVat?: number | string | null;
  vat?: number | string | null;
  wht?: number | string | null;
  taxId?: string | null;
  payeeName?: string | null;
  payeeAddress?: string | null;
};

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function toStr(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, 300) : null;
}

/**
 * Extract a receipt image (PNG/JPEG/WebP buffer) with Claude vision. Returns the
 * same shape as the Tesseract path (+ payeeAddress). Returns null when the key is
 * missing or the call/parse fails, so the caller can fall back cleanly.
 */
export async function extractReceiptWithAI(
  buffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png",
): Promise<ReceiptExtractResult | null> {
  try {
    const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
    if (!apiKey) return null;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
            { type: "text", text: USER_TEXT },
          ],
        },
      ],
    });
    const textPart = res.content.find((c) => c.type === "text");
    const raw = textPart && "text" in textPart ? textPart.text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const j = JSON.parse(match[0]) as AiJson;

    const beforeVat = toNum(j.amountBeforeVat);
    const vat = toNum(j.vat);
    return {
      date: toStr(j.date),
      description: toStr(j.description),
      docNo: toStr(j.docNo),
      wht: toNum(j.wht),
      taxId: j.taxId ? String(j.taxId).replace(/\D/g, "").slice(0, 13) || null : null,
      payeeName: toStr(j.payeeName),
      payeeAddress: toStr(j.payeeAddress),
      total: beforeVat != null ? Math.round((beforeVat + (vat ?? 0)) * 100) / 100 : null,
      vat,
      beforeVat,
      amounts: [beforeVat, vat].filter((n): n is number => n != null),
    };
  } catch {
    return null;
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
