"use client";

import { Check, FolderPlus, Plus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addCandidatesAction, myProjectNeeds } from "@/server/actions/projects";

type Projects = Awaited<ReturnType<typeof myProjectNeeds>>;

/** "Add to project" on a lot: pick a need; the lot joins it as the last backup (and is watched). */
export function AddToProject({
  lotId,
  className,
}: {
  lotId: number;
  className?: string;
}) {
  const [projects, setProjects] = useState<Projects | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const load = (open: boolean) => {
    if (open)
      myProjectNeeds()
        .then(setProjects)
        .catch(() => setProjects([]));
  };
  const add = (needId: string, label: string) =>
    start(async () => {
      const { added: n } = await addCandidatesAction({
        needId,
        lotIds: [lotId],
      });
      setAdded((s) => new Set(s).add(needId));
      if (n) toast.success(`Added to ${label}`);
      else toast(`Already in ${label}`);
    });

  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild>
        <Button
          size="lg"
          variant="outline"
          className={className ?? "h-11"}
          aria-label="Add to a project"
        >
          <FolderPlus /> Project
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[50dvh] w-64 overflow-y-auto"
      >
        {projects === null && (
          <DropdownMenuLabel className="text-muted-foreground">
            Loading…
          </DropdownMenuLabel>
        )}
        {projects?.length === 0 && (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            No projects yet. A project groups lots by what you need, within a
            budget.
          </DropdownMenuLabel>
        )}
        {projects?.map((p, i) => (
          <div key={p.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {p.name}
            </DropdownMenuLabel>
            {p.needs.length === 0 && (
              <DropdownMenuItem asChild>
                <Link href={`/projects/${p.id}`}>
                  <Plus /> Add a need first
                </Link>
              </DropdownMenuItem>
            )}
            {p.needs.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={(e) => {
                  e.preventDefault();
                  add(n.id, `${p.name}: ${n.title}`);
                }}
              >
                {added.has(n.id) ? <Check className="text-win" /> : <Plus />}
                {n.title}
                {n.quantity > 1 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    ×{n.quantity}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        {projects !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/projects">
                <FolderPlus />{" "}
                {projects.length ? "All projects" : "New project"}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
