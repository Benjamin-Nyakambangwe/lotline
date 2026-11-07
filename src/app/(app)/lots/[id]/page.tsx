import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LotPageClient } from "@/components/lot/lot-page-client";
import { PageSkeleton } from "@/components/page-skeleton";
import { getLotView } from "@/server/catalogue";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Lot" };

export default function LotPage({ params }: PageProps<"/lots/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Lot params={params} />
    </Suspense>
  );
}

async function Lot({ params }: Pick<PageProps<"/lots/[id]">, "params">) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const lot = await getLotView(id);
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/browse"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Browse
      </Link>
      <LotPageClient id={id} initial={lot} />
    </div>
  );
}
