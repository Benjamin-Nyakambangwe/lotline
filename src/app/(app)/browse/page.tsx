import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowseClient } from "@/components/browse/browse-client";
import { PageSkeleton } from "@/components/page-skeleton";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Browse" };

export default function BrowsePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Browse />
    </Suspense>
  );
}

async function Browse() {
  await requireUser();
  return <BrowseClient />;
}
