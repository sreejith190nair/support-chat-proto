import { CATEGORIES, ISSUES, MARCO, PRIORITY_RANK, SLA_SECONDS } from "./catalog";
import type {
  Agent,
  Attachment,
  Chat,
  HotelUser,
  LogKind,
  Message,
  Meta,
  Priority,
  Result,
  State,
  Ticket,
} from "./types";

/*
 * A browser-only stand-in for the server. Every public method plays one
 * endpoint or service from chat_support.md, writes a line per database touch
 * into the log, and publishes a Reverb "nudge" (ids only, never content).
 * Clients never read pushed data: a nudge only makes them re-fetch.
 */

type ChannelCb = (payload: Record<string, unknown>) => void;

export const QUEUE_CHANNEL = "private-cp.support.queue";
export const chatChannel = (c: Chat) => `private-cp.support.chat.${c.uuid}`;
export const staffChannel = (c: Chat) => `private-cp.support.chat.${c.uuid}.staff`;

const ACCOUNT_MANAGERS: Record<string, string> = { ACME: "asha", BLUE: "ravi", GRAND: "ravi" };
const PREFER_SECONDS = 30;

const now = () => Date.now();
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = <T,>(code: string, message: string): Result<T> => ({ ok: false, code, message });

export const isLive = (c: Chat) => c.status === "waiting" || c.status === "active";

/** Card numbers (13-19 digits, spaces or dashes allowed) that pass Luhn. GDPR item #2. */
export function containsCardNumber(text: string): boolean {
  const candidates = text.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = Number(digits[i]);
      if (double) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      double = !double;
    }
    return sum % 10 === 0;
  });
}

export function waitingOrdered(state: State): Chat[] {
  return state.chats
    .filter((c) => c.status === "waiting")
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt);
}

export function queuePosition(state: State, chatId: number): { position: number; etaMin: number } | null {
  const idx = waitingOrdered(state).findIndex((c) => c.id === chatId);
  if (idx < 0) return null;
  return { position: idx + 1, etaMin: Math.max(1, Math.round((idx + 1) * 1.5)) };
}

const BLUE_SCRIPT = [
  "It shows 22% on room nights, but rooms should be 10% here.",
  "Ah, that was it. Thanks, all fixed now!",
];

class SupportStore {
  private state: State;
  private listeners = new Set<() => void>();
  private channels = new Map<string, Set<ChannelCb>>();
  private seq = { chat: 11, message: 100, log: 0, ticket: 42 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private scripted = new Map<number, number>();
  private epoch = 0;

  constructor() {
    this.state = this.seed();
  }

  /* ------------------------------------------------------------ plumbing */

  get = () => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    this.listeners.forEach((l) => l());
  }

  private log(kind: LogKind, text: string, detail?: string) {
    const entry = { id: ++this.seq.log, at: now(), kind, text, detail };
    this.set({ log: [entry, ...this.state.log].slice(0, 400) });
  }

  logHttp(who: string, text: string) {
    this.log("http", `${who}: ${text}`);
  }

  private chat(id: number) {
    return this.state.chats.find((c) => c.id === id);
  }

  private patchChat(id: number, patch: Partial<Chat>, bump = true): Chat {
    this.set({
      chats: this.state.chats.map((c) =>
        c.id === id ? { ...c, ...patch, rowVersion: bump ? c.rowVersion + 1 : c.rowVersion } : c,
      ),
    });
    return this.chat(id)!;
  }

  /** Inserts a message and, unless it is an internal note, moves the chat's head. */
  private post(m: Omit<Message, "id" | "uuid" | "createdAt">): Message {
    const msg: Message = { ...m, id: ++this.seq.message, uuid: uid(), createdAt: now() };
    this.set({ messages: [...this.state.messages, msg] });
    if (m.kind !== "note") {
      const patch: Partial<Chat> = { lastMessageId: msg.id, lastMessageAt: msg.createdAt };
      if (m.kind === "message" && (m.authorType === "tenant" || m.authorType === "platform")) {
        patch.lastMessageBy = m.authorType;
      }
      this.patchChat(m.chatId, patch);
    }
    return msg;
  }

  /* --------------------------------------------------------------- reverb */

  subscribeChannel(name: string, who: string, cb: ChannelCb): () => void {
    if (!this.channels.has(name)) this.channels.set(name, new Set());
    this.channels.get(name)!.add(cb);
    if (this.state.reverbUp) {
      this.log("auth", `${who} subscribed`, `POST …/realtime/auth → policy ok → signed ${name}`);
    }
    return () => {
      this.channels.get(name)?.delete(cb);
    };
  }

