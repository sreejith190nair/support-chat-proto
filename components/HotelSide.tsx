"use client";

import { useEffect, useRef, useState } from "react";
import { ARTICLES, CATEGORIES, ENTITIES, ISSUES, PRIYA, type Category, type Issue } from "@/lib/catalog";
import { eventText, issueLabel, ordinal, STATUS_STYLE } from "@/lib/format";
import { clock, newKey, useChannels, useNow, usePoll, useSideSnapshot } from "@/lib/hooks";
import { chatChannel, containsCardNumber, isLive, queuePosition, store } from "@/lib/store";
import type { Attachment, Chat, HotelUser, Message, State } from "@/lib/types";

type View =
  | { name: "home" }
  | { name: "issues"; category: Category }
  | { name: "selfhelp"; issue: Issue; entity?: string }
  | { name: "compose"; issue: Issue; entity?: string }
  | { name: "offline"; issue?: Issue; entity?: string }
  | { name: "solved" }
  | { name: "ticket"; number: string }
  | { name: "myissues" };

const WHO = "Hotel (Priya)";
const MAX_BODY = 2000;

const OFFLINE_REASON: Record<string, string> = {
  outside_hours: "Our team is offline right now. Live chat is open Mon–Fri, 08:00–20:00.",
  paused: "Live chat is paused for a moment. Please raise a ticket and we'll reply there.",
  no_agent: "No agent is available right now. Raise a ticket and we'll reply there.",
};

