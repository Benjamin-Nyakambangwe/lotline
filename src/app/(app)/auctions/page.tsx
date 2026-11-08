import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionsClient } from "@/components/auctions/auctions-client";
import { PageSkeleton } from "@/components/page-skeleton";
import { listAuctions } from "@/server/auctions";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Auctions" };

export default function AuctionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Auctions />
    </Suspense>
  );
}

async function Auctions() {
  await requireUser();
  return <AuctionsClient auctions={await listAuctions()} />;
}
