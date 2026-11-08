"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ladderDown, ladderUp } from "@/lib/domain/increments";
import { cn } from "@/lib/utils";

const toText = (c: number | null) => (c === null ? "" : String(c / 100));

/**
 * A dollar amount with ladder steppers. Saves on blur or Enter. While it has focus, live
 * updates never overwrite what the person is typing.
 */
export function MoneyInput({
  label,
  value,
  onSave,
  hint,
  className,
}: {
  label: string;
  /** cents */
  value: number | null;
  onSave: (cents: number | null) => void;
  hint?: React.ReactNode;
  className?: string;
}) {
  const [text, setText] = useState(toText(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(toText(value));
  }, [value]);

  const parse = (t: string) => {
    const n = Number(t.replace(/[$,\s]/g, ""));
    return t.trim() === "" || !Number.isFinite(n) || n <= 0
      ? null
      : Math.round(n * 100);
  };
  const commit = (t = text) => {
    const c = parse(t);
    if (c !== value) onSave(c);
  };
  const step = (dir: 1 | -1) => {
    const cur = parse(text);
    const next = cur === null ? 100 : dir > 0 ? ladderUp(cur) : ladderDown(cur);
    setText(toText(next));
    commit(toText(next));
  };

  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex h-10 items-center rounded-lg border bg-background focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/15">
        <button
          type="button"
          onClick={() => step(-1)}
          className="flex h-full w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={`Lower ${label.toLowerCase()} one bid step`}
        >
          <Minus className="size-4" />
        </button>
        <span className="text-sm text-muted-foreground">$</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="–"
          aria-label={label}
          className="w-full min-w-0 bg-transparent px-1 text-base font-semibold tabular-nums outline-none"
        />
        <button
          type="button"
          onClick={() => step(1)}
          className="flex h-full w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={`Raise ${label.toLowerCase()} one bid step`}
        >
          <Plus className="size-4" />
        </button>
      </span>
      {hint && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {hint}
        </span>
      )}
    </label>
  );
}
