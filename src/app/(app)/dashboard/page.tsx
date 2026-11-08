import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { PageSkeleton } from "@/components/page-skeleton";
import { listAuctions } from "@/server/auctions";
import { requireUser } from "@/server/dal";
import { wonThisMonth } from "@/server/dashboard";

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
  const [auctions, won] = await Promise.all([
    listAuctions(),
    wonThisMonth(user.id),
  ]);
  return (
    <DashboardClient
      greeting={`${greeting(hour)}, ${user.name.split(" ")[0] || "there"}`}
      auctions={auctions}
      won={won}
    />
  );
}
