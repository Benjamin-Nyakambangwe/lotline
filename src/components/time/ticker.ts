"use client";

import { useSyncExternalStore } from "react";

/**
 * One shared 1-second clock for every countdown on screen, corrected by the server's clock
 * (phones are often minutes off). Components re-render once a second, together.
 */
let offsetMs = 0;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function start() {
  if (timer) return;
  timer = setInterval(() => {
    now = Date.now() + offsetMs;
    for (const l of listeners) l();
  }, 1000);
}

/** Align the client clock to a server timestamp (ISO). */
export function syncServerTime(serverNowIso: string | null | undefined) {
  if (!serverNowIso) return;
  const server = Date.parse(serverNowIso);
  if (Number.isFinite(server)) {
    offsetMs = server - Date.now();
    now = Date.now() + offsetMs;
  }
}

export const serverNow = () => Date.now() + offsetMs;

export function useNow(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      start();
      return () => {
        listeners.delete(cb);
        if (!listeners.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    () => now,
    () => 0,
  );
}
