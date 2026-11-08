"use client";

import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/domain/money";
import { cn } from "@/lib/utils";
import { createProjectAction } from "@/server/actions/projects";
import type { ProjectSummary } from "@/server/projects";
import { BudgetBar, BudgetFlagChips } from "./budget-bar";

const STATUS_LABEL = {
  planning: "Planning",
  live: "Bidding",
  done: "Done",
  archived: "Archived",
} as const;

export function ProjectsList({ projects }: { projects: ProjectSummary[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Projects"
        description="Plan a build: what you need, an all-in budget, your max bids, and backup lots in closing order."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New project
          </Button>
        }
      />
      {projects.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title="No projects yet">
          A project groups lots by what you need (“2× mini PC”, “a switch”),
          keeps the worst case within an all-in budget, and lines up backups for
          when you're outbid.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className={cn(
                  "flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40",
                  (p.status === "done" || p.status === "archived") &&
                    "opacity-75",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {STATUS_LABEL[p.status]}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {p.needs} {p.needs === 1 ? "need" : "needs"} · {p.lots}{" "}
                  {p.lots === 1 ? "lot" : "lots"} · {p.filled} of {p.wanted}{" "}
                  filled
                </p>
                <div>
                  <p className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span>
                      Worst case{" "}
                      <strong className="tabular-nums">
                        {formatMoney(p.totals.worst)}
                      </strong>
                    </span>
                    {p.budget !== null && (
                      <span className="text-muted-foreground tabular-nums">
                        of {formatMoney(p.budget)}
                      </span>
                    )}
                  </p>
                  <BudgetBar budget={p.budget} totals={p.totals} size="sm" />
                </div>
                <BudgetFlagChips flags={p.flags} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const b = Number(budget.replace(/[$,\s]/g, ""));
      const { id } = await createProjectAction({
        name: name.trim(),
        budget:
          budget.trim() && Number.isFinite(b) && b > 0
            ? Math.round(b * 100)
            : null,
      });
      onOpenChange(false);
      router.push(`/projects/${id}`);
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Name it after what you're building. You can change both later.
        </DialogDescription>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Homelab"
              required
              maxLength={80}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-budget">Budget, all-in (optional)</Label>
            <Input
              id="p-budget"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              placeholder="$300"
            />
            <p className="text-xs text-muted-foreground">
              All-in means with ABC's levy and VAT (about +20%).
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
