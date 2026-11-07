"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { openCommandMenu } from "../command/command-menu";
import {
  PRIMARY_NAV,
  SETTINGS_NAV,
  SidebarLinks,
  SidebarLinksStatic,
  TabLinks,
  TabLinksStatic,
} from "./nav";

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
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={openCommandMenu}
            className="flex h-10 w-full items-center gap-2 rounded-lg border bg-background/60 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Search className="size-4" aria-hidden="true" />
            <span className="flex-1 text-left">Search lots…</span>
            <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3 py-2">
          <Suspense fallback={<SidebarLinksStatic items={PRIMARY_NAV} />}>
            <SidebarLinks items={PRIMARY_NAV} />
          </Suspense>
          <div className="mt-auto flex flex-col gap-1 pt-4">
            <Suspense fallback={<SidebarLinksStatic items={[SETTINGS_NAV]} />}>
              <SidebarLinks items={[SETTINGS_NAV]} />
            </Suspense>
            {adminSlot}
          </div>
        </nav>
        <div className="border-t border-sidebar-border p-2">{userSlot}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col xl:pr-[var(--panel-w,0px)]">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <Link
            href="/dashboard"
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark className="text-base" />
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openCommandMenu}
              aria-label="Search lots"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Search className="size-[18px]" />
            </button>
            <ThemeToggle />
            {mobileUserSlot}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-[calc(var(--sheet-h,0px)+7rem)] sm:px-6 lg:px-8 lg:pt-8 lg:pb-[calc(var(--sheet-h,0px)+2.5rem)]">
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
        <Suspense fallback={<TabLinksStatic items={PRIMARY_NAV.slice(0, 4)} />}>
          <TabLinks items={PRIMARY_NAV.slice(0, 4)} />
        </Suspense>
        {moreSlot}
      </nav>
    </div>
  );
}
