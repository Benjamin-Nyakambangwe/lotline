"use client";

import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/** ABC's sites. Lots, auctions and collection are all per location. */
export const LOCATIONS = ["Harare", "Bulawayo"] as const;

const KEY = "lotline.location";

/** The location this viewer last chose ("all" or a site), remembered on this device. */
export function readLocationPref(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v !== "all" ? v : null;
  } catch {
    return null;
  }
}

export function writeLocationPref(v: string | null) {
  try {
    localStorage.setItem(KEY, v ?? "all");
  } catch {
    // private mode or storage blocked: the choice just isn't remembered
  }
}

/** All · Harare · Bulawayo, with counts. */
export function LocationSwitch({
  value,
  onChange,
  counts,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  counts?: Map<string, number>;
  className?: string;
}) {
  const total = counts
    ? [...counts.values()].reduce((a, b) => a + b, 0)
    : undefined;
  const options: { v: string | null; label: string; n?: number }[] = [
    { v: null, label: "All", n: total },
    ...LOCATIONS.map((l) => ({ v: l, label: l, n: counts?.get(l) })),
  ];
  return (
    <fieldset
      className={cn(
        "flex h-10 shrink-0 items-center gap-0.5 rounded-full border bg-card p-1",
        className,
      )}
    >
      <legend className="sr-only">Location</legend>
      <MapPin
        className="mx-1.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={active}
            onClick={() => {
              writeLocationPref(o.v);
              onChange(o.v);
            }}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.n !== undefined && (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  active ? "opacity-80" : "opacity-60",
                )}
              >
                {o.n.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
