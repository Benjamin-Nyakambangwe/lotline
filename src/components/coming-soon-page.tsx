import type { ReactNode } from "react";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { requireUser } from "@/server/dal";

/** A signed-in page whose feature hasn't landed yet. Still checks the session. */
export function ComingSoonPage(props: {
  title: string;
  description: string;
  icon: ReactNode;
  emptyTitle: string;
  emptyBody: ReactNode;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Body {...props} />
    </Suspense>
  );
}

async function Body({
  title,
  description,
  icon,
  emptyTitle,
  emptyBody,
}: Parameters<typeof ComingSoonPage>[0]) {
  await requireUser();
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={emptyTitle}>
        {emptyBody}
      </EmptyState>
    </>
  );
}
