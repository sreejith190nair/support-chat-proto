"use client";

import { useState } from "react";
import { useServer } from "@/lib/hooks";
import { store } from "@/lib/store";
import type { LogKind } from "@/lib/types";

const BADGE: Record<LogKind, { label: string; cls: string }> = {
  reverb: { label: "REVERB", cls: "bg-violet-600 text-white" },
  dropped: { label: "DROPPED", cls: "bg-rose-600 text-white" },
  auth: { label: "AUTH", cls: "bg-violet-200 text-violet-900" },
  http: { label: "HTTP", cls: "bg-slate-200 text-slate-700" },
  control_plane: { label: "CONTROL PLANE DB", cls: "bg-sky-600 text-white" },
  tenant_db: { label: "TENANT DB", cls: "bg-teal-600 text-white" },
  email: { label: "EMAIL", cls: "bg-amber-500 text-white" },
  push: { label: "PUSH", cls: "bg-orange-600 text-white" },
  ai: { label: "AI", cls: "bg-fuchsia-600 text-white" },
  sweep: { label: "SWEEP", cls: "bg-slate-700 text-white" },
};

const FILTERS: Record<string, LogKind[] | null> = {
  All: null,
  Reverb: ["reverb", "dropped", "auth"],
  Databases: ["control_plane", "tenant_db"],
  Notifications: ["email", "push"],
  AI: ["ai"],
  HTTP: ["http"],
  Sweep: ["sweep"],
};

export default function Inspector() {
  const log = useServer((s) => s.log);
  const [filter, setFilter] = useState("All");
  const [open, setOpen] = useState(true);
  const kinds = FILTERS[filter];
  const rows = kinds ? log.filter((e) => kinds.includes(e.kind)) : log;

  return (
    <div className={`flex flex-col border-t border-slate-300 bg-slate-950 text-slate-200 ${open ? "h-60" : "h-9"}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <button onClick={() => setOpen(!open)} className="font-semibold text-white">
          {open ? "▾" : "▸"} Inspector
        </button>
        <span className="text-slate-500">what the server, databases and Reverb do for each click</span>
        <div className="ml-auto flex gap-1">
          {Object.keys(FILTERS).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-0.5 ${filter === f ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"}`}>
              {f}
            </button>
          ))}
          <button onClick={() => store.reset()} className="ml-2 rounded px-2 py-0.5 text-slate-400 hover:text-white" title="Reset all demo data">
            ⟲ Reset
          </button>
        </div>
      </div>
      {open && (
        <div className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-[11px]">
          {rows.length === 0 && <div className="text-slate-600">Nothing yet. Open the hotel widget and start a chat.</div>}
          {rows.map((e) => (
            <div key={e.id} className="flex gap-2 border-b border-white/5 py-0.5">
              <span className="shrink-0 text-slate-500">{new Date(e.at).toLocaleTimeString()}</span>
              <span className={`shrink-0 rounded px-1.5 ${BADGE[e.kind].cls}`}>{BADGE[e.kind].label}</span>
              <span className="text-slate-100">{e.text}</span>
              {e.detail && <span className="truncate text-slate-500">{e.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
