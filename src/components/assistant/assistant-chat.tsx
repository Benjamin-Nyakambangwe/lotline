"use client";

import {
  AlertCircle,
  ArrowUp,
  Check,
  History,
  Loader2,
  Maximize2,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ActionCard } from "./action-card";
import { type Item, useAssistantChat } from "./chat-provider";
import { AssistantMarkdown } from "./markdown";

const SUGGESTIONS = [
  "Which auctions close tonight?",
  "What do Dell OptiPlex 7060s usually sell for?",
  "Find a fridge I can get for under $100 all-in",
  "Plan a $300 homelab from this week's lots",
];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * The conversation, as a full page (`page`) or in the floating panel (`panel`). Both show the
 * same conversation, from AssistantChatProvider.
 */
export function AssistantChat({
  variant,
  onClose,
  onLotOpen,
}: {
  variant: "page" | "panel";
  onClose?: () => void;
  /** a lot link was tapped (the panel steps aside on phones) */
  onLotOpen?: () => void;
}) {
  const chat = useAssistantChat();
  const panel = variant === "panel";
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const m = chat.meta;
  const last = chat.items.at(-1);
  const thinking =
    chat.busy && (last?.role !== "assistant" || last.parts.length === 0);

  // Follow the answer as it streams in, if the reader is already near the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the chat grows
  useEffect(() => {
    if (panel) {
      const el = scroller.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240)
        el.scrollTop = el.scrollHeight;
    } else if (
      window.innerHeight + window.scrollY >
      document.body.scrollHeight - 320
    )
      bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.items, panel]);

  // A question someone started elsewhere ("Ask" on a lot): focus it, ready to send.
  useEffect(() => {
    if (chat.draft) box.current?.focus();
  }, [chat.draft]);

  const header = (
    <header
      className={cn(
        "flex items-center justify-between gap-3",
        panel ? "border-b px-4 py-3" : "mb-4",
      )}
    >
      <div className="min-w-0">
        {panel ? (
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Ask Lotline
          </h2>
        ) : (
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="size-6 text-primary" aria-hidden="true" />
            Ask Lotline
          </h1>
        )}
        {m?.ready && (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {money(m.allowance.leftCents)} of {money(m.allowance.capCents)} left
            this month
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Past conversations">
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Recent
            </DropdownMenuLabel>
            {m?.conversations.length ? (
              m.conversations.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => chat.open(c.id)}>
                  <span className="truncate">{c.title}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                No conversations yet
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant={panel ? "ghost" : "outline"}
          size={panel ? "icon" : "sm"}
          onClick={() => {
            chat.newChat();
            box.current?.focus();
          }}
          aria-label="New conversation"
        >
          <Plus />
          {!panel && "New"}
        </Button>
        {panel && (
          <>
            <Button
              asChild
              variant="ghost"
              size="icon"
              aria-label="Open full page"
            >
              <Link
                href={
                  chat.conversationId
                    ? `/assistant?c=${chat.conversationId}`
                    : "/assistant"
                }
                onClick={onClose}
              >
                <Maximize2 />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close Ask Lotline"
            >
              <X />
            </Button>
          </>
        )}
      </div>
    </header>
  );

  const conversation =
    chat.items.length === 0 ? (
      <div className={panel ? "py-4" : "py-6"}>
        <p className="text-sm text-muted-foreground">
          Ask about lots, prices and auctions. It searches Lotline's live
          catalogue and a year of past sales, and can add lots to your watchlist
          when you confirm. It never bids.
        </p>
        <div className={cn("mt-4 grid gap-2", !panel && "sm:grid-cols-2")}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!m?.ready || chat.busy}
              onClick={() => void chat.send(s)}
              className="rounded-xl border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-surface-2 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    ) : (
      <ol
        className="flex flex-col gap-5 py-4"
        aria-label="Conversation"
        aria-live="polite"
      >
        {chat.items.map((it, i) => (
          // Items only ever append, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <li key={i}>
            <ChatRow item={it} onLotOpen={onLotOpen} />
          </li>
        ))}
      </ol>
    );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void chat.send(chat.draft);
      }}
      className={cn(
        panel
          ? "border-t p-3"
          : "sticky bottom-[calc(var(--sheet-h,0px)+env(safe-area-inset-bottom)+4.25rem)] z-20 mt-4 lg:bottom-[calc(var(--sheet-h,0px)+1rem)]",
      )}
    >
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border bg-card p-2 focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/15",
          !panel && "shadow-lg",
        )}
      >
        <textarea
          ref={box}
          value={chat.draft}
          onChange={(e) => chat.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void chat.send(chat.draft);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={
            m?.ready === false
              ? "The assistant isn't switched on yet"
              : "Ask about lots, prices, auctions…"
          }
          aria-label="Ask Lotline"
          disabled={m?.ready === false}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        {chat.busy ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={chat.stop}
            aria-label="Stop"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!chat.draft.trim() || m?.ready === false}
            aria-label="Send"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );

  const notReady = m && !m.ready && (
    <div className="mt-3 rounded-xl border border-closing/40 bg-closing-bg p-3 text-sm text-closing">
      The assistant isn't switched on yet: the server needs an Anthropic API key
      (<code className="font-mono">ANTHROPIC_API_KEY</code>). Ask the owner.
    </div>
  );

  const body = (
    <>
      {notReady}
      {conversation}
      {thinking && (
        <p className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
          Thinking…
        </p>
      )}
      <div ref={bottom} className="h-1" />
    </>
  );

  if (panel)
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        >
          {body}
        </div>
        {composer}
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      {header}
      {body}
      {composer}
    </div>
  );
}

function ChatRow({ item, onLotOpen }: { item: Item; onLotOpen?: () => void }) {
  if (item.role === "user")
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 whitespace-pre-wrap text-primary-foreground">
          {item.text}
        </p>
      </div>
    );
  if (item.role === "error")
    return (
      <p
        className="flex items-start gap-2 rounded-xl border border-outbid/40 bg-outbid-bg p-3 text-sm text-outbid"
        role="alert"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {item.text}
      </p>
    );
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {item.parts.map((p, i) =>
          p.type === "text" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts only append
            <AssistantMarkdown key={i} text={p.text} onLotOpen={onLotOpen} />
          ) : p.type === "tool" ? (
            <ToolChip key={p.id} label={p.label} state={p.state} />
          ) : (
            <ActionCard key={p.action.id} action={p.action} />
          ),
        )}
      </div>
    </div>
  );
}

function ToolChip({
  label,
  state,
}: {
  label: string;
  state: "running" | "done" | "error";
}) {
  return (
    <p
      className={cn(
        "my-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        state === "error" ? "text-outbid" : "text-muted-foreground",
      )}
    >
      {state === "running" ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : state === "done" ? (
        <Check className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <X className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">{label}</span>
    </p>
  );
}
