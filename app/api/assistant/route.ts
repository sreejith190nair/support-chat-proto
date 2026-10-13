import { geminiChat, geminiModels, type ChatTurn } from "@/lib/ai/gemini";
import { ARTICLES, ISSUES } from "@/lib/catalog";

/*
 * The offline assistant. Runs on the server so the Hugging Face token never
 * reaches a browser (in the real product this would be a Laravel endpoint or
 * queued job, never a key in the widget).
 *
 * Grounded on purpose: the model only sees our own categories, issues and help
 * articles, and is told to say "raise a ticket" rather than guess. Personal
 * data (card numbers, emails, phone numbers) is stripped before anything
 * leaves for the provider.
 *
 * No HF_TOKEN, or the provider fails → a deterministic answer built from the
 * best-matching articles, so the demo works offline.
 */

type Turn = { role: "user" | "assistant"; text: string };

const HF_URL = "https://router.huggingface.co/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/Llama-3.1-8B-Instruct";

function redact(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const out = text
    .replace(/(?:\d[ -]?){13,19}/g, () => ((redacted = true), "[card number removed]"))
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => ((redacted = true), "[email removed]"))
    .replace(/\+?\d[\d ()-]{8,}\d/g, () => ((redacted = true), "[phone removed]"));
  return { text: out.slice(0, 1500), redacted };
}

const STOP = new Set(["the", "and", "for", "how", "why", "what", "can", "does", "with", "this", "that", "from", "our", "are", "not", "you", "your", "but", "any", "its", "then", "when", "into", "has", "have"]);

/** Crude stemming, enough that "rates" finds "rate" and "creating" finds "create". */
function stem(w: string) {
  let s = w;
  for (let i = 0; i < 2; i++) {
    const next = s.length > 4 ? s.replace(/(ing|ed|es|s|e)$/, "") : s;
    if (next === s) break;
    s = next;
  }
  return s;
}

