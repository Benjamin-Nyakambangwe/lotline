"use client";

import { Copy, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deviceSignInLink } from "@/server/actions/device";

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * iPhone's Home Screen app doesn't share Safari's sign-in. From Safari, copy a one-time link,
 * then paste it on the app's sign-in page.
 */
export function AppSignIn() {
  const [inApp, setInApp] = useState(true);
  useEffect(() => setInApp(standalone()), []);
  const [busy, start] = useTransition();
  if (inApp) return null;
  const copy = () =>
    start(async () => {
      const r = await deviceSignInLink();
      if (!r.ok) {
        toast.error("Couldn't make a link right now. Try again in a minute.");
        return;
      }
      try {
        await navigator.clipboard.writeText(r.url);
        toast.success(
          "Copied. Open Lotline from your Home Screen and paste it on the sign-in page.",
          {
            duration: 10_000,
          },
        );
      } catch {
        toast.error("Couldn't copy here. Try again from Safari.");
      }
    });
  return (
    <div className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">
      <p className="text-muted-foreground">
        On iPhone, the Home Screen app signs in separately from Safari. After
        adding it, copy a one-time link here and paste it on the app's sign-in
        page (it works once, for 15 minutes).
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={copy}
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Copy />} Copy sign-in
        link for the app
      </Button>
    </div>
  );
}