  private publish(channel: string, payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    if (!this.state.reverbUp) {
      this.log("dropped", `Reverb down, nudge not delivered: ${channel}`, body);
      return;
    }
    this.log("reverb", channel, body);
    const subs = this.channels.get(channel);
    if (!subs) return;
    setTimeout(() => subs.forEach((cb) => cb(payload)), 150);
  }

  private nudge(chatId: number, kind: string, toQueue = false) {
    const c = this.chat(chatId)!;
    this.publish(chatChannel(c), {
      v: 1,
      chat: c.uuid,
      last_message_id: c.lastMessageId,
      row_version: c.rowVersion,
      kind,
    });
    if (toQueue) this.publish(QUEUE_CHANNEL, { v: 1, chat: c.uuid, kind });
  }

  /* --------------------------------------------------------- availability */

  availability(): { available: boolean; reason?: "outside_hours" | "paused" | "no_agent" } {
    if (!this.state.withinHours) return { available: false, reason: "outside_hours" };
    if (this.state.paused) return { available: false, reason: "paused" };
    if (!this.state.agents.some((a) => a.status === "online")) return { available: false, reason: "no_agent" };
    return { available: true };
  }

  /* ------------------------------------------------ hotel side (SupportChats) */

  start(
    user: HotelUser,
    input: {
      topic: string;
      entityLabel?: string;
      body: string;
      attachments: Attachment[];
      clientKey: string;
      relatedChatId?: number;
      context: Chat["context"];
    },
  ): Result<Chat> {
    if (!this.availability().available) return fail("26106", "Support is offline right now.");
    if (containsCardNumber(input.body)) {
      return fail("CARD", "That looks like a card number. Please don't share card details in chat.");
    }

    const open = this.state.chats.find((c) => c.openedByUserId === user.id && isLive(c));
    if (open) {
      const retried = this.state.messages.some((m) => m.chatId === open.id && m.clientKey === input.clientKey);
      if (retried) return ok(open);
      this.log("control_plane", "INSERT support_chats refused by uk_support_chats_open_user", "26100 ChatAlreadyOpen");
      return fail("26100", `You already have an open chat (${open.chatNumber}).`);
    }

    const issue = ISSUES[input.topic];
    const related = input.relatedChatId ? this.chat(input.relatedChatId) : undefined;
    let priority: Priority = issue?.priority ?? "normal";
    if (related) {
      const order: Priority[] = ["urgent", "high", "normal", "low"];
      priority = order[Math.max(0, order.indexOf(priority) - 1)];
    }

    const manager = related?.assignedAgentId ?? ACCOUNT_MANAGERS[user.tenantCode];
    const preferred = this.state.agents.find((a) => a.id === manager && a.status === "online")?.id;

    const id = ++this.seq.chat;
    const t = now();
    const chat: Chat = {
      id,
      uuid: uid(),
      chatNumber: `${user.tenantCode}-C${String(id).padStart(5, "0")}`,
      tenantCode: user.tenantCode,
      tenantName: user.tenantName,
      propertyName: user.propertyName,
      openedByUserId: user.id,
      openedByName: user.name,
      openedByEmail: user.email,
      openedByRole: user.role,
      locale: user.locale,
      status: "waiting",
      topic: input.topic,
      entityLabel: input.entityLabel,
      priority,
      preferredAgentId: preferred,
      slaDueAt: t + SLA_SECONDS[priority] * 1000,
      lastMessageId: 0,
      lastMessageAt: t,
      lastMessageBy: "tenant",
      tenantLastSeenMessageId: 0,
      platformLastSeenMessageId: 0,
      tenantPushedMessageId: 0,
      relatedChatId: related?.id,
      context: input.context,
      rowVersion: 0,
      createdAt: t,
    };
    this.set({ chats: [...this.state.chats, chat] });
    this.log(
      "control_plane",
      `BEGIN · INSERT support_chats ${chat.chatNumber}`,
      `status=waiting topic=${chat.topic} priority=${priority}${chat.entityLabel ? ` entity="${chat.entityLabel}"` : ""}${related ? ` related_chat_id=${related.id}` : ""}${preferred ? ` preferred=${preferred}` : ""}`,
    );

    this.post({ chatId: id, kind: "event", eventCode: "started", authorType: "tenant", authorId: user.id, authorName: user.name });
    this.post({
      chatId: id,
      kind: "message",
      authorType: "tenant",
      authorId: user.id,
      authorName: user.name,
      body: input.body,
      clientKey: input.clientKey,
      attachments: input.attachments.length ? input.attachments : undefined,
    });
    this.post({
      chatId: id,
      kind: "message",
      authorType: "system",
      authorName: "4ROOMS",
      body: `Thanks ${user.firstName}, we've got your message about "${issue?.label ?? "your issue"}". An agent will join shortly.`,
    });
    this.log(
      "control_plane",
      `INSERT support_chat_messages ×3${input.attachments.length ? ` · INSERT support_chat_attachments ×${input.attachments.length}` : ""} · INSERT support_chat_audit_outbox · COMMIT`,
    );
    this.log("tenant_db", `[${user.tenantCode}] INSERT audit_log (support.chat.start)`, "after commit, outbox row marked delivered");
    this.nudge(id, "started", true);
    return ok(this.chat(id)!);
  }

