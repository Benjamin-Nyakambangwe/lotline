"use client";

import {
  FolderKanban,
  Gavel,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavIcon =
  | "dashboard"
  | "auctions"
  | "assistant"
  | "live"
  | "browse"
  | "projects"
  | "won"
  | "insights"
  | "settings"
  | "admin";

export const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  auctions: Gavel,
  assistant: Sparkles,
  live: Radio,
  browse: Search,
  projects: FolderKanban,
  won: Trophy,
  insights: LineChart,
  settings: Settings,
  admin: ShieldCheck,
};

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: NavIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "dashboard" },
  { href: "/auctions", label: "Auctions", short: "Auctions", icon: "auctions" },
  { href: "/browse", label: "Browse", short: "Browse", icon: "browse" },
  { href: "/watchlist", label: "Watchlist", short: "Live", icon: "live" },
  { href: "/assistant", label: "Ask Lotline", short: "Ask", icon: "assistant" },
  { href: "/projects", label: "Projects", short: "Projects", icon: "projects" },
  { href: "/won", label: "Won", short: "Won", icon: "won" },
  { href: "/insights", label: "Insights", short: "Insights", icon: "insights" },
];

export const SETTINGS_NAV: NavItem = {
  href: "/settings",
  label: "Settings",
  short: "Settings",
  icon: "settings",
};
export const ADMIN_NAV: NavItem = {
  href: "/admin/invites",
  label: "Admin",
  short: "Admin",
  icon: "admin",
};

export function isActive(pathname: string, href: string) {
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/admin/invites" && pathname.startsWith("/admin"))
  );
}

/** Sidebar link (pure view). */
export function NavLinkView({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors",
        "hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-sidebar-accent text-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary opacity-0 transition-opacity",
          active && "opacity-100",
        )}
      />
      <Icon
        className={cn(
          "size-[18px]",
          active
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {item.label}
    </Link>
  );
}

/** Bottom-tab item for phones (pure view). */
export function TabLinkView({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {item.short}
    </Link>
  );
}

/*
 * The pathname is request data on dynamic routes (e.g. /lots/[id]), so components that read
 * it must render inside <Suspense>. Each has a static twin used as the fallback: same links,
 * no highlight, so the shell still prerenders instantly.
 */

export function NavLink({ item }: { item: NavItem }) {
  return (
    <NavLinkView item={item} active={isActive(usePathname(), item.href)} />
  );
}

export function SidebarLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return items.map((i) => (
    <NavLinkView key={i.href} item={i} active={isActive(pathname, i.href)} />
  ));
}

export function SidebarLinksStatic({ items }: { items: NavItem[] }) {
  return items.map((i) => <NavLinkView key={i.href} item={i} active={false} />);
}

export function TabLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return items.map((i) => (
    <TabLinkView key={i.href} item={i} active={isActive(pathname, i.href)} />
  ));
}

export function TabLinksStatic({ items }: { items: NavItem[] }) {
  return items.map((i) => <TabLinkView key={i.href} item={i} active={false} />);
}
