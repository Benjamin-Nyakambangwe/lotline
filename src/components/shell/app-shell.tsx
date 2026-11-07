"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLink, PRIMARY_NAV, SETTINGS_NAV, TabLink } from "./nav";

/**
 * The signed-in frame. Static so it prerenders instantly; user-specific bits arrive
 * through slots that the server streams in behind Suspense boundaries.
 *  - desktop (≥1024px): sidebar
 *  - phone: top bar + bottom tabs (Home, Live, Browse, Projects, More)
 */
export function AppShell({
  children,
  adminSlot,
  userSlot,
  mobileUserSlot,
  moreSlot,
}: {
  children: ReactNode;
  adminSlot: ReactNode;
  userSlot: ReactNode;
  mobileUserSlot: ReactNode;
  moreSlot: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center justify-between px-4">
          <Link
            href="/dashboard"
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark className="text-base" />
          </Link>
          <ThemeToggle />
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3 py-2">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
          <div className="mt-auto flex flex-col gap-1 pt-4">
            <NavLink item={SETTINGS_NAV} />
            {adminSlot}
          </div>
        </nav>
        <div className="border-t border-sidebar-border p-2">{userSlot}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <Link
            href="/dashboard"
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark className="text-base" />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {mobileUserSlot}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">
          {children}
        </main>

        <footer className="px-4 pb-24 text-center text-xs text-muted-foreground sm:px-6 lg:pb-6">
          Lotline is an independent tool. Not affiliated with ABC Auctions.
        </footer>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {PRIMARY_NAV.slice(0, 4).map((item) => (
          <TabLink key={item.href} item={item} />
        ))}
        {moreSlot}
      </nav>
    </div>
  );
}
