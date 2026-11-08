"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronsUp,
  Download,
  EllipsisVertical,
  Lightbulb,
  Pencil,
  Plus,
  SkipForward,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allIn, DEFAULT_RATES, maxHammerFor } from "@/lib/domain/fees";
import { formatMoney } from "@/lib/domain/money";
import { formatWhen } from "@/lib/domain/time";
import type { CandidateView, NeedView } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import {
  addNeedAction,
  deleteNeedAction,
  deleteProjectAction,
  moveCandidateAction,
  removeCandidateAction,
  updateCandidateAction,
  updateNeedAction,
  updateProjectAction,
} from "@/server/actions/projects";
import type { ProjectDetail as Detail } from "@/server/projects";
import { MoneyInput } from "../live/money-input";
import { StatusChip } from "../live/status-chip";
import { LotThumb } from "../lot/bits";
import { BudgetBar, BudgetFlagChips } from "./budget-bar";
import { LotPicker } from "./lot-picker";

const STATUSES = {
  planning: "Planning",
  live: "Bidding",
  done: "Done",
  archived: "Archived",
} as const;

export function ProjectDetail({ detail }: { detail: Detail }) {
  const router = useRouter();
  const { project, view } = detail;
  const [, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  // Live statuses: refresh often when lots close within the hour.
  const soon = view.needs.some((n) =>
    n.candidates.some(
      (c) => c.open && c.endAt && Date.parse(c.endAt) - Date.now() < 3_600_000,
    ),
  );
  useEffect(() => {
    const id = setInterval(
      () => document.visibilityState === "visible" && router.refresh(),
      soon ? 10_000 : 60_000,
    );
    return () => clearInterval(id);
  }, [soon, router]);

  const [editingName, setEditingName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const b = view.budget;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link
        href="/projects"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        {editingName ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(
                new FormData(e.currentTarget).get("name") ?? "",
              ).trim();
              if (name)
                run(() => updateProjectAction({ id: project.id, name }));
              setEditingName(false);
            }}
            className="flex gap-2"
          >
            <Input
              name="name"
              defaultValue={project.name}
              autoFocus
              maxLength={80}
              aria-label="Project name"
              className="h-10 text-lg"
            />
            <Button type="submit">Save</Button>
          </form>
        ) : (
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {project.name}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditingName(true)}
              aria-label="Rename project"
            >
              <Pencil className="size-4" />
            </Button>
          </h1>
        )}
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {STATUSES[project.status]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={project.status}
                onValueChange={(v) =>
                  run(() =>
                    updateProjectAction({
                      id: project.id,
                      status: v as keyof typeof STATUSES,
                    }),
                  )
                }
              >
                {Object.entries(STATUSES).map(([k, v]) => (
                  <DropdownMenuRadioItem key={k} value={k}>
                    {v}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Project options">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={`/api/projects/${project.id}/csv`}>
                  <Download /> Export CSV
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <section aria-label="Budget" className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Worst case, all-in</p>
            <p className="text-4xl font-semibold tracking-tight">
              {formatMoney(b.worst)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Won, plus what you lead at your bid, plus the next backups for
              each open slot.
            </p>
          </div>
          <MoneyInput
            label="Budget, all-in"
            value={project.budget}
            onSave={(c) =>
              run(() => updateProjectAction({ id: project.id, budget: c }))
            }
            className="w-44"
          />
        </div>
        <div className="mt-4">
          <BudgetBar
            budget={project.budget}
            totals={{
              won: b.won,
              leading: b.leading,
              unfilled: b.unfilled,
              worst: b.worst,
              left: b.left,
            }}
          />
        </div>
        <div className="mt-3">
          <BudgetFlagChips flags={b.flags} />
        </div>
      </section>

      <section aria-label="Needs" className="flex flex-col gap-4">
        {view.needs.map((n) => (
          <NeedCard key={n.id} need={n} run={run} />
        ))}
        <AddNeed
          projectId={project.id}
          run={run}
          first={view.needs.length === 0}
        />
      </section>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Delete {project.name}?</DialogTitle>
          <DialogDescription>
            Its needs and candidate lists go too. The lots stay on your
            watchlist. This can't be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                start(async () => {
                  await deleteProjectAction({ id: project.id });
                  router.push("/projects");
                })
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => void;

function NeedCard({ need: n, run }: { need: NeedView; run: Run }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const nb = n.budget;
  return (
    <article className="rounded-2xl border bg-card" aria-label={n.title}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {n.title}
            {n.quantity > 1 && (
              <span className="ml-1.5 text-muted-foreground">
                ×{n.quantity}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {Math.min(n.filled, n.quantity)} of {n.quantity} filled
            {n.slotMaxHammer !== null &&
              ` · max ${formatMoney(n.slotMaxHammer)} (${formatMoney(allIn(n.slotMaxHammer, DEFAULT_RATES))} all-in)`}
            {` · worst case ${formatMoney(nb.worst)}`}
            {!n.countsTowardBudget && " · not in the budget"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil /> Edit
        </Button>
      </header>

      {n.suggestion && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2.5 text-sm">
          <Lightbulb
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">{n.suggestion.text}</span>
          {n.suggestion.candidateId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                run(() =>
                  moveCandidateAction({
                    id: n.suggestion?.candidateId as string,
                    to: "top",
                  }),
                )
              }
            >
              <ChevronsUp /> Make primary
            </Button>
          )}
        </div>
      )}

      <ol className="divide-y" aria-label={`Lots for ${n.title}`}>
        {n.candidates.map((c, i) => (
          <CandidateRow
            key={c.id}
            c={c}
            first={i === 0}
            last={i === n.candidates.length - 1}
            needMax={n.slotMaxHammer}
            run={run}
          />
        ))}
      </ol>
      <div className="p-3">
        <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
          <Plus /> Add lots
        </Button>
      </div>
      <LotPicker
        needId={n.id}
        needTitle={n.title}
        exclude={n.candidates.map((c) => c.lotId)}
        open={picking}
        onOpenChange={setPicking}
        onAdded={() => router.refresh()}
      />
      <NeedEditor need={n} open={editing} onOpenChange={setEditing} run={run} />
    </article>
  );
}

function CandidateRow({
  c,
  first,
  last,
  needMax,
  run,
}: {
  c: CandidateView;
  first: boolean;
  last: boolean;
  needMax: number | null;
  run: Run;
}) {
  const [, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const skipped = c.state === "skipped";
  return (
    <li
      className={cn(
        "flex gap-3 p-3 sm:p-4",
        (skipped || !c.open) && "bg-muted/30",
      )}
    >
      <span
        className={cn(
          "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          c.rank === 1
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
        title={c.rank === 1 ? "Primary" : `Backup ${c.rank - 1}`}
      >
        {c.rank}
      </span>
      <button
        type="button"
        onClick={() => void setLot(c.lotId)}
        className="shrink-0 self-start"
        aria-label={`Open ${c.title}`}
      >
        <LotThumb src={c.thumbUrl} alt="" size={56} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => void setLot(c.lotId)}
            className={cn(
              "line-clamp-2 text-left text-sm font-medium hover:underline",
              skipped && "line-through opacity-70",
            )}
          >
            {c.title}
          </button>
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={first}
              onClick={() =>
                run(() => moveCandidateAction({ id: c.id, to: "up" }))
              }
              aria-label="Move up"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={last}
              onClick={() =>
                run(() => moveCandidateAction({ id: c.id, to: "down" }))
              }
              aria-label="Move down"
            >
              <ArrowDown className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`More for ${c.title}`}
                >
                  <EllipsisVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {c.rank === 1 ? "Primary" : `Backup ${c.rank - 1}`}
                </DropdownMenuLabel>
                {!first && (
                  <DropdownMenuItem
                    onSelect={() =>
                      run(() => moveCandidateAction({ id: c.id, to: "top" }))
                    }
                  >
                    <ChevronsUp /> Make primary
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() =>
                    run(() =>
                      updateCandidateAction({
                        id: c.id,
                        state: skipped ? "active" : "skipped",
                      }),
                    )
                  }
                >
                  <SkipForward /> {skipped ? "Use it again" : "Skip it"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    run(() => removeCandidateAction({ id: c.id }))
                  }
                >
                  <Trash2 /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {skipped ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Skipped
            </span>
          ) : (
            <StatusChip
              status={c.status}
              confidence={c.confidence}
              provisional={c.provisional}
            />
          )}
          {c.planned && (
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">
              In worst case
            </span>
          )}
          {c.overMax && !skipped && (
            <span className="rounded-full bg-outbid-bg px-2 py-0.5 text-xs font-medium text-outbid">
              Over your max
            </span>
          )}
          {c.auction && (
            <span className="text-xs text-muted-foreground">{c.auction}</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {c.open ? (
              <>
                {c.currentBid === null ? "Opens at " : "Now "}
                <span className="font-semibold text-foreground">
                  {formatMoney(c.currentBid ?? c.nextBid)}
                </span>
                {c.currentBid !== null && <> · next {formatMoney(c.nextBid)}</>}
                {c.endAt && <> · closes {formatWhen(Date.parse(c.endAt))}</>}
              </>
            ) : c.finalPrice !== null ? (
              <>Sold for {formatMoney(c.finalPrice)}</>
            ) : (
              "Closed"
            )}
          </p>
          {c.open && !skipped && (
            <MoneyInput
              label={
                c.ownMax
                  ? "Max for this lot"
                  : needMax !== null
                    ? "Max (the need's)"
                    : "Your max"
              }
              value={c.ownMax ? c.max : null}
              onSave={(cents) =>
                run(() =>
                  updateCandidateAction({ id: c.id, maxHammerOverride: cents }),
                )
              }
              hint={
                c.max !== null
                  ? `${formatMoney(c.allInAtMax)} all-in${c.ownMax ? "" : " (need's max)"}`
                  : undefined
              }
              className="w-40"
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** Title, quantity, and a max per lot given as hammer or as an all-in figure. */
function NeedFields({
  defaults,
}: {
  defaults?: {
    title: string;
    quantity: number;
    slotMaxHammer: number | null;
    countsTowardBudget: boolean;
  };
}) {
  const uid = useId();
  const [unit, setUnit] = useState<"hammer" | "allin">("hammer");
  const [max, setMax] = useState(
    defaults?.slotMaxHammer != null ? String(defaults.slotMaxHammer / 100) : "",
  );
  const cents = Math.round(Number(max.replace(/[$,\s]/g, "")) * 100);
  const valid = max.trim() !== "" && Number.isFinite(cents) && cents > 0;
  const hammer = valid
    ? unit === "hammer"
      ? cents
      : maxHammerFor(cents).hammer
    : null;
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-title`}>What you need</Label>
        <Input
          id={`${uid}-title`}
          name="title"
          defaultValue={defaults?.title}
          placeholder="Proxmox node"
          required
          maxLength={80}
        />
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-qty`}>How many</Label>
          <Input
            id={`${uid}-qty`}
            name="quantity"
            type="number"
            min={1}
            max={99}
            defaultValue={defaults?.quantity ?? 1}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-max`}>Max per lot (optional)</Label>
          <div className="flex gap-1.5">
            <Input
              id={`${uid}-max`}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              inputMode="decimal"
              placeholder="$50"
            />
            <select
              aria-label="Max is"
              value={unit}
              onChange={(e) => setUnit(e.target.value as "hammer" | "allin")}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="hammer">hammer</option>
              <option value="allin">all-in</option>
            </select>
          </div>
        </div>
      </div>
      <input type="hidden" name="slotMaxHammer" value={hammer ?? ""} />
      {hammer !== null && (
        <p className="-mt-2 text-xs text-muted-foreground tabular-nums">
          = {formatMoney(hammer)} hammer ·{" "}
          {formatMoney(allIn(hammer, DEFAULT_RATES))} all-in (on ABC's bid
          steps)
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="counts"
          defaultChecked={defaults?.countsTowardBudget ?? true}
          className="size-4 accent-[var(--primary)]"
        />
        Counts toward the budget
      </label>
    </>
  );
}

const readNeed = (form: HTMLFormElement) => {
  const f = new FormData(form);
  const max = String(f.get("slotMaxHammer") ?? "");
  return {
    title: String(f.get("title") ?? "").trim(),
    quantity: Math.max(1, Math.min(99, Number(f.get("quantity") ?? 1) || 1)),
    slotMaxHammer: max ? Number(max) : null,
    countsTowardBudget: f.get("counts") === "on",
  };
};

function AddNeed({
  projectId,
  run,
  first,
}: {
  projectId: string;
  run: Run;
  first: boolean;
}) {
  const [open, setOpen] = useState(first);
  if (!open)
    return (
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> Add a need
      </Button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = readNeed(e.currentTarget);
        if (!n.title) return;
        run(async () => {
          const r = await addNeedAction({
            projectId,
            title: n.title,
            quantity: n.quantity,
            slotMaxHammer: n.slotMaxHammer,
          });
          if (r.id && !n.countsTowardBudget)
            await updateNeedAction({ id: r.id, countsTowardBudget: false });
          toast.success(`Added ${n.title}. Now add lots to it.`);
        });
        e.currentTarget.reset();
        setOpen(false);
      }}
      className="grid gap-4 rounded-2xl border border-dashed bg-card p-4"
      aria-label="Add a need"
    >
      <h2 className="font-semibold">
        {first ? "What do you need for this project?" : "Add a need"}
      </h2>
      <NeedFields />
      <div className="flex justify-end gap-2">
        {!first && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
        <Button type="submit">Add need</Button>
      </div>
    </form>
  );
}

function NeedEditor({
  need: n,
  open,
  onOpenChange,
  run,
}: {
  need: NeedView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  run: Run;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Edit {n.title}</DialogTitle>
        <DialogDescription>
          Changing the max updates every lot that uses the need's max.
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = readNeed(e.currentTarget);
            run(() => updateNeedAction({ id: n.id, ...v }));
            onOpenChange(false);
          }}
          className="grid gap-4"
        >
          <NeedFields defaults={n} />
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                run(() => deleteNeedAction({ id: n.id }));
                onOpenChange(false);
              }}
            >
              <Trash2 /> Delete need
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