  say(user: HotelUser, chatId: number, body: string, clientKey: string, attachments: Attachment[] = []): Result<Message> {
    const c = this.chat(chatId);
    if (!c || c.openedByUserId !== user.id) return fail("404", "Not found.");
    const retried = this.state.messages.find((m) => m.chatId === chatId && m.clientKey === clientKey && m.authorType === "tenant");
    if (retried) return ok(retried);
    if (!isLive(c)) return fail("26102", "This chat has ended.");
    if (containsCardNumber(body)) {
      return fail("CARD", "That looks like a card number. Please don't share card details in chat.");
    }

    const msg = this.post({
      chatId,
      kind: "message",
      authorType: "tenant",
      authorId: user.id,
      authorName: user.name,
      body,
      clientKey,
      attachments: attachments.length ? attachments : undefined,
    });
    if (c.idlePromptedAt) this.patchChat(chatId, { idlePromptedAt: undefined }, false);
    this.log(
      "control_plane",
      `UPDATE support_chats · INSERT support_chat_messages${attachments.length ? " · INSERT support_chat_attachments" : ""} · INSERT support_chat_audit_outbox`,
      `${c.chatNumber} message #${msg.id}`,
    );
    this.log("tenant_db", `[${user.tenantCode}] INSERT audit_log (support.chat.reply)`);
    this.nudge(chatId, "message", true);
    return ok(msg);
  }

  markSeen(side: "tenant" | "platform", chatId: number, upto: number) {
    const c = this.chat(chatId);
    if (!c) return;
    const field = side === "tenant" ? "tenantLastSeenMessageId" : "platformLastSeenMessageId";
    if (upto <= c[field]) return;
    this.patchChat(chatId, { [field]: upto } as Partial<Chat>, false);
    this.log("control_plane", `UPDATE support_chats SET ${side}_last_seen_message_id=${upto}`, c.chatNumber);
    this.nudge(chatId, "seen");
  }

  endChat(user: HotelUser, chatId: number): Result<Chat> {
    const c = this.chat(chatId);
    if (!c || c.openedByUserId !== user.id) return fail("404", "Not found.");
    if (!isLive(c)) return fail("26103", "This chat has already ended.");
    this.patchChat(chatId, { status: "resolved", endedAt: now(), endedBy: "tenant" });
    this.post({ chatId, kind: "event", eventCode: "ended", authorType: "tenant", authorId: user.id, authorName: user.name });
    this.log("control_plane", "UPDATE support_chats SET status=resolved, ended_by=tenant · INSERT event · INSERT audit outbox", c.chatNumber);
    this.log("tenant_db", `[${c.tenantCode}] INSERT audit_log (support.chat.resolve)`);
    this.nudge(chatId, "resolved", true);
    return ok(this.chat(chatId)!);
  }

  answerFixed(user: HotelUser, chatId: number, fixed: boolean): Result<Chat | null> {
    const c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    this.patchChat(chatId, { resolutionConfirmed: fixed ? "yes" : "no" }, false);
    this.log("control_plane", `UPDATE support_chats SET resolution_confirmed='${fixed ? "yes" : "no"}'`, c.chatNumber);
    if (fixed) return ok(null);
    return this.start(user, {
      topic: c.topic,
      entityLabel: c.entityLabel,
      body: `Still not fixed (continuing from ${c.chatNumber}).`,
      attachments: [],
      clientKey: uid(),
      relatedChatId: c.id,
      context: c.context,
    });
  }

