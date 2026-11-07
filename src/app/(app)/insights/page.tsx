import { LineChart } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon-page";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <ComingSoonPage
      title="Insights"
      description="What things actually sell for at ABC: medians, typical ranges and trends from every closed lot."
      icon={<LineChart />}
      emptyTitle="Market data is being collected"
      emptyBody="Once the worker is running, every sold lot is recorded so you can see what similar items went for."
    />
  );
}
