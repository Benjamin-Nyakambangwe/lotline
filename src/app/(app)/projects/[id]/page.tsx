import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ProjectDetail } from "@/components/projects/project-detail";
import { requireUser } from "@/server/dal";
import { projectDetail } from "@/server/projects";

export const metadata: Metadata = { title: "Project" };

export default function ProjectPage(props: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Project params={props.params} />
    </Suspense>
  );
}

async function Project({
  params,
}: {
  params: PageProps<"/projects/[id]">["params"];
}) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await projectDetail(user.id, id);
  if (!detail) notFound();
  return <ProjectDetail detail={detail} />;
}