  rate(chatId: number, rating: number, comment: string) {
    const c = this.chat(chatId);
    if (!c) return;
    this.patchChat(chatId, { rating, ratingComment: comment || undefined }, false);
    this.log("control_plane", `UPDATE support_chats SET rating=${rating}${comment ? ", rating_comment=…" : ""}`, c.chatNumber);
  }

  convert(user: HotelUser, chatId: number): Result<string> {
    const c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    if (isLive(c) || c.convertedTicketNumber) return fail("26104", "This chat can't be converted.");
    const number = `${c.tenantCode}-${String(++this.seq.ticket).padStart(5, "0")}`;
    this.patchChat(chatId, { convertedTicketNumber: number });
    this.addTicket({ number, subject: `Live chat ${c.chatNumber}: ${ISSUES[c.topic]?.label ?? c.topic}`, status: "Open", updatedAt: now(), openedByUserId: user.id, tenantCode: c.tenantCode });
    this.post({ chatId, kind: "event", eventCode: "converted", authorType: "tenant", authorId: user.id, authorName: user.name, meta: { type: "ticket", number } });
    this.log("control_plane", `INSERT support_tickets ${number} (transcript, notes excluded) · UPDATE support_chats SET converted_ticket_id`, c.chatNumber);
    this.log("tenant_db", `[${c.tenantCode}] INSERT audit_log (support.chat.convert)`);
    this.nudge(chatId, "converted", true);
    return ok(number);
  }

  emailTranscript(chatId: number) {
    const c = this.chat(chatId);
    if (!c) return;
    this.patchChat(chatId, { transcriptEmailedAt: now() }, false);
    this.log("email", `Brevo (platform mailer) → ${c.openedByEmail}`, `Transcript ${c.chatNumber}, notes excluded`);
  }

  helpSession(user: HotelUser, topic: string, outcome: "self_solved" | "chat" | "ticket") {
    this.log("control_plane", `INSERT support_help_sessions outcome=${outcome}`, `${user.tenantCode} topic=${topic}`);
  }

  raiseTicket(user: HotelUser, topic: string, body: string): Ticket {
    const number = `${user.tenantCode}-${String(++this.seq.ticket).padStart(5, "0")}`;
    const ticket: Ticket = { number, subject: ISSUES[topic]?.label ?? "Support request", status: "Open", updatedAt: now(), openedByUserId: user.id, tenantCode: user.tenantCode };
    this.addTicket(ticket);
    this.log("control_plane", `INSERT support_tickets ${number} · INSERT support_ticket_messages`, body ? `"${body.slice(0, 60)}"` : undefined);
    this.log("tenant_db", `[${user.tenantCode}] INSERT audit_log (support.tickets.create)`);
    this.log("email", "Brevo → account managers", `New ticket ${number}`);
    return ticket;
  }

  private addTicket(t: Ticket) {
    this.set({ tickets: [t, ...this.state.tickets] });
  }

  /* -------------------------------------------- admin side (PlatformChats) */

  private agentName(id?: string) {
    return this.state.agents.find((a) => a.id === id)?.name ?? "Someone";
  }

  private isAway(agentId: string) {
    return this.state.agents.find((a) => a.id === agentId)?.status === "away";
  }

  private audit(action: string, c: Chat, agentId: string, detail?: string) {
    this.log("control_plane", `INSERT platform_audit_log ${action}`, `${c.chatNumber} by ${agentId}${detail ? ` · ${detail}` : ""}`);
  }

  claim(chatId: number, agentId: string): Result<Chat> {
    const c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    if (c.status !== "waiting" || c.assignedAgentId) {
      this.log("control_plane", "UPDATE support_chats … WHERE status='waiting' AND assigned IS NULL → 0 rows", `${c.chatNumber} · 26101 ChatNotClaimable`);
      return fail("26101", `${this.agentName(c.assignedAgentId)} already took this chat.`);
    }
    // Away means "no new work": a claim (including claim-by-reply) is new work.
    if (this.isAway(agentId)) {
      this.log("control_plane", "claim refused: agent is Away", `${c.chatNumber} · 26108 AgentAway`);
      return fail("26108", "You're set to Away. Go online to take new chats.");
    }
    this.patchChat(chatId, { status: "active", assignedAgentId: agentId, claimedAt: now(), preferredAgentId: undefined });
    this.post({ chatId, kind: "event", eventCode: "claimed", authorType: "platform", authorId: agentId, authorName: this.agentName(agentId) });
    this.log("control_plane", "UPDATE support_chats … WHERE status='waiting' AND assigned IS NULL → 1 row · INSERT event", c.chatNumber);
    this.audit("support.chat.claimed", c, agentId);
    this.nudge(chatId, "claimed", true);
    return ok(this.chat(chatId)!);
  }

