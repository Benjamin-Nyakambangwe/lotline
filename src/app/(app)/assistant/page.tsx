import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistantClient } from "@/components/assistant/assistant-client";
import { PageSkeleton } from "@/components/page-skeleton";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Ask Lotline" };

export default function AssistantPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Assistant />
    </Suspense>
  );
}

async function Assistant() {
  await requireUser();
  return <AssistantClient />;
}
