import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ProjectsList } from "@/components/projects/projects-list";
import { requireUser } from "@/server/dal";
import { projectsOverview } from "@/server/projects";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Projects />
    </Suspense>
  );
}

async function Projects() {
  const user = await requireUser();
  return <ProjectsList projects={await projectsOverview(user.id)} />;
}