  agentSay(chatId: number, agentId: string, body: string, meta?: Meta): Result<Message> {
    let c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    if (!isLive(c)) return fail("26102", "This chat has ended.");
    if (c.status === "waiting" && !c.assignedAgentId) {
      const claimed = this.claim(chatId, agentId);
      if (!claimed.ok) return claimed;
      c = claimed.value;
    }
    if (c.assignedAgentId !== agentId) {
      this.log("control_plane", "agent reply refused", `${c.chatNumber} · 26105 ChatNotAssignee`);
      return fail("26105", `Only ${this.agentName(c.assignedAgentId)} can reply. Transfer it to you first.`);
    }
    const msg = this.post({ chatId, kind: "message", authorType: "platform", authorId: agentId, authorName: this.agentName(agentId), body, meta });
    if (!c.firstResponseAt) this.patchChat(chatId, { firstResponseAt: now() }, false);
    const typing = { ...this.state.typing };
    delete typing[chatId];
    this.set({ typing });
    this.log("control_plane", "UPDATE support_chats · INSERT support_chat_messages", `${c.chatNumber} message #${msg.id}${meta ? ` meta=${meta.type}` : ""}`);
    this.audit("support.chat.replied", c, agentId);
    this.nudge(chatId, "message", true);

    const step = this.scripted.get(chatId);
    if (step !== undefined && step < BLUE_SCRIPT.length) {
      this.scripted.set(chatId, step + 1);
      setTimeout(() => {
        const live = this.chat(chatId);
        if (!live || !isLive(live)) return;
        this.markSeen("tenant", chatId, live.lastMessageId);
        this.say(MARCO, chatId, BLUE_SCRIPT[step], uid());
      }, 3500);
    }
    return ok(msg);
  }

  note(chatId: number, agentId: string, body: string): Result<Message> {
    const c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    const msg = this.post({ chatId, kind: "note", authorType: "platform", authorId: agentId, authorName: this.agentName(agentId), body });
    this.log("control_plane", "INSERT support_chat_messages kind=note (chat row untouched)", c.chatNumber);
    this.audit("support.chat.noted", c, agentId);
    this.publish(staffChannel(c), { v: 1, chat: c.uuid, kind: "note" });
    return ok(msg);
  }

  transfer(chatId: number, actorId: string, toId: string): Result<Chat> {
    const c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    if (c.status !== "active") return fail("26102", "Only active chats can be transferred.");
    if (c.assignedAgentId !== actorId && toId !== actorId) {
      return fail("26105", "Only the assignee can hand this chat to someone else.");
    }
    if (c.assignedAgentId === toId) return ok(c);
    if (this.isAway(toId)) {
      this.log("control_plane", "transfer refused: target agent is Away", `${c.chatNumber} · 26108 AgentAway`);
      return fail("26108", toId === actorId ? "You're set to Away. Go online to take over chats." : `${this.agentName(toId)} is Away and can't take new chats.`);
    }
    this.patchChat(chatId, { assignedAgentId: toId });
    this.post({ chatId, kind: "event", eventCode: "transferred", authorType: "platform", authorId: toId, authorName: this.agentName(toId) });
    this.log("control_plane", `UPDATE support_chats SET assigned_platform_user_id=${toId} WHERE row_version=${c.rowVersion} · INSERT event`, c.chatNumber);
    this.audit(toId === actorId ? "support.chat.takeover" : "support.chat.transferred", c, actorId, `→ ${toId}`);
    this.nudge(chatId, "transferred", true);
    return ok(this.chat(chatId)!);
  }

  resolve(chatId: number, agentId: string, reason: string, askFixed: boolean, emailTranscript: boolean): Result<Chat> {
    const c = this.chat(chatId);
    if (!c) return fail("404", "Not found.");
    if (c.status !== "active") return fail("26103", "This chat has already ended.");
    if (c.assignedAgentId !== agentId) return fail("26105", "Only the assignee can resolve this chat.");
    this.patchChat(chatId, { status: "resolved", endedAt: now(), endedBy: "platform", resolutionCode: reason, askedFixed: askFixed });
    this.post({ chatId, kind: "event", eventCode: "resolved", authorType: "platform", authorId: agentId, authorName: this.agentName(agentId) });
    this.log("control_plane", `UPDATE support_chats SET status=resolved, resolution_code=${reason} · INSERT event`, c.chatNumber);
    this.audit("support.chat.resolved", c, agentId, reason);
    if (emailTranscript) this.emailTranscript(chatId);
    this.nudge(chatId, "resolved", true);
    return ok(this.chat(chatId)!);
  }

