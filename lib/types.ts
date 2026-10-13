// Shapes mirror the planned control-plane tables in chat_support.md (Part 2),
// so the prototype doubles as a walkthrough of the data model.

export type ChatStatus = "waiting" | "active" | "resolved" | "missed";
export type AuthorType = "tenant" | "platform" | "system";
export type MessageKind = "message" | "event" | "note";
export type Priority = "low" | "normal" | "high" | "urgent";
export type EndedBy = "tenant" | "platform" | "system";

export type Meta =
  | { type: "article"; path: string }
  | { type: "quick_reply"; options: string[] }
  | { type: "ticket"; number: string };

export interface Attachment {
  uuid: string;
  name: string;
  sizeKb: number;
  isImage: boolean;
  previewUrl?: string;
}

/** support_chat_messages */
export interface Message {
  id: number;
  uuid: string;
  chatId: number;
  clientKey?: string;
  kind: MessageKind;
  eventCode?: string;
  authorType: AuthorType;
  authorId?: string;
  authorName?: string;
  body?: string;
  meta?: Meta;
  attachments?: Attachment[];
  createdAt: number;
  redactedAt?: number;
}

/** support_chats */
export interface Chat {
  id: number;
  uuid: string;
  chatNumber: string;
  tenantCode: string;
  tenantName: string;
  propertyName: string;
  openedByUserId: string;
  openedByName: string;
  openedByEmail: string;
  openedByRole: string;
  locale: string;
  status: ChatStatus;
  topic: string;
  entityLabel?: string;
  priority: Priority;
  assignedAgentId?: string;
  preferredAgentId?: string;
  claimedAt?: number;
  firstResponseAt?: number;
  slaDueAt: number;
  lastMessageId: number;
  lastMessageAt: number;
  lastMessageBy: "tenant" | "platform";
  tenantLastSeenMessageId: number;
  platformLastSeenMessageId: number;
  tenantPushedMessageId: number;
  nudgeEmailedAt?: number;
  missedNotifiedAt?: number;
  idlePromptedAt?: number;
  endedAt?: number;
  endedBy?: EndedBy;
  askedFixed?: boolean;
  resolutionCode?: string;
  resolutionConfirmed?: "yes" | "no";
  rating?: number;
  ratingComment?: string;
  convertedTicketNumber?: string;
  relatedChatId?: number;
  transcriptEmailedAt?: number;
  context: { page: string; errorRef?: string; app: string };
  rowVersion: number;
  createdAt: number;
}

export interface Ticket {
  number: string;
  subject: string;
  status: string;
  updatedAt: number;
  openedByUserId: string;
  tenantCode: string;
}

export interface Agent {
  id: string;
  name: string;
  status: "online" | "away";
}

export type LogKind =
  | "reverb"
  | "dropped"
  | "auth"
  | "http"
  | "control_plane"
  | "tenant_db"
  | "email"
  | "push"
  | "ai"
  | "sweep";

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  text: string;
  detail?: string;
}

export interface HotelUser {
  id: string;
  name: string;
  firstName: string;
  email: string;
  role: string;
  tenantCode: string;
  tenantName: string;
  propertyName: string;
  locale: string;
}

export interface Config {
  missedSeconds: number;
  nudgeSeconds: number;
  pushDelaySeconds: number;
  idleSeconds: number;
  idleCloseSeconds: number;
}

export interface State {
  version: number;
  epoch: number;
  chats: Chat[];
  messages: Message[];
  tickets: Ticket[];
  agents: Agent[];
  paused: boolean;
  withinHours: boolean;
  reverbUp: boolean;
  incident: string | null;
  typing: Record<number, { agentId: string; until: number }>;
  config: Config;
  log: LogEntry[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
