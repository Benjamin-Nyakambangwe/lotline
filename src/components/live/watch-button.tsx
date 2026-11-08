"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setWatch } from "@/server/actions/watch";
import { useLive } from "./live-provider";

/** Watch or stop watching a lot. Watched lots are read live as they near their close. */
export function WatchButton({
  lotId,
  size = "lg",
  className,
}: {
  lotId: number;
  size?: "lg" | "sm" | "icon";
  className?: string;
}) {
  const live = useLive();
  const serverOn = live.watched.has(lotId);
  const [on, setOn] = useState(serverOn);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!pending) setOn(serverOn);
  }, [serverOn, pending]);

  const toggle = () =>
    start(async () => {
      const next = !on;
      setOn(next);
      live.setWatched(lotId, next);
      const res = await setWatch({ lotId, watching: next });
      if (!res.ok) {
        setOn(!next);
        toast.error(res.error);
      } else if (next)
        toast.success(
          "Watching: it's on your Watchlist, read live near the close",
        );
      live.refresh();
    });

  const Icon = pending ? Loader2 : on ? Eye : EyeOff;
  return (
    <Button
      type="button"
      variant={on ? "secondary" : "outline"}
      size={size}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Stop watching" : "Watch"}
      className={cn(size === "lg" && "h-11", className)}
    >
      <Icon className={cn(pending && "animate-spin")} />
      {size !== "icon" && (on ? "Watching" : "Watch")}
    </Button>
  );
}