  setPriority(chatId: number, agentId: string, priority: Priority) {
    const c = this.chat(chatId);
    if (!c || c.priority === priority) return;
    this.patchChat(chatId, { priority, slaDueAt: c.createdAt + SLA_SECONDS[priority] * 1000 });
    this.audit("support.chat.priority", c, agentId, `${c.priority} → ${priority}`);
    this.nudge(chatId, "priority", true);
  }

  redact(messageId: number, agentId: string) {
    const m = this.state.messages.find((x) => x.id === messageId);
    if (!m || m.redactedAt) return;
    this.set({
      messages: this.state.messages.map((x) => (x.id === messageId ? { ...x, redactedAt: now(), attachments: undefined } : x)),
    });
    const c = this.chat(m.chatId)!;
    this.patchChat(c.id, {});
    this.log("control_plane", `UPDATE support_chat_messages SET body=NULL, redacted_at, redacted_by=${agentId} · DELETE attachments`, `${c.chatNumber} message #${messageId}`);
    this.audit("support.chat.redacted", c, agentId, `message #${messageId}`);
    this.nudge(c.id, "redacted");
  }

  setTyping(chatId: number, agentId: string) {
    const current = this.state.typing[chatId];
    if (current && current.until - now() > 1500) return;
    this.set({ typing: { ...this.state.typing, [chatId]: { agentId, until: now() + 3000 } } });
    this.log("http", `Admin (${agentId}): POST /support/chats/{uuid}/typing`, "server relays it; client events stay off");
    this.nudge(chatId, "typing");
  }

  /* ------------------------------------------------------ settings and sim */

  setAgentStatus(agentId: string, status: Agent["status"]) {
    this.set({ agents: this.state.agents.map((a) => (a.id === agentId ? { ...a, status } : a)) });
    this.log("control_plane", `UPSERT support_chat_presence status=${status}`, agentId);
    this.publish(QUEUE_CHANNEL, { v: 1, kind: "presence" });
  }

  setPaused(paused: boolean) {
    this.set({ paused });
    this.log("control_plane", `UPDATE platform_settings support.chat_queue_paused=${paused}`);
    this.publish(QUEUE_CHANNEL, { v: 1, kind: "paused" });
  }

  setIncident(text: string | null) {
    this.set({ incident: text });
    this.log("control_plane", text ? "INSERT support_incidents" : "UPDATE support_incidents SET ends_at=now()", text ?? undefined);
  }

  setWithinHours(withinHours: boolean) {
    this.set({ withinHours });
  }

  setReverb(up: boolean) {
    this.set({ reverbUp: up });
    this.log(up ? "reverb" : "dropped", up ? "Reverb connected, clients back on nudges" : "Reverb down, clients fall back to polling");
  }

  setMissedSeconds(s: number) {
    this.set({ config: { ...this.state.config, missedSeconds: s } });
  }

  simulateIncoming(): Result<Chat> {
    const issue = CATEGORIES[2].issues[0];
    const res = this.start(MARCO, {
      topic: issue.key,
      entityLabel: "INV-2026-0452",
      body: "Hi, the VAT on INV-2026-0452 looks too high, can you check?",
      attachments: [],
      clientKey: uid(),
      context: { page: "finance.invoices.show", app: "web · Firefox" },
    });
    if (res.ok) this.scripted.set(res.value.id, 0);
    return res;
  }

  reset() {
    this.seq = { chat: 11, message: 100, log: 0, ticket: 42 };
    this.scripted.clear();
    this.epoch += 1;
    this.state = this.seed();
    this.listeners.forEach((l) => l());
  }

  /* ---------------------------------------------------------------- sweep */

  start_sweep() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop_sweep() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const t = now();
    const cfg = this.state.config;

