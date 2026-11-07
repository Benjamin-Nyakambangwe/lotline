"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, ICONS, isActive, PRIMARY_NAV, SETTINGS_NAV } from "./nav";

/** Phone "More" tab: the destinations that don't fit in the bottom bar. */
export function MoreMenu({ isAdmin }: { isAdmin: boolean }) {
  return <MoreMenuView isAdmin={isAdmin} pathname={usePathname()} />;
}

/** Pure view; `pathname` null = no highlight (used before the path is known). */
export function MoreMenuView({
  isAdmin,
  pathname,
}: {
  isAdmin: boolean;
  pathname: string | null;
}) {
  const items = [
    ...PRIMARY_NAV.slice(4),
    SETTINGS_NAV,
    ...(isAdmin ? [ADMIN_NAV] : []),
  ];
  const active =
    pathname !== null && items.some((i) => isActive(pathname, i.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Ellipsis className="size-5" aria-hidden="true" />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="mb-2 w-48">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} className="h-11">
                <Icon className="size-4" /> {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
