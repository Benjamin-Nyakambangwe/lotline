import {
  ArrowRight,
  BadgeCheck,
  FolderKanban,
  Radio,
  Search,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

async function Dashboard() {
  const user = await requireUser();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Harare",
    }).format(new Date()),
  );
  const first = user.name.split(" ")[0] || "there";

  const steps = [
    {
      icon: Search,
      title: "Find lots worth watching",
      body: "Search the live catalogue, see what similar lots sold for, and watch the ones you want.",
      href: "/browse",
      cta: "Browse lots",
    },
    {
      icon: BadgeCheck,
      title: "Link your ABC bidder ID",
      body: "After your next bid, tap “That’s me” on the lot. From then on, winning and outbid are exact.",
      href: "/settings",
      cta: "How it works",
    },
    {
      icon: FolderKanban,
      title: "Plan a project",
      body: "Group lots into what you need, set an all-in budget, and line up backups in closing order.",
      href: "/projects",
      cta: "Start a project",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="mesh relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
        <p className="text-sm font-medium text-primary">
          {greeting(hour)}, {first}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          Nothing on the line yet.
        </h1>
        <p className="mt-3 max-w-prose text-text-2">
          When you watch or bid on lots, this is where you&apos;ll see
          what&apos;s closing next, where you&apos;re winning or outbid, and
          what you&apos;ve spent against your budgets.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Winning", "0"],
            ["Outbid", "0"],
            ["Closing ≤ 1 h", "0"],
            ["Spent this month", "$0"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-background/60 p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="getting-started">
        <h2
          id="getting-started"
          className="mb-3 text-sm font-semibold text-muted-foreground"
        >
          Getting started
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, body, href, cta }) => (
            <Link
              key={title}
              href={href}
              className="group flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-surface-2"
            >
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">
                {body}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                {cta}{" "}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex items-center gap-3 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        <Radio className="size-5 shrink-0 text-primary" aria-hidden="true" />
        On auction night, the Live tab is your board: prices, countdowns and
        your status on every lot, refreshed every few seconds.
      </section>
    </div>
  );
}
