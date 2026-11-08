import "server-only";
import {
  candidateRows,
  getProject,
  listProjects,
  needRows,
} from "@/lib/db/queries/projects";
import { parseCents } from "@/lib/domain/money";
import { buildProjectView } from "@/lib/projects/view";
import { getDb } from "./db";

export type ProjectSummary = Awaited<
  ReturnType<typeof projectsOverview>
>[number];

/** Every project of this person with its budget picture, for the projects list. */
export async function projectsOverview(userId: string) {
  const db = getDb();
  const ps = await listProjects(db, userId);
  const ids = ps.map((p) => p.id);
  const [needs, rows] = await Promise.all([
    needRows(db, ids),
    candidateRows(db, userId, ids),
  ]);
  const now = new Date();
  return ps.map((p) => {
    const budget = parseCents(p.budgetAllIn);
    const v = buildProjectView(
      budget,
      needs.filter((n) => n.projectId === p.id),
      rows.filter((r) => r.projectId === p.id),
      now,
    );
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      budget,
      needs: v.needs.length,
      lots: v.needs.reduce((a, n) => a + n.candidates.length, 0),
      filled: v.needs.reduce((a, n) => a + Math.min(n.filled, n.quantity), 0),
      wanted: v.needs.reduce((a, n) => a + n.quantity, 0),
      totals: {
        won: v.budget.won,
        leading: v.budget.leading,
        unfilled: v.budget.unfilled,
        worst: v.budget.worst,
        left: v.budget.left,
      },
      flags: v.budget.flags,
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

/** One project with its needs, candidates, live status and budget. */
export async function projectDetail(userId: string, id: string) {
  const db = getDb();
  const p = await getProject(db, userId, id);
  if (!p) return null;
  const [needs, rows] = await Promise.all([
    needRows(db, [id]),
    candidateRows(db, userId, [id]),
  ]);
  const budget = parseCents(p.budgetAllIn);
  return {
    project: {
      id: p.id,
      name: p.name,
      status: p.status,
      budget,
      notes: p.notes,
    },
    view: buildProjectView(budget, needs, rows, new Date()),
  };
}

export type ProjectDetail = NonNullable<
  Awaited<ReturnType<typeof projectDetail>>
>;
