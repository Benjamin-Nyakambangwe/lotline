import type { Metadata } from "next";
import { Suspense } from "react";
import { WatchlistClient } from "@/components/live/watchlist-client";
import { PageSkeleton } from "@/components/page-skeleton";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Watchlist />
    </Suspense>
  );
}

async function Watchlist() {
  await requireUser();
  return <WatchlistClient />;
}
