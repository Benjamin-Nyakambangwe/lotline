import { Suspense } from "react";
import { CommandMenu } from "@/components/command/command-menu";
import { LotOverlay } from "@/components/lot/lot-overlay";
import { AppProviders } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { MoreMenuView } from "@/components/shell/more-menu";
import {
  AdminNavSlot,
  MoreMenuSlot,
  UserMenuSlot,
} from "@/components/shell/slots";
import { Skeleton } from "@/components/ui/skeleton";

// The shell is static; only the user-specific slots stream in. Each page still checks the
// session itself through the data access layer.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppProviders>
      <AppShell
        adminSlot={
          <Suspense fallback={null}>
            <AdminNavSlot />
          </Suspense>
        }
        userSlot={
          <Suspense fallback={<Skeleton className="h-12 w-full rounded-lg" />}>
            <UserMenuSlot />
          </Suspense>
        }
        mobileUserSlot={
          <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
            <UserMenuSlot compact />
          </Suspense>
        }
        moreSlot={
          <Suspense fallback={<MoreMenuView isAdmin={false} pathname={null} />}>
            <MoreMenuSlot />
          </Suspense>
        }
      >
        {children}
      </AppShell>
      {/* URL-driven (?lot=) and keyboard-driven overlays; nuqs reads search params, hence Suspense. */}
      <Suspense fallback={null}>
        <LotOverlay />
        <CommandMenu />
      </Suspense>
    </AppProviders>
  );
}
