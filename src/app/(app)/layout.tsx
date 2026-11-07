import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { MoreMenu } from "@/components/shell/more-menu";
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
        <Suspense fallback={<MoreMenu isAdmin={false} />}>
          <MoreMenuSlot />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
