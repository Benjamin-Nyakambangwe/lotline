import { ArrowDown, Check, RefreshCw, Timer } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

// M0 placeholder: proves the theme tokens, fonts and status palette render.
// The real app shell (sidebar, bottom tabs, dashboard) arrives in M2.
const statuses = [
  { label: "Winning", icon: Check, className: "bg-win-bg text-win" },
  { label: "Outbid", icon: ArrowDown, className: "bg-outbid-bg text-outbid" },
  { label: "Closing", icon: Timer, className: "bg-closing-bg text-closing" },
  {
    label: "Extended",
    icon: RefreshCw,
    className: "bg-extended-bg text-extended",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Wordmark className="text-lg" />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <section className="mesh overflow-hidden rounded-2xl border bg-card p-6 sm:p-10">
          <p className="text-sm font-medium text-primary">Coming together</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
            Know your line on every lot.
          </h1>
          <p className="mt-4 max-w-prose text-text-2">
            Live prices, exact winning and outbid status, budgets that include
            fees, and what things actually sell for, for ABC Auctions.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border bg-background/60 p-4">
              <p className="text-xs text-muted-foreground">Next bid</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">$60</p>
            </div>
            <div className="rounded-xl border bg-background/60 p-4">
              <p className="text-xs text-muted-foreground">All-in</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">$72.13</p>
            </div>
            <div className="rounded-xl border bg-background/60 p-4">
              <p className="text-xs text-muted-foreground">Closes in</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                0:09:41
              </p>
            </div>
            <div className="rounded-xl border bg-background/60 p-4">
              <p className="text-xs text-muted-foreground">Lot</p>
              <p className="mt-1 font-mono text-2xl font-semibold">795373</p>
            </div>
          </div>
        </section>

        <section aria-label="Status palette" className="flex flex-wrap gap-2">
          {statuses.map(({ label, icon: Icon, className }) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${className}`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </span>
          ))}
        </section>
      </main>

      <footer className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        Lotline is an independent tool. Not affiliated with ABC Auctions.
      </footer>
    </div>
  );
}
