"use client";

import { useEffect, useState } from "react";
import AdminSide from "./AdminSide";
import HotelSide from "./HotelSide";
import Inspector from "./Inspector";
import { useServer } from "@/lib/hooks";
import { store } from "@/lib/store";

type Layout = "split" | "hotel" | "admin";

export default function Prototype() {
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout>("split");
  const reverbUp = useServer((s) => s.reverbUp);
  const withinHours = useServer((s) => s.withinHours);
  const missedSeconds = useServer((s) => s.config.missedSeconds);
  const epoch = useServer((s) => s.epoch);
  const [note, setNote] = useState<string>();

  // Render only in the browser: the fake server lives in this tab's memory.
  useEffect(() => {
    setMounted(true);
    store.start_sweep();
    return () => store.stop_sweep();
  }, []);

  if (!mounted) return null;

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
        <span className="text-sm font-semibold">Live support chat · prototype</span>
        <span className="text-slate-400">in-memory, no backend · resets on reload</span>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded border border-slate-300">
            {(["split", "hotel", "admin"] as Layout[]).map((l) => (
              <button key={l} onClick={() => setLayout(l)} className={`px-2 py-1 capitalize ${layout === l ? "bg-slate-800 text-white" : "bg-white"}`}>
                {l === "split" ? "Both" : l}
              </button>
            ))}
          </div>
          <button
            onClick={() => store.setReverb(!reverbUp)}
            className={`rounded px-2 py-1 font-medium ${reverbUp ? "bg-violet-600 text-white" : "bg-rose-100 text-rose-700"}`}
            title="Toggle the socket to see the poll fallback"
          >
            {reverbUp ? "⚡ Reverb connected" : "✕ Reverb down (polling)"}
          </button>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={withinHours} onChange={(e) => store.setWithinHours(e.target.checked)} />
            Within support hours
          </label>
          <label className="flex items-center gap-1">
            Missed after
            <input
              type="number"
              min={20}
              value={missedSeconds}
              onChange={(e) => store.setMissedSeconds(Math.max(20, Number(e.target.value) || 20))}
              className="w-14 rounded border border-slate-300 px-1 py-0.5"
            />
            s
          </label>
          <button
            onClick={() => {
              const r = store.simulateIncoming();
              setNote(r.ok ? `Blue Bay started ${r.value.chatNumber}` : `Blue Bay couldn't start: ${r.message}`);
              setTimeout(() => setNote(undefined), 3000);
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1"
          >
            + Incoming chat (Blue Bay)
          </button>
          {note && <span className="text-slate-500">{note}</span>}
        </div>
      </div>

      <div key={epoch} className="flex min-h-0 flex-1">
        {layout !== "admin" && (
          <div className={`${layout === "split" ? "w-[40%] border-r border-slate-300" : "w-full"} min-w-0`}>
            <div className="border-b border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Hotel PMS · Priya (Acme Hotel)</div>
            <div className="h-[calc(100%-25px)]">
              <HotelSide />
            </div>
          </div>
        )}
        {layout !== "hotel" && (
          <div className={`${layout === "split" ? "w-[60%]" : "w-full"} min-w-0`}>
            <div className="border-b border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">4ROOMS admin panel</div>
            <div className="h-[calc(100%-25px)]">
              <AdminSide />
            </div>
          </div>
        )}
      </div>

      <Inspector />
    </div>
  );
}
