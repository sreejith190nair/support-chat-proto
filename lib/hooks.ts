"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { store } from "./store";
import type { State } from "./types";

/** God-view read of the "server", for the control bar and the inspector only. */
export function useServer<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}

/**
 * One side's own view of the data. It only changes when that side fetches:
 * after its own action, on a Reverb nudge, or on a poll tick.
 */
export function useSideSnapshot(): [State, () => void] {
  const [snap, setSnap] = useState<State>(() => store.get());
  const refresh = useCallback(() => setSnap(store.get()), []);
  return [snap, refresh];
}

/** Subscribes to Reverb channels; a nudge triggers a fetch (refresh). */
export function useChannels(channels: string[], who: string, onNudge: () => void) {
  const key = channels.join("|");
  const cb = useRef(onNudge);
  useEffect(() => {
    cb.current = onNudge;
  });
  useEffect(() => {
    if (!key) return;
    const offs = key.split("|").map((ch) =>
      store.subscribeChannel(ch, who, () => {
        store.logHttp(who, `nudge on ${ch.replace("private-cp.", "")} → GET delta`);
        cb.current();
      }),
    );
    return () => offs.forEach((off) => off());
  }, [key, who]);
}

/**
 * The poll driver: fast when Reverb is down, a slow safety poll when it is up,
 * nothing at all when `active` is false (e.g. a hotel user with no open chat).
 */
export function usePoll(active: boolean, fastMs: number, who: string, refresh: () => void) {
  const reverbUp = useServer((s) => s.reverbUp);
  useEffect(() => {
    if (!active) return;
    const ms = reverbUp ? 30_000 : fastMs;
    const id = setInterval(() => {
      store.logHttp(who, reverbUp ? "safety poll (30 s)" : `poll every ${fastMs / 1000} s (Reverb down)`);
      refresh();
    }, ms);
    return () => clearInterval(id);
  }, [active, reverbUp, fastMs, who, refresh]);

  useEffect(() => {
    if (active) refresh();
  }, [reverbUp, active, refresh]);
}

export function useNow(ms = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

export function ago(from: number, t: number) {
  const s = Math.max(0, Math.round((t - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function clock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
}
