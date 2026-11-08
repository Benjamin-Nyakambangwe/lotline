import { AlertTriangle, CircleAlert, Layers } from "lucide-react";
import { formatMoney } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

export interface Totals {
  won: number;
  leading: number;
  unfilled: number;
  worst: number;
  left: number | null;
}
export interface BudgetFlags {
  overBudget: boolean;
  overcommit: boolean;
  shortfall: boolean;
  overfill: boolean;
}

/**
 * The worst case against the budget, as one bar: won, leading (at your bid), the backups
 * planned for unfilled slots, and what's left. Over budget, the overrun shows past a marker.
 */
export function BudgetBar({
  budget,
  totals,
  size = "md",
}: {
  budget: number | null;
  totals: Totals;
  size?: "sm" | "md";
}) {
  const whole = Math.max(budget ?? 0, totals.worst, 1);
  const pct = (v: number) => `${(v / whole) * 100}%`;
  const over = budget !== null && totals.worst > budget;
  const parts = [
    { key: "won", v: totals.won, cls: "bg-win", label: "Won" },
    { key: "leading", v: totals.leading, cls: "bg-primary", label: "Leading" },
    {
      key: "planned",
      v: totals.unfilled,
      cls: "bg-[repeating-linear-gradient(135deg,var(--primary)_0_3px,transparent_3px_7px)] opacity-70",
      label: "Planned backups",
    },
  ];
  return (
    <div>
      <div
        className={cn(
          "relative flex w-full gap-0.5 overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-2" : "h-3",
        )}
        role="img"
        aria-label={`Worst case ${formatMoney(totals.worst)}${budget !== null ? ` of ${formatMoney(budget)}` : ""}`}
      >
        {parts.map((p) =>
          p.v > 0 ? (
            <span
              key={p.key}
              className={cn("h-full", p.cls)}
              style={{ width: pct(p.v) }}
            />
          ) : null,
        )}
        {over && budget !== null && (
          <span
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: pct(budget) }}
            aria-hidden="true"
          />
        )}
        {over && budget !== null && (
          <span
            className="absolute inset-y-0 right-0 bg-outbid/40"
            style={{ left: pct(budget) }}
            aria-hidden="true"
          />
        )}
      </div>
      {size === "md" && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-1.5">
              <span
                className={cn("size-2.5 rounded-sm", p.cls)}
                aria-hidden="true"
              />
              {p.label}{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatMoney(p.v)}
              </span>
            </li>
          ))}
          {budget !== null && (
            <li className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm bg-muted ring-1 ring-border"
                aria-hidden="true"
              />
              {over ? "Over by" : "Left"}{" "}
              <span
                className={cn(
                  "font-medium tabular-nums",
                  over ? "text-outbid" : "text-foreground",
                )}
              >
                {formatMoney(Math.abs(budget - totals.worst))}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The warnings, each with an icon and words (never colour alone). */
export function BudgetFlagChips({ flags }: { flags: BudgetFlags }) {
  const chips = [
    flags.overBudget && {
      icon: CircleAlert,
      text: "Over budget",
      cls: "bg-outbid-bg text-outbid",
    },
    flags.overcommit && {
      icon: AlertTriangle,
      text: "Leading on more than you need",
      cls: "bg-closing-bg text-closing",
    },
    flags.overfill && {
      icon: Layers,
      text: "Won more than you need",
      cls: "bg-closing-bg text-closing",
    },
    flags.shortfall && {
      icon: AlertTriangle,
      text: "Not enough backups",
      cls: "bg-closing-bg text-closing",
    },
  ].filter(Boolean) as {
    icon: typeof CircleAlert;
    text: string;
    cls: string;
  }[];
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(({ icon: Icon, text, cls }) => (
        <span
          key={text}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            cls,
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {text}
        </span>
      ))}
    </div>
  );
}
