/*
 * Google Gemini (AI Studio API) client, server-only.
 *
 * Uses Gemini's native generateContent API, not its OpenAI-compatible one, so
 * the system prompt goes in `systemInstruction` and any "thinking" parts are
 * dropped from the answer.
 *
 * MODEL FALLBACK: when tested, three of four current models answered 503
 * "high demand" while one worked, and older ones are retired (404). So
 * GEMINI_MODEL takes a comma-separated list, and a busy (429/5xx) or retired
 * (404) model moves on to the next one. Any other error (bad key, bad request)
 * stops at once rather than burning through the list.
 *
 * The key is read from GEMINI_API_KEY and sent in the x-goog-api-key header,
 * never in the URL (URLs end up in logs).
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];
const TRY_NEXT = new Set([404, 429, 500, 502, 503, 504]);

export function geminiModels(): string[] {
  const raw = process.env.GEMINI_MODEL;
  const list = raw ? raw.split(",").map((m) => m.trim()).filter(Boolean) : [];
  return list.length ? list : DEFAULT_MODELS;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

export async function geminiChat(opts: {
  system: string;
  history: ChatTurn[];
  question: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; model: string; tried: string[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  // Gemini calls the assistant side "model".
  const contents = [...opts.history, { role: "user" as const, content: opts.question }].map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));

  const tried: string[] = [];
  let lastError = "";

  for (const model of geminiModels()) {
    tried.push(model);
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents,
          // Room for any internal reasoning on top of a ~350-token answer.
          generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens ?? 1024 },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
    } catch (e) {
      lastError = `${model}: ${e instanceof Error ? e.message : "network error"}`;
      continue;
    }

    if (!res.ok) {
      const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
      lastError = `${model} ${res.status}: ${detail}`;
      if (TRY_NEXT.has(res.status)) continue;
      throw new Error(`Gemini ${lastError}`);
    }

    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${data.promptFeedback.blockReason})`);
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      lastError = `${model}: empty answer (${candidate?.finishReason ?? "no candidate"})`;
      continue;
    }
    return { text, model, tried };
  }

  throw new Error(`Gemini: no model answered (${lastError})`);
}
