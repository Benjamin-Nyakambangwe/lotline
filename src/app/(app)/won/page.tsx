import { Trophy } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon-page";

export const metadata: Metadata = { title: "Won" };

export default function WonPage() {
  return (
    <ComingSoonPage
      title="Won"
      description="Everything you've won: what it cost all-in, when payment is due, and what to collect."
      icon={<Trophy />}
      emptyTitle="Nothing won yet"
      emptyBody="Lots you win appear here with the levy and VAT worked out and a pay-by date four days after close."
    />
  );
}
