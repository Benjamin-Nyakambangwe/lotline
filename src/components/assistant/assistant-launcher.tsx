"use client";

import { Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { AssistantChat } from "./assistant-chat";
import { useAssistantChat } from "./chat-provider";

const isPhone = () => window.matchMedia("(max-width: 1279px)").matches;

/**
 * Ask Lotline from anywhere: a floating button that opens the conversation in place. On
 * phones it's a sheet (never full screen); on wider screens a docked card that steps left of
 * an open lot panel. Hidden on the Ask Lotline page itself.
 */
export function AssistantLauncher() {
  const chat = useAssistantChat();
  const onPage = usePathname() === "/assistant";
  const { panelOpen: open, setPanelOpen: setOpen } = chat;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (onPage) return null;
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Lotline"
          className="fixed right-4 bottom-[calc(var(--sheet-h,0px)+env(safe-area-inset-bottom)+4.75rem)] z-40 flex h-14 items-center gap-2 rounded-full bg-primary px-4 text-primary-foreground shadow-xl shadow-primary/30 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:right-[calc(var(--panel-w,0px)+1.5rem)] lg:bottom-6"
        >
          <Sparkles className="size-5" aria-hidden="true" />
          <span className="font-semibold">Ask</span>
          {chat.busy && (
            <span
              className="size-2 animate-pulse rounded-full bg-primary-foreground"
              aria-hidden="true"
            />
          )}
        </button>
      )}
      {open && (
        <section
          aria-label="Ask Lotline"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border bg-background shadow-2xl",
            // Phone: a sheet up to 70% of the screen. Wider: a docked card.
            "inset-x-0 bottom-0 h-[70dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
            "lg:inset-x-auto lg:right-[calc(var(--panel-w,0px)+1.5rem)] lg:bottom-6 lg:h-[min(640px,calc(100dvh-3rem))] lg:w-[400px] lg:rounded-2xl lg:pb-0",
          )}
        >
          <AssistantChat
            variant="panel"
            onClose={() => setOpen(false)}
            onLotOpen={() => {
              // Phones: step aside so the lot sheet shows; the chat is still here when reopened.
              if (isPhone()) setOpen(false);
            }}
          />
        </section>
      )}
    </>
  );
}
