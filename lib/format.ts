import { ISSUES } from "./catalog";
import type { Message, Priority } from "./types";

export function topicLabel(topic: string) {
  const issue = ISSUES[topic];
  return issue ? `${issue.category} › ${issue.label}` : topic;
}

export function issueLabel(topic: string) {
  return ISSUES[topic]?.label ?? topic;
}

/** Event lines are rendered from a code plus the author name, never stored prose. */
export function eventText(m: Message, viewer: "tenant" | "platform"): string {
  const name = m.authorName ?? "Someone";
  switch (m.eventCode) {
    case "started":
      return "Chat started";
    case "claimed":
      return viewer === "tenant" ? `${name} joined` : `${name} claimed the chat`;
    case "transferred":
      return viewer === "tenant" ? `${name} is now helping you` : `Transferred to ${name}`;
    case "resolved":
      return `${name} marked this as resolved`;
    case "ended":
      return viewer === "tenant" ? "You ended the chat" : `${name} ended the chat`;
    case "missed":
      return "No agent was available in time";
    case "closed_inactive":
      return "Closed after no reply";
    case "converted":
      return `Continued as ticket ${m.meta?.type === "ticket" ? m.meta.number : ""}`;
    default:
      return m.eventCode ?? "";
  }
}

export const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  normal: "bg-slate-200 text-slate-700",
  low: "bg-slate-100 text-slate-500",
};

export const STATUS_STYLE: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  resolved: "bg-slate-200 text-slate-700",
  missed: "bg-rose-100 text-rose-700",
};

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
