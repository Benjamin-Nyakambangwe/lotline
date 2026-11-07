import { Radio } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon-page";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <ComingSoonPage
      title="Watchlist"
      description="Your auction-night board: live prices, countdowns and your status on every lot you watch."
      icon={<Radio />}
      emptyTitle="You're not watching any lots yet"
      emptyBody="Watch lots from Browse and they'll appear here, sorted by when they close."
    />
  );
}
