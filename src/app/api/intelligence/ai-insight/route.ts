import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const BRAND_COMPETITORS: Record<string, string[]> = {
  UNO: ["One to Two Coffee", "Pacamara Coffee", "Brave Roasters", "Gallery Coffee Drip"],
  KSI: ["MK Restaurants", "Shabushi", "Bar-B-Q Plaza"],
};

const SYSTEM_PROMPT = (dashboard: string, brand: string, period: string, competitors: string[]) =>
  `You are a senior business analyst for "${brand}" (a coffee & restaurant brand in Thailand). Analyze the "${dashboard}" dashboard data for the period "${period}".

${competitors.length ? `Key competitors: ${competitors.join(", ")}.

Use web search to find competitor intelligence for the same period ("${period}"):
- Active promotions, discounts, or campaigns (e.g., buy-1-get-1, loyalty programs, seasonal drinks)
- New product launches or menu changes
- Store openings, closings, or expansion plans
- Pricing changes or value deals
- Social media campaigns or viral moments
- Any news that could impact ${brand}'s market share

Compare competitor activity against ${brand}'s performance data to identify threats or opportunities.` : ""}`;

function buildPrompt(
  kpis: Record<string, string | number>,
  vsKpis?: Record<string, string | number> | null,
  summary?: string,
  dailyTrend?: string,
) {
  let prompt = `Current KPIs:\n${Object.entries(kpis).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;

  if (vsKpis) {
    prompt += `\n\nComparison Period KPIs:\n${Object.entries(vsKpis).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
  }
  if (summary) {
    prompt += `\n\nAdditional Data:\n${summary}`;
  }
  if (dailyTrend) {
    prompt += `\n\nDaily Trend:\n${dailyTrend}`;
  }

  prompt += `\n\nRespond ONLY with a JSON object in this exact format:
{
  "headline": "One bold sentence summarizing the most important finding",
  "summary": "2-3 sentence executive summary covering the key story in the data",
  "findings": [
    {"type":"trend","title":"Short Title","body":"One sentence with specific numbers.","metric":"฿16M","change":"+5.2%"},
    {"type":"competitor","title":"Competitor Insight","body":"What competitor did and recommended action."}
  ]
}

findings array: 4-6 items. Each must have:
- "type": "trend" | "opportunity" | "warning" | "action" | "competitor"
- "title": max 6 words
- "body": 1 sentence with specific numbers
- "metric": (optional) key number to highlight (e.g. "฿16M", "122K", "65%")
- "change": (optional) % change (e.g. "+5.2%", "-3.1%")

Include 1-2 "competitor" type findings based on web search — focus on promotions, pricing, launches.

Rules:
- Use Thai Baht (฿) for currency
- Be specific with numbers
- Return ONLY the JSON object, no markdown or extra text`;

  return prompt;
}

function parseInsights(text: string) {
  // Strip markdown code blocks
  let cleaned = text.replace(/```(?:json)?\s*\n?/gi, "").replace(/\n?```/gi, "").trim();
  // Extract JSON object or array if surrounded by other text
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) cleaned = jsonMatch[1];
  return JSON.parse(cleaned);
}

async function callClaude(systemPrompt: string, userPrompt: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    tools: [
      { type: "web_search_20250305" as const, name: "web_search", max_uses: 3 },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function callOpenAI(systemPrompt: string, userPrompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return res.choices[0]?.message?.content ?? "";
}

async function callGemini(systemPrompt: string, userPrompt: string) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  const res = await model.generateContent({
    systemInstruction: systemPrompt,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
  });

  return res.response.text();
}

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const body = await req.json();
  const { dashboard, brand, period, kpis, vsKpis, summary, dailyTrend, dateRange, provider = "claude" } = body as {
    dashboard: string;
    brand: string;
    period: string;
    kpis: Record<string, string | number>;
    vsKpis?: Record<string, string | number> | null;
    summary?: string;
    dailyTrend?: string;
    dateRange?: string;
    provider?: string;
  };

  const competitors = BRAND_COMPETITORS[brand] ?? [];
  const periodLabel = dateRange ? `${period} (${dateRange})` : period;
  const systemPrompt = SYSTEM_PROMPT(dashboard, brand, periodLabel, competitors);
  const userPrompt = buildPrompt(kpis, vsKpis, summary, dailyTrend);

  try {
    let text: string;
    switch (provider) {
      case "openai":
        text = await callOpenAI(systemPrompt, userPrompt);
        break;
      case "gemini":
        text = await callGemini(systemPrompt, userPrompt);
        break;
      default:
        text = await callClaude(systemPrompt, userPrompt);
    }

    try {
      const parsed = parseInsights(text);
      // Support both new format { headline, summary, findings } and old format [...]
      if (Array.isArray(parsed)) {
        return NextResponse.json({ ok: true, data: { report: { headline: null, summary: null, findings: parsed } } });
      }
      return NextResponse.json({ ok: true, data: { report: parsed } });
    } catch {
      return NextResponse.json({ ok: true, data: { report: null, fallbackText: text } });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