export default function HotelSide() {
  const user = PRIYA;
  const [snap, refresh] = useSideSnapshot();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ name: "home" });
  const [viewChatId, setViewChatId] = useState<number | null>(null);

  const openChat = snap.chats.find((c) => c.openedByUserId === user.id && isLive(c));
  const chat = openChat ?? (viewChatId ? snap.chats.find((c) => c.id === viewChatId) : undefined);

  // Socket only while there is a chat to follow; no open chat means no socket and no polling.
  useChannels(chat ? [chatChannel(chat)] : [], WHO, refresh);
  usePoll(!!openChat, 4000, WHO, refresh);

  const unread = openChat
    ? snap.messages.filter(
        (m) => m.chatId === openChat.id && m.kind === "message" && m.authorType !== "tenant" && m.id > openChat.tenantLastSeenMessageId,
      ).length
    : 0;

  // Seen pointer advances only while the panel is open and the tab is visible.
  useEffect(() => {
    if (!open || !chat) return;
    const ids = snap.messages.filter((m) => m.chatId === chat.id && m.kind !== "note").map((m) => m.id);
    const max = ids.length ? Math.max(...ids) : 0;
    if (max > chat.tenantLastSeenMessageId && !document.hidden) {
      store.markSeen("tenant", chat.id, max);
      refresh();
    }
  }, [open, chat, snap.messages, refresh]);

  const openWidget = () => {
    setOpen(true);
    store.logHttp(WHO, "GET /support/chat/state (availability + open chat)");
    refresh();
  };

  const goHome = () => {
    setViewChatId(null);
    setView({ name: "home" });
    refresh();
  };

  return (
    <div className="relative h-full overflow-hidden bg-slate-100">
      <PmsBackdrop />

      {!open && (
        <button
          onClick={openWidget}
          className="absolute bottom-5 right-5 flex items-center gap-2 rounded-full bg-[#27374D] px-5 py-3 text-sm font-medium text-white shadow-xl hover:bg-[#1e2b3c]"
        >
          💬 Help
          {unread > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs">{unread}</span>}
          {!unread && openChat && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
        </button>
      )}

      {open && (
        <div className="absolute bottom-4 right-4 flex h-[580px] max-h-[calc(100%-2rem)] w-[370px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {chat ? (
            <ChatView
              snap={snap}
              chat={chat}
              user={user}
              refresh={refresh}
              onClose={() => setOpen(false)}
              onHome={goHome}
              onMyIssues={() => {
                setViewChatId(null);
                setView({ name: "myissues" });
              }}
              onSwitchChat={(id) => setViewChatId(id)}
            />
          ) : (
            <Flow
              snap={snap}
              user={user}
              view={view}
              setView={setView}
              refresh={refresh}
              onClose={() => setOpen(false)}
              onChatStarted={(id) => setViewChatId(id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ backdrop */

function PmsBackdrop() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between bg-[#27374D] px-4 py-2.5 text-sm text-white">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-wide">4ROOMS PMS</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs">Acme Hotel · Seaside ▾</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/80">
          <span>?</span>
          <span>🔔</span>
          <span>Priya Shah</span>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 content-start gap-3 p-4 opacity-60">
        {["Arrivals 12", "Departures 9", "In house 48"].map((x) => (
          <div key={x} className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow-sm">
            {x}
          </div>
        ))}
        <div className="col-span-3 h-40 rounded-lg bg-white shadow-sm" />
        <div className="col-span-2 h-32 rounded-lg bg-white shadow-sm" />
        <div className="h-32 rounded-lg bg-white shadow-sm" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- shared bits */

function Header({ title, onBack, onClose, sub }: { title: string; onBack?: () => void; onClose: () => void; sub?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-[#27374D] px-4 py-3 text-white">
      {onBack && (
        <button onClick={onBack} className="text-white/80 hover:text-white">
          ←
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        {sub && <div className="truncate text-xs text-white/70">{sub}</div>}
      </div>
      <button onClick={onClose} className="text-white/80 hover:text-white" title="Minimise">
        —
      </button>
    </div>
  );
}

function IncidentBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">⚠ {text}</div>;
}

function pickFiles(list: FileList | null, current: Attachment[]): { files: Attachment[]; error?: string } {
  if (!list) return { files: current };
  const out = [...current];
  for (const f of Array.from(list)) {
    if (/svg|html/i.test(f.type) || /\.(svg|html?)$/i.test(f.name)) return { files: out, error: `${f.name}: this file type isn't allowed.` };
    if (f.size > 10 * 1024 * 1024) return { files: out, error: `${f.name} is over 10 MB.` };
    if (out.length >= 5) return { files: out, error: "Up to 5 files per message." };
    const isImage = f.type.startsWith("image/");
    out.push({ uuid: newKey(), name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), isImage, previewUrl: isImage ? URL.createObjectURL(f) : undefined });
  }
  return { files: out };
}

function FileChips({ files, onRemove }: { files: Attachment[]; onRemove?: (uuid: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <span key={f.uuid} className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
          {f.isImage && f.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            "📎"
          )}
          {f.name} · {f.sizeKb} KB
          {onRemove && (
            <button onClick={() => onRemove(f.uuid)} className="ml-1 text-slate-400 hover:text-slate-700">
              ✕
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- pre-chat flow */

function Flow({
  snap,
  user,
  view,
  setView,
  refresh,
  onClose,
  onChatStarted,
}: {
  snap: State;
  user: HotelUser;
  view: View;
  setView: (v: View) => void;
  refresh: () => void;
  onClose: () => void;
  onChatStarted: (id: number) => void;
}) {
  const availability = store.availability();
  const myCount = snap.chats.filter((c) => c.openedByUserId === user.id).length + snap.tickets.filter((t) => t.openedByUserId === user.id).length;

  if (view.name === "home") {
    return (
      <>
        <Header title="Help & Support" onClose={onClose} />
        <IncidentBanner text={snap.incident} />
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 text-sm font-medium text-slate-700">What do you need help with?</div>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setView({ name: "issues", category: c })}
                className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 p-3 text-xs text-slate-700 hover:border-[#53C0C9] hover:bg-[#53C0C9]/10"
              >
                <span className="text-xl">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${availability.available ? "bg-emerald-500" : "bg-slate-400"}`} />
            {availability.available ? "Support online · usually replies in 3 min" : "Support offline · tickets answered next working day"}
          </div>
          <button onClick={() => setView({ name: "myissues" })} className="mt-3 text-xs font-medium text-[#27374D] underline">
            My issues ({myCount}) →
          </button>
        </div>
      </>
    );
  }

  if (view.name === "issues") {
    return <IssuePicker category={view.category} incident={snap.incident} onBack={() => setView({ name: "home" })} onClose={onClose} onNext={(issue, entity) => setView(issue.articles.length ? { name: "selfhelp", issue, entity } : { name: "compose", issue, entity })} />;
  }

  if (view.name === "selfhelp") {
    return (
      <>
        <Header title={view.issue.label} sub={view.entity} onBack={() => setView({ name: "home" })} onClose={onClose} />
        <IncidentBanner text={snap.incident} />
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">These usually fix it:</div>
          {view.issue.articles.map((p) => (
            <ArticleCard key={p} path={p} />
          ))}
          <div className="mt-5 text-sm text-slate-700">Did this solve it?</div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                store.helpSession(user, view.issue.key, "self_solved");
                setView({ name: "solved" });
              }}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
            >
              Yes, thanks
            </button>
            <button
              onClick={() => {
                store.logHttp(WHO, "GET /support/chat/state (availability)");
                setView(store.availability().available ? { name: "compose", issue: view.issue, entity: view.entity } : { name: "offline", issue: view.issue, entity: view.entity });
              }}
              className="flex-1 rounded-lg bg-[#27374D] px-3 py-2 text-sm text-white"
            >
              Still need help →
            </button>
          </div>
        </div>
      </>
    );
  }

  if (view.name === "compose") {
    return <Compose issue={view.issue} entity={view.entity} user={user} onBack={() => setView({ name: "home" })} onClose={onClose} onStarted={(id) => { refresh(); onChatStarted(id); }} onOffline={() => setView({ name: "offline", issue: view.issue, entity: view.entity })} />;
  }

  if (view.name === "offline") {
    return (
      <Offline
        user={user}
        issue={view.issue}
        entity={view.entity}
        onBack={() => setView({ name: "home" })}
        onClose={onClose}
        onSolved={() => setView({ name: "solved" })}
        onRaised={(n) => {
          refresh();
          setView({ name: "ticket", number: n });
        }}
      />
    );
  }

  if (view.name === "solved") {
    return (
      <>
        <Header title="Help & Support" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-4xl">🎉</div>
          <div className="text-sm text-slate-700">Great, glad that helped!</div>
          <div className="text-xs text-slate-400">Logged as self-solved: no chat was created.</div>
          <button onClick={() => setView({ name: "home" })} className="mt-2 text-xs underline">
            Back to help
          </button>
        </div>
      </>
    );
  }

  if (view.name === "ticket") {
    return (
      <>
        <Header title="Ticket raised" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-4xl">🎫</div>
          <div className="text-sm text-slate-700">
            Ticket <span className="font-mono">{view.number}</span> raised.
          </div>
          <div className="text-xs text-slate-500">We&apos;ll reply there and email you.</div>
          <button onClick={() => setView({ name: "myissues" })} className="mt-2 text-xs underline">
            My issues
          </button>
        </div>
      </>
    );
  }

  return <MyIssues snap={snap} user={user} onBack={() => setView({ name: "home" })} onClose={onClose} onOpenChat={(id) => onChatStarted(id)} />;
}

function IssuePicker({ category, incident, onBack, onClose, onNext }: { category: Category; incident: string | null; onBack: () => void; onClose: () => void; onNext: (issue: Issue, entity?: string) => void }) {
  const [issueKey, setIssueKey] = useState(category.issues[0].key);
  const [entity, setEntity] = useState("");
  const issue = ISSUES[issueKey];
  return (
    <>
      <Header title={`${category.icon} ${category.label}`} onBack={onBack} onClose={onClose} />
      <IncidentBanner text={incident} />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          {category.issues.map((i) => (
            <label key={i.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${issueKey === i.key ? "border-[#53C0C9] bg-[#53C0C9]/10" : "border-slate-200"}`}>
              <input
                type="radio"
                checked={issueKey === i.key}
                onChange={() => {
                  setIssueKey(i.key);
                  setEntity("");
                }}
              />
              {i.label}
            </label>
          ))}
        </div>
        {issue.entity && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium text-slate-600">Which {issue.entity}? (optional)</div>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
              <option value="">Not sure / none</option>
              {ENTITIES[issue.entity].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-slate-400">Only booking numbers and dates are shared, never guest names.</div>
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 p-3 text-right">
        <button onClick={() => onNext(issue, entity || undefined)} className="rounded-lg bg-[#27374D] px-4 py-2 text-sm text-white">
          Next →
        </button>
      </div>
    </>
  );
}

function ArticleCard({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const a = ARTICLES[path];
  if (!a) return null;
  return (
    <div className="mb-2 rounded-lg border border-slate-200 p-3 text-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left font-medium text-slate-700">
        📄 {a.title}
        <span className="text-slate-400">{open ? "▾" : "›"}</span>
      </button>
      {open && <p className="mt-2 text-xs leading-relaxed text-slate-500">{a.summary}</p>}
    </div>
  );
}

function Compose({ issue, entity, user, onBack, onClose, onStarted, onOffline }: { issue: Issue; entity?: string; user: HotelUser; onBack: () => void; onClose: () => void; onStarted: (id: number) => void; onOffline: () => void }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState<string>();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [clientKey] = useState(newKey);
  const card = containsCardNumber(body);

  const startChat = () => {
    if (!body.trim()) return setError("Please describe the problem.");
    store.logHttp(WHO, "POST /support/chat/start");
    store.helpSession(user, issue.key, "chat");
    const res = store.start(user, {
      topic: issue.key,
      entityLabel: entity,
      body: body.trim().slice(0, MAX_BODY),
      attachments: files,
      clientKey,
      context: { page: "rates.calendar", errorRef: issue.key === "bookings.cannot_create" ? "E-7F3A2" : undefined, app: "web · Chrome 129" },
    });
    if (res.ok) return onStarted(res.value.id);
    if (res.code === "26106") return onOffline();
    setError(res.message);
  };

  return (
    <>
      <Header title="Chat with 4ROOMS" sub={`${issue.label}${entity ? ` · ${entity}` : ""}`} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Describe the problem…"
          className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-[#53C0C9] focus:outline-none"
        />
        <label className="mt-2 inline-block cursor-pointer text-xs text-slate-600 hover:text-slate-900">
          📎 Add screenshot or file
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const r = pickFiles(e.target.files, files);
              setFiles(r.files);
              setError(r.error);
              e.target.value = "";
            }}
          />
        </label>
        <FileChips files={files} onRemove={(u) => setFiles(files.filter((f) => f.uuid !== u))} />
        {card && <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">That looks like a card number. Please remove it.</div>}
        <div className="mt-3 rounded bg-slate-50 p-2 text-[11px] text-slate-500">
          ⓘ Don&apos;t share card or passport details. We also include the page you came from, your property and browser so we can help faster.{" "}
          <button onClick={() => setShowPrivacy(!showPrivacy)} className="underline">
            How we use your data
          </button>
          {showPrivacy && <div className="mt-1">4ROOMS keeps chats for 2 years to support you, then deletes them. Your hotel superadmin can read your chats. You can ask for a copy or deletion.</div>}
        </div>
        {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
      </div>
      <div className="border-t border-slate-200 p-3 text-right">
        <button disabled={card} onClick={startChat} className="rounded-lg bg-[#27374D] px-4 py-2 text-sm text-white disabled:opacity-40">
          Start chat
        </button>
      </div>
    </>
  );
}

type BotTurn = {
  role: "user" | "assistant";
  text: string;
  sources?: { path: string; title: string }[];
  // "clarify": nothing matched, so the user picks a category; "issues": that category's issues.
  kind?: "answer" | "clarify" | "issues";
  category?: string;
};

function Offline({ user, issue, entity, onBack, onClose, onRaised, onSolved }: { user: HotelUser; issue?: Issue; entity?: string; onBack: () => void; onClose: () => void; onRaised: (number: string) => void; onSolved: () => void }) {
  const reason = store.availability().reason ?? "no_agent";
  const topic = issue?.key ?? "other.general";
  const [turns, setTurns] = useState<BotTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [ticketMode, setTicketMode] = useState(false);
  const [body, setBody] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, loading, ticketMode]);

  const send = async (q: string, opts: { topic?: string; useTopic?: boolean } = {}) => {
    if (!q || loading) return;
    if (containsCardNumber(q)) return setError("That looks like a card number. Please remove it.");
    setError(undefined);
    // Only real exchanges go to the model; the category pickers are UI, not conversation.
    const history = turns.filter((t) => t.role === "user" || t.kind === "answer").map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: "user", text: q }]);
    setQuestion("");
    setLoading(true);
    store.logHttp(WHO, "POST /api/assistant (server-side, token never in the browser)");
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: opts.topic ?? topic, entity, question: q, history, useTopic: !!opts.useTopic }),
      });
      const data = (await res.json()) as { answer?: string; error?: string; sources?: BotTurn["sources"]; mode?: string; model?: string; reason?: string; redacted?: boolean };
      if (!res.ok || !data.answer) throw new Error(data.error ?? "The assistant is unavailable.");
      const kind = data.mode === "clarify" ? "clarify" : "answer";
      setTurns((t) => [...t, { role: "assistant", text: data.answer!, sources: data.sources, kind }]);
      if (kind === "clarify") {
        store.logAi("No help article matched → offered all categories", "model not called, so nothing could be made up");
      } else {
        store.logAi(
          data.mode === "gemini" ? `Gemini · ${data.model}` : data.mode === "ollama" ? `Ollama (local, free) · ${data.model}` : data.mode === "huggingface" ? `Hugging Face · ${data.model}` : `Fallback answer from articles (${data.reason ?? "no model"})`,
          `grounded on: ${(data.sources ?? []).map((s) => s.title).join(", ") || "none"}${data.redacted ? " · personal data stripped before sending" : ""}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The assistant is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const ask = () => send(question.trim());

  const pickCategory = (c: Category) =>
    setTurns((t) => [
      ...t,
      { role: "user", text: `${c.icon} ${c.label}` },
      { role: "assistant", kind: "issues", category: c.key, text: `What's the problem with ${c.label}?` },
    ]);

  const pickIssue = (i: Issue) => send(i.label, { topic: i.key, useTopic: true });

  const transcript = turns.map((t) => `${t.role === "user" ? "Me" : "Assistant (AI)"}: ${t.text}`).join("\n");
  const answered = turns.some((t) => t.role === "assistant" && t.kind === "answer");

  return (
    <>
      <Header title="Help & Support" sub={issue?.label} onBack={onBack} onClose={onClose} />
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex items-start gap-2 text-sm text-slate-700">
          <span className="text-2xl">🌙</span>
          <p>{OFFLINE_REASON[reason]}</p>
        </div>

        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-3">
          <div className="text-xs font-semibold text-fuchsia-900">🤖 Ask our assistant while we&apos;re away</div>
          <div className="mt-0.5 text-[11px] text-fuchsia-800/80">AI · answers only from 4ROOMS help articles and may be wrong. Don&apos;t share card or guest details.</div>

          <div className="mt-3 space-y-2">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#27374D] px-3 py-2 text-sm text-white">{t.text}</div>
                </div>
              ) : (
                <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-sm border border-fuchsia-200 bg-white px-3 py-2 text-sm text-slate-800">
                  <div className="mb-0.5 text-[11px] font-semibold text-fuchsia-700">Assistant · AI</div>
                  <div className="whitespace-pre-wrap">{t.text}</div>
                  {t.kind === "clarify" && i === turns.length - 1 && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c.key}
                          disabled={loading}
                          onClick={() => pickCategory(c)}
                          className="flex flex-col items-center gap-0.5 rounded-lg border border-slate-200 px-1 py-2 text-[11px] text-slate-700 hover:border-[#53C0C9] hover:bg-[#53C0C9]/10"
                        >
                          <span className="text-base">{c.icon}</span>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {t.kind === "issues" && i === turns.length - 1 && (
                    <div className="mt-2 space-y-1">
                      {(CATEGORIES.find((c) => c.key === t.category)?.issues ?? []).map((iss) => (
                        <button
                          key={iss.key}
                          disabled={loading}
                          onClick={() => pickIssue(iss)}
                          className="block w-full rounded-lg border border-slate-200 px-3 py-1.5 text-left text-xs text-slate-700 hover:border-[#53C0C9] hover:bg-[#53C0C9]/10"
                        >
                          {iss.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {!!t.sources?.length && (
                    <div className="mt-2">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">From these articles</div>
                      {t.sources.map((s) => (
                        <ArticleCard key={s.path} path={s.path} />
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {loading && <div className="text-xs italic text-fuchsia-700">Assistant is thinking…</div>}
          </div>

          {!ticketMode && (
            <div className="mt-3 flex items-end gap-2">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
                }}
                rows={2}
                placeholder={answered ? "Ask a follow-up…" : `Describe the problem${issue ? ` with "${issue.label}"` : ""}…`}
                className="flex-1 resize-none rounded-lg border border-slate-300 bg-white p-2 text-sm focus:border-fuchsia-400 focus:outline-none"
              />
              <button disabled={loading || !question.trim()} onClick={ask} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm text-white disabled:opacity-40">
                Ask
              </button>
            </div>
          )}
          {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}

          {answered && !ticketMode && (
            <div className="mt-3 flex gap-2 text-xs">
              <button
                onClick={() => {
                  store.helpSession(user, topic, "self_solved");
                  onSolved();
                }}
                className="flex-1 rounded-lg border border-slate-300 bg-white py-1.5"
              >
                ✅ This solved it
              </button>
              <button
                onClick={() => {
                  setBody(`${turns.find((t) => t.role === "user")?.text ?? ""}`);
                  setTicketMode(true);
                }}
                className="flex-1 rounded-lg bg-[#27374D] py-1.5 text-white"
              >
                Still stuck → ticket
              </button>
            </div>
          )}
        </div>

        {(ticketMode || !answered) && (
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">{ticketMode ? "Raise a ticket (the assistant conversation is attached)" : "Or skip straight to a ticket"}</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Describe the problem for the ticket…" className="w-full rounded-lg border border-slate-300 p-3 text-sm" />
          </div>
        )}
      </div>
      {(ticketMode || !answered) && (
        <div className="border-t border-slate-200 p-3 text-right">
          <button
            onClick={() => {
              store.logHttp(WHO, "POST /support (ticket)");
              store.helpSession(user, topic, "ticket");
              const full = transcript ? `${body}\n\n--- Assistant conversation (AI) ---\n${transcript}` : body;
              onRaised(store.raiseTicket(user, topic, full).number);
            }}
            className="rounded-lg bg-[#27374D] px-4 py-2 text-sm text-white"
          >
            Raise a ticket →
          </button>
        </div>
      )}
    </>
  );
}

function MyIssues({ snap, user, onBack, onClose, onOpenChat }: { snap: State; user: HotelUser; onBack: () => void; onClose: () => void; onOpenChat: (id: number) => void }) {
  const t = useNow(10_000);
  const rows = [
    ...snap.chats.filter((c) => c.openedByUserId === user.id).map((c) => ({ kind: "chat" as const, at: c.lastMessageAt, c })),
    ...snap.tickets.filter((x) => x.openedByUserId === user.id).map((x) => ({ kind: "ticket" as const, at: x.updatedAt, x })),
  ].sort((a, b) => b.at - a.at);
  return (
    <>
      <Header title="My issues" onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto">
        {rows.map((r) =>
          r.kind === "chat" ? (
            <button key={`c${r.c.id}`} onClick={() => onOpenChat(r.c.id)} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
              <span>💬</span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-slate-500">{r.c.chatNumber}</div>
                <div className="truncate text-sm text-slate-700">{issueLabel(r.c.topic)}</div>
              </div>
              <div className="text-right text-xs">
                <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[r.c.status]}`}>{r.c.status}</span>
                <div className="mt-1 text-slate-400">{r.c.rating ? `⭐${r.c.rating} · ` : ""}{relative(r.at, t)}</div>
              </div>
            </button>
          ) : (
            <div key={`t${r.x.number}`} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <span>🎫</span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-slate-500">{r.x.number}</div>
                <div className="truncate text-sm text-slate-700">{r.x.subject}</div>
              </div>
              <div className="text-right text-xs">
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">{r.x.status}</span>
                <div className="mt-1 text-slate-400">{relative(r.at, t)}</div>
              </div>
            </div>
          ),
        )}
      </div>
    </>
  );
}

function relative(at: number, t: number) {
  const s = Math.round((t - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/* ------------------------------------------------------------- chat view */

function ChatView({
  snap,
  chat,
  user,
  refresh,
  onClose,
  onHome,
  onMyIssues,
  onSwitchChat,
}: {
  snap: State;
  chat: Chat;
  user: HotelUser;
  refresh: () => void;
  onClose: () => void;
  onHome: () => void;
  onMyIssues: () => void;
  onSwitchChat: (id: number) => void;
}) {
  const t = useNow(1000);
  const live = isLive(chat);
  // The hotel's door: message and event only. Internal notes never leave the server.
  const msgs = snap.messages.filter((m) => m.chatId === chat.id && (m.kind === "message" || m.kind === "event"));
  const agent = snap.agents.find((a) => a.id === chat.assignedAgentId);
  const pos = chat.status === "waiting" ? queuePosition(snap, chat.id) : null;
  const typing = snap.typing[chat.id];
  const typingName = typing && typing.until > t ? snap.agents.find((a) => a.id === typing.agentId)?.name.split(" ")[0] : null;
  const myLast = [...msgs].reverse().find((m) => m.authorType === "tenant" && m.kind === "message");
  const lastMsg = msgs[msgs.length - 1];

  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState<string>();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, typingName]);

  const send = (override?: string) => {
    const body = (override ?? text).trim();
    if (!body && !files.length) return;
    if (containsCardNumber(body)) return setError("That looks like a card number. Please remove it.");
    const key = pendingKey ?? newKey();
    setPendingKey(key);
    store.logHttp(WHO, `POST /support/chat/{uuid}/messages (client_key ${key.slice(0, 8)}…)`);
    const res = store.say(user, chat.id, body || "(attachment)", key, files);
    if (res.ok) {
      if (!override) {
        setText("");
        setFiles([]);
      }
      setPendingKey(null);
      setError(undefined);
      refresh();
    } else {
      setError(res.message);
      refresh();
    }
  };

  const sendLongAsFile = () => {
    const kb = Math.max(1, Math.round(new Blob([text]).size / 1024));
    setFiles([...files, { uuid: newKey(), name: "pasted.txt", sizeKb: kb, isImage: false }]);
    setText("(long text attached as pasted.txt)");
  };

  const sub = live
    ? chat.status === "waiting"
      ? "Connecting you to support…"
      : `${agent?.name ?? "Agent"} · 4ROOMS support`
    : chat.status === "missed"
      ? "Missed"
      : "Ended";

  return (
    <>
      <Header title={chat.chatNumber} sub={sub} onBack={live ? undefined : onHome} onClose={onClose} />
      {pos && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          ⏳ You&apos;re {ordinal(pos.position)} in line · about {pos.etaMin} min · waiting {Math.round((t - chat.createdAt) / 1000)}s
        </div>
      )}
      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
        {chat.relatedChatId && <div className="text-center text-[11px] text-slate-400">Continuing from an earlier chat</div>}
        {msgs.map((m) => (
          <div key={m.id}>
            <Bubble m={m} mine={m.authorType === "tenant"} showQuick={live && m.id === lastMsg?.id} onQuick={(o) => send(o)} />
            {m.id === myLast?.id && (
              <div className="mt-0.5 text-right text-[11px] text-sky-600">{chat.platformLastSeenMessageId >= m.id ? "Seen ✓✓" : "Sent ✓"}</div>
            )}
          </div>
        ))}
        {typingName && <div className="text-xs italic text-slate-400">{typingName} is typing…</div>}
      </div>

      {live ? (
        <div className="border-t border-slate-200 p-3">
          {text.length > MAX_BODY && (
            <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
              That&apos;s long ({text.length} chars).{" "}
              <button onClick={sendLongAsFile} className="underline">
                Send it as a file instead
              </button>
            </div>
          )}
          <FileChips files={files} onRemove={(u) => setFiles(files.filter((f) => f.uuid !== u))} />
          {error && (
            <div className="mb-1 text-xs text-rose-600">
              {error} {pendingKey && <button onClick={() => send()} className="underline">Retry</button>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              rows={2}
              placeholder="Type a message… (Ctrl/⌘+Enter to send)"
              className="flex-1 resize-none rounded-lg border border-slate-300 p-2 text-sm focus:border-[#53C0C9] focus:outline-none"
            />
            <label className="cursor-pointer px-1 text-lg" title="Attach">
              📎
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const r = pickFiles(e.target.files, files);
                  setFiles(r.files);
                  setError(r.error);
                  e.target.value = "";
                }}
              />
            </label>
            <button disabled={text.length > MAX_BODY} onClick={() => send()} className="rounded-lg bg-[#27374D] px-3 py-2 text-sm text-white disabled:opacity-40">
              ➤
            </button>
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>Don&apos;t share card or passport details.</span>
            <button
              onClick={() => {
                if (!confirm("End this chat?")) return;
                store.logHttp(WHO, "POST /support/chat/{uuid}/resolve");
                store.endChat(user, chat.id);
                refresh();
              }}
              className="underline hover:text-slate-700"
            >
              End chat
            </button>
          </div>
        </div>
      ) : (
        <Ended snap={snap} chat={chat} user={user} refresh={refresh} onHome={onHome} onMyIssues={onMyIssues} onSwitchChat={onSwitchChat} />
      )}
    </>
  );
}

function Bubble({ m, mine, showQuick, onQuick }: { m: Message; mine: boolean; showQuick: boolean; onQuick: (o: string) => void }) {
  if (m.kind === "event") {
    return <div className="py-1 text-center text-[11px] text-slate-400">— {eventText(m, "tenant")} —</div>;
  }
  if (m.authorType === "system") {
    return (
      <div className="mx-auto max-w-[90%] rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
        <div className="mb-0.5 font-semibold">4ROOMS</div>
        {m.body}
        {showQuick && m.meta?.type === "quick_reply" && (
          <div className="mt-2 flex gap-2">
            {m.meta.options.map((o) => (
              <button key={o} onClick={() => onQuick(o)} className="rounded-full border border-sky-300 bg-white px-3 py-1 text-xs">
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? "rounded-br-sm bg-[#27374D] text-white" : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"}`}>
        {!mine && <div className="mb-0.5 text-[11px] font-semibold text-[#2a9aa3]">{m.authorName}</div>}
        {m.redactedAt ? <span className="italic opacity-70">[redacted by 4ROOMS]</span> : <span className="whitespace-pre-wrap">{m.body}</span>}
        {m.meta?.type === "article" && (
          <div className="mt-2 text-slate-800">
            <ArticleCard path={m.meta.path} />
          </div>
        )}
        {!m.redactedAt && m.attachments?.map((a) => (
          <div key={a.uuid} className="mt-1 text-xs">
            {a.isImage && a.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.previewUrl} alt={a.name} className="max-h-32 rounded" />
            ) : (
              <span>📎 {a.name}</span>
            )}
          </div>
        ))}
        <div className={`mt-1 text-right text-[10px] ${mine ? "text-white/60" : "text-slate-400"}`}>{clock(m.createdAt)}</div>
      </div>
    </div>
  );
}

function Ended({ snap, chat, user, refresh, onHome, onMyIssues, onSwitchChat }: { snap: State; chat: Chat; user: HotelUser; refresh: () => void; onHome: () => void; onMyIssues: () => void; onSwitchChat: (id: number) => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const agent = snap.agents.find((a) => a.id === chat.assignedAgentId);
  const askFix = chat.status === "resolved" && chat.askedFixed && !chat.resolutionConfirmed;
  const canRate = chat.status === "resolved" && !chat.rating && !askFix && chat.resolutionConfirmed !== "no";

  return (
    <div className="space-y-3 border-t border-slate-200 p-3 text-sm">
      {chat.status === "missed" && <div className="rounded bg-rose-50 p-2 text-xs text-rose-800">Sorry we missed you. Continue as a ticket and we&apos;ll reply there.</div>}

      {askFix && (
        <div>
          <div className="text-slate-700">{agent?.name.split(" ")[0] ?? "We"} marked this as resolved. Did this fix your issue?</div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                store.logHttp(WHO, "POST /support/chat/{uuid}/confirm (yes)");
                store.answerFixed(user, chat.id, true);
                refresh();
              }}
              className="flex-1 rounded-lg border border-slate-300 py-1.5"
            >
              Yes 👍
            </button>
            <button
              onClick={() => {
                store.logHttp(WHO, "POST /support/chat/{uuid}/confirm (no) → new related chat");
                const r = store.answerFixed(user, chat.id, false);
                refresh();
                if (r.ok && r.value) onSwitchChat(r.value.id);
                else if (!r.ok) setError(`${r.message} You can continue as a ticket.`);
              }}
              className="flex-1 rounded-lg bg-[#27374D] py-1.5 text-white"
            >
              No, still need help
            </button>
          </div>
        </div>
      )}

      {canRate && (
        <div>
          <div className="text-slate-700">How was it?</div>
          <div className="mt-1 flex gap-1 text-2xl">
            {["😞", "🙁", "😐", "🙂", "😀"].map((f, i) => (
              <button key={f} onClick={() => setRating(i + 1)} className={`rounded p-0.5 ${rating === i + 1 ? "bg-[#53C0C9]/30" : "opacity-60 hover:opacity-100"}`}>
                {f}
              </button>
            ))}
          </div>
          {rating > 0 && (
            <div className="mt-2 flex gap-2">
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything to add? (optional)" className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
              <button
                onClick={() => {
                  store.rate(chat.id, rating, comment);
                  refresh();
                }}
                className="rounded bg-[#27374D] px-3 text-xs text-white"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
      {chat.rating && <div className="text-xs text-slate-500">Thanks for the feedback ({"⭐".repeat(chat.rating)})</div>}
      {chat.convertedTicketNumber && <div className="text-xs text-slate-600">Continued as ticket <span className="font-mono">{chat.convertedTicketNumber}</span></div>}
      {error && <div className="text-xs text-rose-600">{error}</div>}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {!chat.transcriptEmailedAt ? (
          <button
            onClick={() => {
              store.emailTranscript(chat.id);
              refresh();
            }}
            className="underline"
          >
            Email me this conversation
          </button>
        ) : (
          <span className="text-slate-400">Transcript emailed ✓</span>
        )}
        {!chat.convertedTicketNumber && (
          <button
            onClick={() => {
              store.logHttp(WHO, "POST /support/chat/{uuid}/convert");
              const r = store.convert(user, chat.id);
              if (!r.ok) setError(r.message);
              refresh();
            }}
            className="underline"
          >
            Continue as ticket
          </button>
        )}
        <button onClick={onHome} className="underline">
          Start new chat
        </button>
        <button onClick={onMyIssues} className="underline">
          My issues
        </button>
      </div>
    </div>
  );
}
