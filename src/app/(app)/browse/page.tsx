import { Search } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon-page";

export const metadata: Metadata = { title: "Browse" };

export default function BrowsePage() {
  return (
    <ComingSoonPage
      title="Browse"
      description="Search every open lot at ABC Auctions, filter by campaign, category, condition and price."
      icon={<Search />}
      emptyTitle="The catalogue is on its way"
      emptyBody="Lotline's background worker will keep a fresh copy of the catalogue here, refreshed every 10 minutes."
    />
  );
}
