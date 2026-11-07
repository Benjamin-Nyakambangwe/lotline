import { FolderKanban } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon-page";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <ComingSoonPage
      title="Projects"
      description="Plan a build: what you need, an all-in budget, max bids and backup lots in closing order."
      icon={<FolderKanban />}
      emptyTitle="No projects yet"
      emptyBody="A project groups lots into needs, like “2× Proxmox node”, and keeps your worst-case total under budget."
    />
  );
}