    for (const { id } of this.state.chats) {
      let c = this.chat(id)!;

      if (c.status === "waiting" && !c.assignedAgentId) {
        if (c.preferredAgentId && t - c.createdAt > PREFER_SECONDS * 1000) {
          c = this.patchChat(id, { preferredAgentId: undefined });
          this.log("sweep", "Preferred agent didn't pick it up, moved to the shared queue", c.chatNumber);
          this.publish(QUEUE_CHANNEL, { v: 1, chat: c.uuid, kind: "rerouted" });
        }
        if (!c.nudgeEmailedAt && t - c.createdAt > cfg.nudgeSeconds * 1000) {
          c = this.patchChat(id, { nudgeEmailedAt: t }, false);
          this.log("email", `Brevo → account manager of ${c.tenantCode} (${ACCOUNT_MANAGERS[c.tenantCode] ?? "fallback inbox"})`, `${c.chatNumber} waiting ${cfg.nudgeSeconds}s unclaimed`);
        }
        if (t - c.createdAt > cfg.missedSeconds * 1000) {
          c = this.patchChat(id, { status: "missed", endedAt: t, endedBy: "system", missedNotifiedAt: t });
          this.post({ chatId: id, kind: "event", eventCode: "missed", authorType: "system" });
          this.log("sweep", "UPDATE support_chats SET status=missed WHERE status='waiting' AND assigned IS NULL", c.chatNumber);
          this.log("tenant_db", `[${c.tenantCode}] via withTenant: INSERT notifications (support.chat_missed)`, "params: chat_number only");
          this.log("push", `FCM → ${c.openedByName}'s devices`, `{"kind":"support.chat","chat":"${c.chatNumber}"} (no message text)`);
          this.log("email", `→ ${c.openedByEmail}`, `Sorry we missed you, continue ${c.chatNumber} as a ticket`);
          this.nudge(id, "missed", true);
        }
        continue;
      }

      if (c.status === "active") {
        const unseen = c.lastMessageId > c.tenantLastSeenMessageId && c.lastMessageId > c.tenantPushedMessageId;
        if (c.lastMessageBy === "platform" && unseen && t - c.lastMessageAt > cfg.pushDelaySeconds * 1000) {
          c = this.patchChat(id, { tenantPushedMessageId: c.lastMessageId }, false);
          this.log("tenant_db", `[${c.tenantCode}] via withTenant: INSERT notifications (support.chat_reply)`, "opener hasn't seen the reply");
          this.log("push", `FCM → ${c.openedByName}'s devices`, `{"kind":"support.chat","chat":"${c.chatNumber}"}`);
        }
        if (c.lastMessageBy === "platform" && !c.idlePromptedAt && t - c.lastMessageAt > cfg.idleSeconds * 1000) {
          this.post({
            chatId: id,
            kind: "message",
            authorType: "system",
            authorName: "4ROOMS",
            body: `Are you still there? This chat will close in ${cfg.idleCloseSeconds} seconds if we don't hear back.`,
            meta: { type: "quick_reply", options: ["I'm here"] },
          });
          c = this.patchChat(id, { idlePromptedAt: t }, false);
          this.log("sweep", "Hotel idle after agent reply → 'Are you still there?'", c.chatNumber);
          this.nudge(id, "idle_prompt");
        } else if (c.idlePromptedAt && c.lastMessageBy === "platform" && t - c.idlePromptedAt > cfg.idleCloseSeconds * 1000) {
          c = this.patchChat(id, { status: "resolved", endedAt: t, endedBy: "system", resolutionCode: "no_response" });
          this.post({ chatId: id, kind: "event", eventCode: "closed_inactive", authorType: "system" });
          this.log("sweep", "UPDATE support_chats SET status=resolved, resolution_code=no_response", c.chatNumber);
          this.nudge(id, "resolved", true);
        }
      }
    }

