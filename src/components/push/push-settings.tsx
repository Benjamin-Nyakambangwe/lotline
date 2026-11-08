"use client";

import {
  BellOff,
  BellRing,
  Loader2,
  Send,
  Share,
  SquarePlus,
} from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendTestAlert } from "@/server/actions/alerts";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "ios-install" }
  | { kind: "no-key" }
  | { kind: "denied" }
  | { kind: "off"; key: string; reg: ServiceWorkerRegistration }
  | {
      kind: "on";
      key: string;
      reg: ServiceWorkerRegistration;
      sub: PushSubscription;
    };

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** "iPhone · Safari": so a person can tell their devices apart. */
function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || isIOS()
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Computer";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${device} · ${isStandalone() ? "app" : browser}`;
}

const keyBytes = (b64: string) => {
  const s = atob(
    (b64 + "=".repeat((4 - (b64.length % 4)) % 4))
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
  );
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Alerts on this device: Web Push, with the iPhone "add to Home Screen" step when needed. */
export function PushSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, start] = useTransition();

  const check = useCallback(async () => {
    if (!("serviceWorker" in navigator))
      return setState({ kind: "unsupported" });
    if (isIOS() && !isStandalone()) return setState({ kind: "ios-install" });
    if (!("PushManager" in window) || !("Notification" in window))
      return setState({ kind: "unsupported" });
    const { key } = (await (await fetch("/api/push/key")).json()) as {
      key: string | null;
    };
    if (!key) return setState({ kind: "no-key" });
    if (Notification.permission === "denied")
      return setState({ kind: "denied" });
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setState(sub ? { kind: "on", key, reg, sub } : { kind: "off", key, reg });
  }, []);
  useEffect(() => {
    void check().catch(() => setState({ kind: "unsupported" }));
  }, [check]);

  const enable = () =>
    start(async () => {
      if (state.kind !== "off") return;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({ kind: "denied" });
        return;
      }
      try {
        const sub = await state.reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(state.key),
        });
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...sub.toJSON(), label: deviceLabel() }),
        });
        if (!res.ok) throw new Error(`subscribe ${res.status}`);
        setState({ kind: "on", key: state.key, reg: state.reg, sub });
        toast.success("Alerts are on for this device");
      } catch {
        toast.error(
          "Couldn't turn on alerts here. Try again, or check this browser's notification settings.",
        );
      }
    });

  const disable = () =>
    start(async () => {
      if (state.kind !== "on") return;
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: state.sub.endpoint }),
      });
      await state.sub.unsubscribe().catch(() => {});
      setState({ kind: "off", key: state.key, reg: state.reg });
    });

  const test = () =>
    start(async () => {
      await sendTestAlert();
      toast("Test sent: it should arrive within a few seconds");
    });

  return (
    <div>
      {state.kind === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking this device…
        </p>
      )}
      {state.kind === "on" && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm">
            <BellRing className="size-4 text-win" aria-hidden="true" />
            Alerts are on for this device. Outbid alerts arrive even when
            Lotline is closed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={test} disabled={busy}>
              <Send /> Send a test alert
            </Button>
            <Button variant="ghost" onClick={disable} disabled={busy}>
              <BellOff /> Turn off here
            </Button>
          </div>
        </div>
      )}
      {state.kind === "off" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Get outbid, closing-soon and won alerts on this device, even when
            Lotline isn't open.
          </p>
          <Button onClick={enable} disabled={busy} className="w-fit">
            {busy ? <Loader2 className="animate-spin" /> : <BellRing />} Turn on
            alerts
          </Button>
        </div>
      )}
      {state.kind === "ios-install" && (
        <div className="flex flex-col gap-2 text-sm">
          <p>On iPhone, alerts work once Lotline is on your Home Screen:</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>
              In Safari, tap{" "}
              <Share className="inline size-4" aria-label="Share" /> Share.
            </li>
            <li>
              Choose <SquarePlus className="inline size-4" aria-hidden="true" />{" "}
              <strong>Add to Home Screen</strong>, then Add.
            </li>
            <li>
              Open Lotline from your Home Screen, come back here, and turn on
              alerts.
            </li>
          </ol>
        </div>
      )}
      {state.kind === "denied" && (
        <p className="text-sm text-muted-foreground">
          Notifications are blocked for Lotline in this browser. Allow them in
          the browser's (or phone's) settings for this site, then reload.
        </p>
      )}
      {state.kind === "no-key" && (
        <p className="text-sm text-muted-foreground">
          Phone alerts aren't set up on the server yet. In-app alerts still work
          while Lotline is open.
        </p>
      )}
      {state.kind === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          This browser can't receive alerts. Chrome on Android, or Safari on
          iPhone (from the Home Screen), can.
        </p>
      )}
    </div>
  );
}
