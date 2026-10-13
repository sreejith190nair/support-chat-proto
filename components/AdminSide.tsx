"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ARTICLES, CANNED, ISSUES, RESOLUTION_CODES } from "@/lib/catalog";
import { eventText, issueLabel, PRIORITY_STYLE, STATUS_STYLE, topicLabel } from "@/lib/format";
import { ago, clock, useChannels, useNow, usePoll, useSideSnapshot } from "@/lib/hooks";
import { chatChannel, isLive, QUEUE_CHANNEL, staffChannel, store, waitingOrdered } from "@/lib/store";
import type { Chat, Message, Priority, State } from "@/lib/types";

const INCIDENT = "Booking.com sync is delayed. We're on it, updates here.";

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.15);
  } catch {
    /* audio blocked until the user interacts; the toast still shows */
  }
}

export default function AdminSide() {
  const [me, setMe] = useState("asha");
  const [snap, refresh] = useSideSnapshot();
  const [selId, setSelId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [sound, setSound] = useState(true);
  const t = useNow(1000);

  const meAgent = snap.agents.find((a) => a.id === me)!;
  const who = `Admin (${meAgent.name.split(" ")[0]})`;
  const sel = selId ? snap.chats.find((c) => c.id === selId) : undefined;

  useChannels([QUEUE_CHANNEL, ...(sel ? [chatChannel(sel), staffChannel(sel)] : [])], who, refresh);
  usePoll(true, 3000, who, refresh);

  const waiting = waitingOrdered(snap);
  const forYou = waiting.filter((c) => c.preferredAgentId === me);
  const shared = waiting.filter((c) => c.preferredAgentId !== me);
  const mine = snap.chats.filter((c) => c.status === "active" && c.assignedAgentId === me);
  const others = snap.chats.filter((c) => c.status === "active" && c.assignedAgentId !== me);
  const recent = snap.chats
    .filter((c) => !isLive(c) && c.endedAt && t - c.endedAt < 86_400_000)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 6);

  // New-chat alerts: sound + toast + tab title.
  const known = useRef<Set<number> | null>(null);
  useEffect(() => {
    const ids = new Set(waiting.map((c) => c.id));
    if (known.current) {
      const fresh = waiting.filter((c) => !known.current!.has(c.id));
      if (fresh.length) {
        if (sound) beep();
        setToasts((ts) => [...ts, ...fresh.map((c) => ({ id: c.id + Math.random(), text: `New chat waiting · ${c.tenantCode} · ${issueLabel(c.topic)}` }))]);
      }
    }
    known.current = ids;
    document.title = waiting.length ? `(${waiting.length}) Live chats · prototype` : "Live chats · prototype";
  }, [snap.version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => setToasts((ts) => ts.slice(1)), 4000);
    return () => clearTimeout(id);
  }, [toasts]);

  // The assignee's seen pointer moves while they have the chat open.
  useEffect(() => {
    if (!sel || sel.assignedAgentId !== me) return;
    const ids = snap.messages.filter((m) => m.chatId === sel.id && m.kind !== "note").map((m) => m.id);
    const max = ids.length ? Math.max(...ids) : 0;
    if (max > sel.platformLastSeenMessageId) {
      store.markSeen("platform", sel.id, max);
      refresh();
    }
  }, [sel, me, snap.messages, refresh]);

  const act = (fn: () => void) => {
    fn();
    refresh();
  };

  return (
    <div className="relative flex h-full flex-col bg-[#f6f7f9] text-slate-800">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="text-sm font-semibold">4ROOMS Admin</span>
        <span className="rounded bg-slate-100 px-2 py-0.5">Help & Support › Live chats</span>
        <span className={`rounded-full px-2 py-0.5 ${waiting.length ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-500"}`}>{waiting.length} waiting</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            Acting as
            <select value={me} onChange={(e) => setMe(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5">
              {snap.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <select
            value={meAgent.status}
            onChange={(e) => act(() => store.setAgentStatus(me, e.target.value as "online" | "away"))}
            className={`rounded border px-1 py-0.5 ${meAgent.status === "online" ? "border-emerald-300 text-emerald-700" : "border-slate-300 text-slate-500"}`}
          >
            <option value="online">🟢 Online</option>
            <option value="away">🌙 Away</option>
          </select>
          <button onClick={() => act(() => store.setPaused(!snap.paused))} className={`rounded border px-2 py-0.5 ${snap.paused ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}>
            {snap.paused ? "▶ Resume queue" : "⏸ Pause queue"}
          </button>
          <button onClick={() => act(() => store.setIncident(snap.incident ? null : INCIDENT))} className={`rounded border px-2 py-0.5 ${snap.incident ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}>
            {snap.incident ? "✓ Incident posted" : "⚠ Post incident"}
          </button>
          <button onClick={() => setSound(!sound)} className="rounded border border-slate-300 px-2 py-0.5">
            {sound ? "🔔" : "🔕"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* queue */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white text-xs">
          <QueueSection title="For you" hint="your hotels first" chats={forYou} t={t} selId={selId} onPick={setSelId} snap={snap} me={me} />
          <QueueSection title="Waiting" chats={shared} t={t} selId={selId} onPick={setSelId} snap={snap} me={me} />
          <QueueSection title={`Mine (${mine.length}/4)`} chats={mine} t={t} selId={selId} onPick={setSelId} snap={snap} me={me} />
          <QueueSection title="Colleagues" chats={others} t={t} selId={selId} onPick={setSelId} snap={snap} me={me} />
          <QueueSection title="Recent 24 h" chats={recent} t={t} selId={selId} onPick={setSelId} snap={snap} me={me} />
        </div>

        {/* conversation */}
        <div className="flex min-w-0 flex-1 flex-col">
          {sel ? <Conversation key={sel.id} snap={snap} chat={sel} me={me} who={who} t={t} refresh={refresh} /> : <div className="m-auto text-sm text-slate-400">Pick a chat from the queue</div>}
        </div>

        {/* context */}
        {sel && <Context snap={snap} chat={sel} onPick={setSelId} />}
      </div>

      <div className="pointer-events-none absolute right-3 top-24 z-20 w-56 space-y-2">
        {toasts.map((x) => (
          <div key={x.id} className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
            🔔 {x.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function QueueSection({ title, hint, chats, t, selId, onPick, snap, me }: { title: string; hint?: string; chats: Chat[]; t: number; selId: number | null; onPick: (id: number) => void; snap: State; me: string }) {
  if (!chats.length && title === "For you") return null;
  return (
    <div className="border-b border-slate-100 pb-1">
      <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {title} {hint && <span className="font-normal normal-case">· {hint}</span>}
      </div>
      {!chats.length && <div className="px-3 py-1 text-slate-300">none</div>}
      {chats.map((c) => {
        const unread = c.assignedAgentId === me && c.lastMessageBy === "tenant" && c.lastMessageId > c.platformLastSeenMessageId;
        const assignee = snap.agents.find((a) => a.id === c.assignedAgentId)?.name.split(" ")[0];
        const reserved = c.status === "waiting" && c.preferredAgentId && c.preferredAgentId !== me ? snap.agents.find((a) => a.id === c.preferredAgentId)?.name.split(" ")[0] : null;
        return (
          <button key={c.id} onClick={() => onPick(c.id)} className={`block w-full px-3 py-1.5 text-left hover:bg-slate-50 ${selId === c.id ? "bg-[#53C0C9]/15" : ""}`}>
            <div className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${c.priority === "urgent" ? "bg-red-600" : c.priority === "high" ? "bg-orange-500" : "bg-slate-300"}`} />
              <span className="font-mono font-semibold">{c.tenantCode}</span>
              <span className="truncate text-slate-500">{issueLabel(c.topic)}</span>
              {unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
            </div>
            <div className="pl-2.5 text-[10px] text-slate-400">
              {c.status === "waiting" ? `waiting ${ago(c.createdAt, t)}` : isLive(c) ? `${assignee ?? "—"} · ${ago(c.lastMessageAt, t)}` : `${c.status}${c.rating ? ` · ⭐${c.rating}` : ""}`}
              {reserved && ` · for ${reserved}`}
              {c.relatedChatId && " · follow-up"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function fill(template: string, chat: Chat, agentName: string) {
  return template
    .replaceAll("{first_name}", chat.openedByName.split(" ")[0])
    .replaceAll("{entity_label}", chat.entityLabel ?? "this")
    .replaceAll("{hotel}", chat.tenantName)
    .replaceAll("{property}", chat.propertyName)
    .replaceAll("{agent}", agentName);
}

function Conversation({ snap, chat, me, who, t, refresh }: { snap: State; chat: Chat; me: string; who: string; t: number; refresh: () => void }) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [showResolve, setShowResolve] = useState(false);
  const [showArticles, setShowArticles] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const msgs = snap.messages.filter((m) => m.chatId === chat.id);
  const meName = snap.agents.find((a) => a.id === me)!.name;
  const assignee = snap.agents.find((a) => a.id === chat.assignedAgentId);
  const live = isLive(chat);
  const isMine = chat.assignedAgentId === me;
  const claimable = chat.status === "waiting" && !chat.assignedAgentId;
  const readOnly = live && !!chat.assignedAgentId && !isMine;
  // Away = no new work: an Away agent can finish their own chats but can't take new ones.
  const amAway = snap.agents.find((a) => a.id === me)?.status === "away";
  const canReply = live && (isMine || (claimable && !amAway));
  const goOnlineThen = (label: string, fn: () => { ok: boolean; message?: string }) => {
    store.setAgentStatus(me, "online");
    run(label, fn);
  };
  const effectiveMode = canReply ? mode : "note";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const run = (label: string, fn: () => { ok: boolean; message?: string }) => {
    store.logHttp(who, label);
    const r = fn();
    setError(r.ok ? undefined : r.message);
    refresh();
    return r.ok;
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const ok =
      effectiveMode === "note"
        ? run("POST /support/chats/{uuid}/notes", () => store.note(chat.id, me, body))
        : run("POST /support/chats/{uuid}/messages", () => store.agentSay(chat.id, me, body));
    if (ok) {
      setText("");
      // A note is a one-off aside: drop straight back to replying to the hotel.
      if (effectiveMode === "note") setMode("reply");
    }
  };

  const canned = text.startsWith("/") ? CANNED.filter((c) => (c.topic === null || c.topic === chat.topic) && c.title.toLowerCase().includes(text.slice(1).toLowerCase())) : [];
  const articlePaths = [...(ISSUES[chat.topic]?.articles ?? []), ...Object.keys(ARTICLES).filter((p) => !(ISSUES[chat.topic]?.articles ?? []).includes(p))];

  const slaLeft = Math.round((chat.slaDueAt - t) / 1000);
  const sla = chat.firstResponseAt
    ? { text: `First reply in ${Math.round((chat.firstResponseAt - chat.createdAt) / 1000)}s`, cls: chat.firstResponseAt <= chat.slaDueAt ? "text-emerald-700" : "text-rose-700" }
    : live
      ? { text: slaLeft >= 0 ? `First reply due in ${Math.floor(slaLeft / 60)}:${String(slaLeft % 60).padStart(2, "0")}` : `SLA breached ${-slaLeft}s ago`, cls: slaLeft < 0 ? "text-rose-700 font-semibold" : slaLeft < 30 ? "text-amber-700" : "text-slate-500" }
      : null;

  return (
    <>
      <div className="border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{chat.chatNumber}</span>
          <span className="text-sm text-slate-600">{issueLabel(chat.topic)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[chat.status]}`}>{chat.status}</span>
          <select
            disabled={!live}
            value={chat.priority}
            onChange={(e) => {
              store.setPriority(chat.id, me, e.target.value as Priority);
              refresh();
            }}
            className={`rounded px-1 py-0.5 text-[10px] ${PRIORITY_STYLE[chat.priority]}`}
          >
            {(["urgent", "high", "normal", "low"] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {sla && <span className={`text-[11px] ${sla.cls}`}>⏱ {sla.text}</span>}
          <div className="ml-auto flex gap-2 text-xs">
            {claimable && (
              <>
                {amAway ? (
                  <button onClick={() => goOnlineThen("POST /support/chats/{uuid}/claim", () => store.claim(chat.id, me))} className="rounded bg-[#27374D] px-3 py-1 text-white">
                    Go online &amp; claim
                  </button>
                ) : (
                  <button onClick={() => run("POST /support/chats/{uuid}/claim", () => store.claim(chat.id, me))} className="rounded bg-[#27374D] px-3 py-1 text-white">
                    Claim
                  </button>
                )}
                {me !== "ravi" && (
                  <button onClick={() => { store.claim(chat.id, "ravi"); refresh(); }} className="rounded border border-dashed border-slate-400 px-2 py-1 text-slate-500" title="Demo: race another agent">
                    Simulate: Ravi claims first
                  </button>
                )}
              </>
            )}
            {chat.status === "active" && isMine && (
              <>
                <select
                  value=""
                  onChange={(e) => e.target.value && run("POST /support/chats/{uuid}/transfer", () => store.transfer(chat.id, me, e.target.value))}
                  className="rounded border border-slate-300 px-1 py-1"
                >
                  <option value="">Transfer ▾</option>
                  {snap.agents.filter((a) => a.id !== me).map((a) => (
                    <option key={a.id} value={a.id} disabled={a.status === "away"}>
                      {a.name} {a.status === "away" ? "(away)" : ""}
                    </option>
                  ))}
                </select>
                <button onClick={() => setShowResolve(true)} className="rounded bg-emerald-600 px-3 py-1 text-white">
                  Resolve
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          {chat.tenantName} › {chat.propertyName} · {chat.openedByName} ({chat.openedByRole}){assignee ? ` · assigned to ${assignee.name}` : ""}
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          🔒 {assignee?.name} has this chat. You can read it and add internal notes.
          {amAway ? (
            <button onClick={() => goOnlineThen("POST /support/chats/{uuid}/transfer (to me)", () => store.transfer(chat.id, me, me))} className="rounded border border-amber-400 bg-white px-2 py-0.5">
              Go online &amp; take over
            </button>
          ) : (
            <button onClick={() => run("POST /support/chats/{uuid}/transfer (to me)", () => store.transfer(chat.id, me, me))} className="rounded border border-amber-400 bg-white px-2 py-0.5">
              Transfer to me
            </button>
          )}
        </div>
      )}

      {claimable && amAway && (
        <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-900">
          🌙 You&apos;re Away, so you won&apos;t take new chats. You can read this one and add internal notes, or go online to claim it.
        </div>
      )}

      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto p-4">
        <div className="rounded bg-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          ⓘ Started from <span className="font-mono">{chat.context.page}</span>
          {chat.entityLabel && <> · {chat.entityLabel}</>}
          {chat.context.errorRef && (
            <>
              {" "}· error ref <span className="font-mono text-rose-600">{chat.context.errorRef}</span>
            </>
          )}
        </div>
        {msgs.map((m) => (
          <AdminBubble key={m.id} m={m} canRedact={m.authorType === "tenant" && m.kind === "message" && !m.redactedAt} onRedact={() => {
            if (confirm("Redact this message? The text and files are removed for everyone.")) {
              store.redact(m.id, me);
              refresh();
            }
          }} />
        ))}
      </div>

      <div className={`border-t p-3 ${effectiveMode === "note" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
        <div className="mb-2 flex items-center gap-1 text-xs">
          <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white">
            <button
              disabled={!canReply}
              onClick={() => setMode("reply")}
              title={canReply ? "Message the hotel" : "You can't reply to this chat right now"}
              className={`px-3 py-1 font-medium ${effectiveMode === "reply" ? "bg-[#27374D] text-white" : "text-slate-700 hover:bg-slate-100"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              💬 Reply to hotel
            </button>
            <button onClick={() => setMode("note")} className={`border-l border-slate-300 px-3 py-1 font-medium ${effectiveMode === "note" ? "bg-amber-400 text-amber-950" : "text-slate-700 hover:bg-amber-50"}`}>
              🟨 Internal note
            </button>
          </div>
          {effectiveMode === "note" && canReply && (
            <button onClick={() => setMode("reply")} className="ml-1 text-amber-800 underline">
              back to reply
            </button>
          )}
          {canReply && effectiveMode === "reply" && (
            <div className="relative ml-auto">
              <button onClick={() => setShowArticles(!showArticles)} className="rounded border border-slate-300 px-2 py-0.5">
                📄 Insert article
              </button>
              {showArticles && (
                <div className="absolute bottom-7 right-0 z-10 max-h-56 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {articlePaths.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setShowArticles(false);
                        run("POST /support/chats/{uuid}/messages (article card)", () => store.agentSay(chat.id, me, "This guide should help:", { type: "article", path: p }));
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                    >
                      {ARTICLES[p].title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {canned.length > 0 && (
          <div className="mb-2 rounded-lg border border-slate-200 bg-white text-xs shadow-sm">
            {canned.map((c) => (
              <button key={c.title} onClick={() => setText(fill(c.body, chat, meName))} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">
                <span className="font-semibold">{c.title}</span> <span className="text-slate-400">{c.topic ? "· this topic" : ""}</span>
              </button>
            ))}
          </div>
        )}
        {error && <div className="mb-1 text-xs text-rose-600">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (effectiveMode === "reply" && isMine && e.target.value && !e.target.value.startsWith("/")) store.setTyping(chat.id, me);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            rows={2}
            placeholder={effectiveMode === "note" ? "Note for colleagues (never shown to the hotel)…" : "Reply… type / for canned replies (Ctrl/⌘+Enter)"}
            className="flex-1 resize-none rounded-lg border border-slate-300 bg-white p-2 text-sm focus:border-[#53C0C9] focus:outline-none"
          />
          <button onClick={send} className={`rounded-lg px-3 py-2 text-sm ${effectiveMode === "note" ? "bg-amber-400 text-amber-950" : "bg-[#27374D] text-white"}`}>
            {effectiveMode === "note" ? "Add note" : claimable ? "Send & claim" : "Send"}
          </button>
        </div>
      </div>

      {showResolve && (
        <ResolveDialog
          chat={chat}
          onCancel={() => setShowResolve(false)}
          onResolve={(reason, askFixed, email) => {
            setShowResolve(false);
            run("POST /support/chats/{uuid}/resolve", () => store.resolve(chat.id, me, reason, askFixed, email));
          }}
        />
      )}
    </>
  );
}

function AdminBubble({ m, canRedact, onRedact }: { m: Message; canRedact: boolean; onRedact: () => void }) {
  if (m.kind === "event") return <div className="py-1 text-center text-[11px] text-slate-400">— {eventText(m, "platform")} · {clock(m.createdAt)} —</div>;
  if (m.kind === "note") {
    return (
      <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <div className="text-[10px] font-semibold uppercase text-amber-700">Internal note · {m.authorName} · {clock(m.createdAt)}</div>
        <div className="whitespace-pre-wrap">{m.body}</div>
      </div>
    );
  }
  if (m.authorType === "system") {
    return (
      <div className="mx-auto max-w-[80%] rounded bg-sky-50 px-3 py-1.5 text-xs text-sky-900">
        <span className="font-semibold">Auto · </span>
        {m.body}
      </div>
    );
  }
  const hotel = m.authorType === "tenant";
  return (
    <div className={`group flex ${hotel ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${hotel ? "rounded-bl-sm border border-slate-200 bg-white" : "rounded-br-sm bg-[#53C0C9]/25"}`}>
        <div className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
          {m.authorName}
          {canRedact && (
            <button onClick={onRedact} className="hidden rounded border border-slate-300 px-1 text-[10px] font-normal text-slate-500 hover:bg-slate-100 group-hover:inline" title="GDPR: remove personal or card data">
              Redact
            </button>
          )}
        </div>
        {m.redactedAt ? <span className="italic text-slate-400">[redacted by 4ROOMS]</span> : <span className="whitespace-pre-wrap">{m.body}</span>}
        {m.meta?.type === "article" && <div className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs">📄 {ARTICLES[m.meta.path]?.title} · Open ›</div>}
        {!m.redactedAt &&
          m.attachments?.map((a) => (
            <div key={a.uuid} className="mt-1 text-xs">
              {a.isImage && a.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewUrl} alt={a.name} className="max-h-32 rounded" />
              ) : (
                <span>📎 {a.name} · {a.sizeKb} KB</span>
              )}
            </div>
          ))}
        <div className="mt-1 text-right text-[10px] text-slate-400">{clock(m.createdAt)}</div>
      </div>
    </div>
  );
}

function ResolveDialog({ chat, onCancel, onResolve }: { chat: Chat; onCancel: () => void; onResolve: (reason: string, askFixed: boolean, email: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [askFixed, setAskFixed] = useState(true);
  const [email, setEmail] = useState(false);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
      <div className="w-80 rounded-xl bg-white p-4 text-sm shadow-2xl">
        <div className="mb-3 font-semibold">Resolve {chat.chatNumber}</div>
        <label className="block text-xs text-slate-600">Reason *</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
          <option value="">Choose…</option>
          {Object.entries(RESOLUTION_CODES)
            .filter(([k]) => k !== "no_response")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={askFixed} onChange={(e) => setAskFixed(e.target.checked)} /> Ask &quot;Did this fix your issue?&quot;
        </label>
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email transcript to {chat.openedByName.split(" ")[0]}
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded px-3 py-1 text-slate-600">
            Cancel
          </button>
          <button disabled={!reason} onClick={() => onResolve(reason, askFixed, email)} className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-40">
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}

function Context({ snap, chat, onPick }: { snap: State; chat: Chat; onPick: (id: number) => void }) {
  const tickets = snap.tickets.filter((x) => x.tenantCode === chat.tenantCode);
  const otherChats = snap.chats.filter((c) => c.tenantCode === chat.tenantCode && c.id !== chat.id && isLive(c));
  const related = chat.relatedChatId ? snap.chats.find((c) => c.id === chat.relatedChatId) : undefined;
  const Row = ({ k, v }: { k: string; v?: ReactNode }) =>
    v ? (
      <div className="flex justify-between gap-2 py-0.5">
        <span className="text-slate-400">{k}</span>
        <span className="text-right">{v}</span>
      </div>
    ) : null;
  return (
    <div className="w-60 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-3 text-[11px]">
      <Section title="Hotel">
        <Row k="Name" v={chat.tenantName} />
        <Row k="Code" v={<span className="font-mono">{chat.tenantCode}</span>} />
        <Row k="Plan" v="Pro · active" />
        <Row k="Property" v={chat.propertyName} />
      </Section>
      <Section title="Opened by">
        <Row k="Name" v={chat.openedByName} />
        <Row k="Role" v={chat.openedByRole} />
        <Row k="Email" v={chat.openedByEmail} />
        <Row k="Language" v={chat.locale.toUpperCase()} />
      </Section>
      <Section title="Issue">
        <Row k="Topic" v={topicLabel(chat.topic)} />
        <Row k="About" v={chat.entityLabel} />
        <Row k="Page" v={<span className="font-mono">{chat.context.page}</span>} />
        <Row k="Error ref" v={chat.context.errorRef && <span className="font-mono text-rose-600">{chat.context.errorRef}</span>} />
        <Row k="App" v={chat.context.app} />
        {related && <Row k="Follow-up of" v={<button onClick={() => onPick(related.id)} className="font-mono underline">{related.chatNumber}</button>} />}
      </Section>
      {!isLive(chat) && (
        <Section title="Outcome">
          <Row k="Reason" v={chat.resolutionCode && RESOLUTION_CODES[chat.resolutionCode]} />
          <Row k="Fixed?" v={chat.resolutionConfirmed} />
          <Row k="Rating" v={chat.rating && "⭐".repeat(chat.rating)} />
          <Row k="Comment" v={chat.ratingComment} />
          <Row k="Ticket" v={chat.convertedTicketNumber} />
        </Section>
      )}
      <Section title="Other open items">
        {!tickets.length && !otherChats.length && <div className="text-slate-300">none</div>}
        {tickets.map((x) => (
          <div key={x.number} className="py-0.5">
            🎫 <span className="font-mono">{x.number}</span> {x.subject}
          </div>
        ))}
        {otherChats.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className="block py-0.5 text-left underline">
            💬 {c.chatNumber}
          </button>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}