function words(s: string) {
  // "Booking.com" is a channel, not a booking: keep it one token.
  const text = s.toLowerCase().replace(/booking\.com/g, "bookingcom");
  return (text.match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

/**
 * Articles for THIS question, and only for it. A title or keyword hit counts
 * three times a summary hit, so "login" finds the user articles and "rates?"
 * the rate articles whatever issue was picked first.
 *
 * NO GUESSING: when nothing matches strongly, this returns nothing, and the
 * caller asks the user to pick a category instead of answering from the
 * picked issue or the previous question (which is how "login" got booking
 * steps).
 */
function pickArticles(question: string): string[] {
  const q = new Set(words(question));
  if (!q.size) return [];
  return Object.entries(ARTICLES)
    .map(([path, a]) => {
      const strong = new Set(words(`${a.title} ${(a.keywords ?? []).join(" ")}`));
      const summary = new Set(words(a.summary));
      let score = 0;
      for (const w of q) score += strong.has(w) ? 3 : summary.has(w) ? 1 : 0;
      return { path, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.path);
}

const CLARIFY = "I couldn't match that to one of our help topics. Which area is it about?";

function fallbackAnswer(_topic: string, paths: string[]): string {
  if (!paths.length) {
    return "I couldn't find a help article for this one. Please raise a ticket and our team will pick it up when they're back.";
  }
  const steps = paths.slice(0, 3).map((p, i) => `${i + 1}. ${ARTICLES[p].title}: ${ARTICLES[p].summary}`);
  return `Here's what our help articles say:\n${steps.join("\n")}\n\nIf that doesn't fix it, raise a ticket and our team will follow up.`;
}

/**
 * Menu paths ("Channel Manager → Rates") the answer uses that no article
 * contains. A hotel follows these literally, so an invented one is the most
 * damaging thing the model can say.
 */
function inventedMenuPaths(answer: string, paths: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s*(→|->|>)\s*/g, "→").replace(/[^a-z0-9→ ]/g, "").replace(/\s+/g, " ").trim();
  // Summaries only: an article TITLE ("Setting up rate plans") is not a screen,
  // so it must not vouch for a "Rate Plans" section the model made up.
  // Deliberately NOT the user's own words: "Click on \"Reset 2FA\"" turns their phrase
  // into a button that doesn't exist. A false alarm only shows the article text instead.
  const known = norm(paths.map((p) => ARTICLES[p].summary).join(" "));
  // A path is Capitalised Menu Names joined by arrows, so surrounding prose
  // ("Re-send rates from Channel Manager → Rates") is not swept into it.
  const name = String.raw`[A-Z][\w'-]*(?: [A-Z&][\w'-]*)*`;
  const arrows = answer.match(new RegExp(`${name}(?:\\s*(?:→|->)\\s*${name})+`, "g")) ?? [];
  // "Open Channel Manager → Rates": a leading verb is not part of the path, so
  // the path counts as known if it is known once leading words are dropped.
  const pathKnown = (m: string) => {
    const parts = m.split(" ");
    for (let i = 0; i < parts.length; i++) {
      const tail = parts.slice(i).join(" ");
      if (!/→|->/.test(tail)) return false;
      if (known.includes(norm(tail))) return true;
    }
    return false;
  };
  // Quoted labels read as buttons or menus ("New Booking"), so they must exist too.
  const quoted = [...answer.matchAll(/["“']([A-Z][^"”']{1,40})["”']/g)].map((m) => m[1]);
  return [...arrows.filter((m) => !pathKnown(m)), ...quoted.filter((m) => !known.includes(norm(m)))];
}

type Provider =
  | { name: "gemini"; label: string; model: string }
  | { name: "ollama" | "huggingface"; label: string; url: string; token?: string; model: string };

/**
 * Which model answers, chosen by AI_PROVIDER in .env.local:
 *   AI_PROVIDER=gemini       Google Gemini (GEMINI_API_KEY, models in GEMINI_MODEL)
 *   AI_PROVIDER=ollama       a free model on this machine (nothing leaves it)
 *   AI_PROVIDER=huggingface  Hugging Face Inference Providers (needs credits)
 * Unset: Hugging Face when HF_TOKEN is present, otherwise no model at all.
 * A chosen provider without its key also means no model: the article fallback answers.
 */
function provider(): Provider | null {
  const choice = process.env.AI_PROVIDER ?? (process.env.HF_TOKEN ? "huggingface" : "");
  if (choice === "gemini" && process.env.GEMINI_API_KEY) {
    return { name: "gemini", label: "Gemini", model: geminiModels()[0] };
  }
  if (choice === "ollama") {
    const base = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
    return { name: "ollama", label: "Ollama", url: `${base}/v1/chat/completions`, model: process.env.OLLAMA_MODEL || "llama3.2:3b" };
  }
  if (choice === "huggingface" && process.env.HF_TOKEN) {
    return { name: "huggingface", label: "Hugging Face", url: HF_URL, token: process.env.HF_TOKEN, model: process.env.HF_MODEL || DEFAULT_MODEL };
  }
  return null;
}

/** Ollama and Hugging Face both speak the OpenAI-style chat API. */
async function openAiCompatibleChat(
  llm: Extract<Provider, { url: string }>,
  system: string,
  history: ChatTurn[],
  question: string,
): Promise<string> {
  const res = await fetch(llm.url, {
    method: "POST",
    headers: { ...(llm.token ? { Authorization: `Bearer ${llm.token}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: llm.model,
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: question }],
      max_tokens: 350,
      temperature: 0.2,
    }),
    // A local model's first answer includes loading it into memory.
    signal: AbortSignal.timeout(llm.name === "ollama" ? 90_000 : 20_000),
  });
  if (!res.ok) throw new Error(`${llm.label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("empty answer");
  return answer;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { topic?: string; entity?: string; question?: string; history?: Turn[]; useTopic?: boolean } | null;
  const topic = body?.topic ?? "other.general";
  const { text: question, redacted } = redact(String(body?.question ?? "").trim());
  if (!question) return Response.json({ error: "Ask a question first." }, { status: 422 });

  // The user tapped an issue from the category chips: answer from that issue's
  // own articles. Otherwise search for what they typed.
  const paths = body?.useTopic ? (ISSUES[topic]?.articles ?? []) : pickArticles(question);
  const sources = paths.map((path) => ({ path, title: ARTICLES[path].title }));

  // Nothing to ground on: the model is never asked to answer from imagination.
  if (!paths.length) {
    return body?.useTopic
      ? Response.json({ answer: fallbackAnswer(topic, paths), sources, mode: "fallback", reason: "this issue has no help article yet", redacted })
      : Response.json({ answer: CLARIFY, sources, mode: "clarify", reason: "no matching help article, model not called", redacted });
  }

  const llm = provider();
  if (!llm) {
    return Response.json({ answer: fallbackAnswer(topic, paths), sources, mode: "fallback", reason: "no AI provider configured", redacted });
  }
  let model = llm.model;

  const issue = ISSUES[topic];
  const articleText = paths.map((p) => `- ${ARTICLES[p].title}: ${ARTICLES[p].summary}`).join("\n");
  const system = [
    "You are the 4ROOMS PMS support assistant. Human support agents are offline right now.",
    "Answer the hotel user's LATEST question using ONLY the help articles below. Do not invent menus, buttons, websites, settings or features.",
    "Every step must come from an article. If an article has only one sentence on it, give only that; never pad with general advice.",
    "The user may have moved on from the issue they first picked: answer what they ask now.",
    "Keep it short: at most 5 numbered steps, plain text, no markdown headings.",
    "Don't refer to the articles themselves (no \"article 2\", no \"according to the help articles\"): just give the steps. The user sees the article links separately.",
    "If the articles don't cover the question, say so plainly and suggest raising a ticket.",
    "If the user says they already tried the steps, don't repeat them: say what is left to check, if anything, and suggest raising a ticket so the team can look at their account.",
    "Number steps from 1.",
    "Never ask for or repeat card numbers, passport details, guest names or contact details.",
    "Never promise refunds, fixes or timelines. Reply in the same language as the user.",
    "",
    `Issue first picked: ${issue ? `${issue.category} › ${issue.label}` : "General"}${body?.entity ? ` (about ${body.entity})` : ""}`,
    "Help articles:",
    articleText || "(none found)",
  ].join("\n");

  const history: ChatTurn[] = (body?.history ?? []).slice(-6).map((t) => ({ role: t.role, content: redact(t.text).text }));

  try {
    let answer: string;
    if (llm.name === "gemini") {
      const out = await geminiChat({ system, history, question });
      answer = out.text;
      model = out.model; // whichever model in GEMINI_MODEL actually answered
    } else {
      answer = await openAiCompatibleChat(llm, system, history, question);
    }
    const invented = inventedMenuPaths(answer, paths);
    if (invented.length) {
      return Response.json({
        answer: fallbackAnswer(topic, paths),
        sources,
        mode: "fallback",
        reason: `${model} invented a menu path ("${invented[0]}"), answer replaced`,
        redacted,
      });
    }
    return Response.json({ answer, sources, mode: llm.name, model, redacted });
  } catch (e) {
    return Response.json({
      answer: fallbackAnswer(topic, paths),
      sources,
      mode: "fallback",
      reason: e instanceof Error ? e.message : "provider error",
      redacted,
    });
  }
}