    const expired = Object.entries(this.state.typing).filter(([, v]) => v.until < t);
    if (expired.length) {
      const typing = { ...this.state.typing };
      for (const [k] of expired) delete typing[Number(k)];
      this.set({ typing });
      for (const [k] of expired) {
        if (this.chat(Number(k))) this.nudge(Number(k), "typing");
      }
    }
  }

  /* ----------------------------------------------------------------- seed */

  private seed(): State {
    const t = now();
    const min = 60_000;
    const day = 86_400_000;
    const mk = (c: Partial<Chat> & Pick<Chat, "id" | "chatNumber" | "tenantCode" | "tenantName" | "propertyName" | "openedByUserId" | "openedByName" | "openedByEmail" | "openedByRole" | "status" | "topic" | "priority" | "createdAt">): Chat => ({
      uuid: uid(),
      locale: "en",
      slaDueAt: c.createdAt + SLA_SECONDS[c.priority] * 1000,
      lastMessageId: 0,
      lastMessageAt: c.createdAt,
      lastMessageBy: "tenant",
      tenantLastSeenMessageId: 0,
      platformLastSeenMessageId: 0,
      tenantPushedMessageId: 0,
      context: { page: "dashboard", app: "web · Chrome" },
      rowVersion: 1,
      ...c,
    });

    const chats: Chat[] = [
      mk({
        id: 9, chatNumber: "ACME-C00009", tenantCode: "ACME", tenantName: "Acme Hotel", propertyName: "Seaside",
        openedByUserId: "ACME:17", openedByName: "Priya Shah", openedByEmail: "priya@acme-hotel.test", openedByRole: "Front desk",
        status: "resolved", topic: "login.colleague", priority: "normal", assignedAgentId: "ravi", claimedAt: t - 3 * day + 2 * min,
        firstResponseAt: t - 3 * day + 2 * min, endedAt: t - 3 * day + 9 * min, endedBy: "platform", resolutionCode: "how_to",
        resolutionConfirmed: "yes", rating: 4, createdAt: t - 3 * day, lastMessageId: 4, lastMessageAt: t - 3 * day + 9 * min,
        lastMessageBy: "platform", tenantLastSeenMessageId: 4, platformLastSeenMessageId: 4,
      }),
      mk({
        id: 10, chatNumber: "GRAND-C00010", tenantCode: "GRAND", tenantName: "Grand Plaza", propertyName: "City",
        openedByUserId: "GRAND:8", openedByName: "Lena Fischer", openedByEmail: "lena@grandplaza.test", openedByRole: "Revenue",
        status: "active", topic: "rates.not_applying", priority: "high", assignedAgentId: "ravi", claimedAt: t - 5 * min,
        firstResponseAt: t - 5 * min, createdAt: t - 6 * min, lastMessageId: 8, lastMessageAt: t - 2 * min, lastMessageBy: "tenant",
        tenantLastSeenMessageId: 7, platformLastSeenMessageId: 8, locale: "de", context: { page: "rates.plans", app: "web · Safari" },
      }),
    ];

    const m = (id: number, chatId: number, rest: Omit<Message, "id" | "uuid" | "chatId">): Message => ({ id, uuid: uid(), chatId, ...rest });
    const messages: Message[] = [
      m(1, 9, { kind: "message", authorType: "tenant", authorId: "ACME:17", authorName: "Priya Shah", body: "Our night manager can't log in.", createdAt: t - 3 * day }),
      m(2, 9, { kind: "event", eventCode: "claimed", authorType: "platform", authorId: "ravi", authorName: "Ravi Kumar", createdAt: t - 3 * day + 2 * min }),
      m(3, 9, { kind: "message", authorType: "platform", authorId: "ravi", authorName: "Ravi Kumar", body: "I've sent a password reset link to them. It's valid for 30 minutes.", createdAt: t - 3 * day + 3 * min }),
      m(4, 9, { kind: "event", eventCode: "resolved", authorType: "platform", authorId: "ravi", authorName: "Ravi Kumar", createdAt: t - 3 * day + 9 * min }),
      m(5, 10, { kind: "message", authorType: "tenant", authorId: "GRAND:8", authorName: "Lena Fischer", body: "Our weekend rate plan isn't applying.", createdAt: t - 6 * min }),
      m(6, 10, { kind: "event", eventCode: "claimed", authorType: "platform", authorId: "ravi", authorName: "Ravi Kumar", createdAt: t - 5 * min }),
      m(7, 10, { kind: "message", authorType: "platform", authorId: "ravi", authorName: "Ravi Kumar", body: "Checking now. Which dates?", createdAt: t - 5 * min }),
      m(8, 10, { kind: "message", authorType: "tenant", authorId: "GRAND:8", authorName: "Lena Fischer", body: "This Saturday and Sunday.", createdAt: t - 2 * min }),
    ];

    return {
      version: 0,
      epoch: this.epoch,
      chats,
      messages,
      tickets: [
        { number: "ACME-00042", subject: "Invoice VAT wrong", status: "Waiting on you", updatedAt: t - day, openedByUserId: "ACME:17", tenantCode: "ACME" },
      ],
      agents: [
        { id: "asha", name: "Asha Menon", status: "online" },
        { id: "ravi", name: "Ravi Kumar", status: "online" },
        { id: "meera", name: "Meera Iyer", status: "away" },
      ],
      paused: false,
      withinHours: true,
      reverbUp: true,
      incident: null,
      typing: {},
      config: { missedSeconds: 90, nudgeSeconds: 30, pushDelaySeconds: 10, idleSeconds: 60, idleCloseSeconds: 45 },
      log: [],
    };
  }
}

export const store = new SupportStore();
