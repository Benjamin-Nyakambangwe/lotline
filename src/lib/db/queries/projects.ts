import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { CandidateState } from "../../domain/budget";
import { centsToNumeric, parseCents } from "../../domain/money";
import type { CandidateRow, NeedRow } from "../../projects/view";
import { projectCandidates, projectNeeds, projects, userLots } from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

const numeric = (v: unknown) =>
  v === null || v === undefined ? null : Number(v);
const date = (v: unknown) => (v ? new Date(v as string) : null);

export async function listProjects(db: AnyDb, userId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.status), sql`${projects.updatedAt} desc`);
}

export async function getProject(db: AnyDb, userId: string, id: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return p ?? null;
}

export async function needRows(
  db: AnyDb,
  projectIds: string[],
): Promise<(NeedRow & { projectId: string })[]> {
  if (!projectIds.length) return [];
  const rows = await db
    .select()
    .from(projectNeeds)
    .where(inArray(projectNeeds.projectId, projectIds))
    .orderBy(asc(projectNeeds.sort));
  return rows.map((n) => ({
    id: n.id,
    projectId: n.projectId,
    title: n.title,
    quantity: n.quantity,
    slotMaxHammer: parseCents(n.slotMaxHammer),
    countsTowardBudget: n.countsTowardBudget,
    sort: n.sort,
  }));
}

/** Every candidate lot in these projects, with what status and the budget need. */
export async function candidateRows(
  db: AnyDb,
  userId: string,
  projectIds: string[],
): Promise<(CandidateRow & { projectId: string })[]> {
  if (!projectIds.length) return [];
  const res = await db.execute(sql`
    select pc.id as candidate_id, pc.need_id, pn.project_id, pc.rank, pc.state,
           pc.max_hammer_override, pc.note,
           l.id as lot_id, l.type, l.title, l.thumb_url, l.status, l.final_state, l.final_reason,
           l.current_bid, l.starting_bid, l.current_bidder_id, l.end_at, l.original_end_at,
           l.extensions_count, l.stc, l.levy_rate, l.vat_rate, l.lot_vat_rate, l.final_price,
           c.code as auction,
           ul.my_bid, ul.ever_led, us.abc_bidder_id
    from project_candidates pc
    join project_needs pn on pn.id = pc.need_id
    join projects p on p.id = pn.project_id and p.user_id = ${userId}
    join lots l on l.id = pc.lot_id
    left join campaigns c on c.id = l.campaign_id
    left join user_lots ul on ul.lot_id = l.id and ul.user_id = ${userId}
    left join user_settings us on us.user_id = ${userId}
    where pn.project_id in (${sql.join(
      projectIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    candidateId: String(r.candidate_id),
    needId: String(r.need_id),
    projectId: String(r.project_id),
    rank: Number(r.rank),
    state: r.state as CandidateState,
    maxHammerOverride: parseCents(r.max_hammer_override as string | null),
    note: (r.note as string | null) ?? null,
    lotId: Number(r.lot_id),
    type: Number(r.type),
    title: String(r.title),
    thumbUrl: (r.thumb_url as string | null) ?? null,
    auction: (r.auction as string | null) ?? null,
    status: numeric(r.status),
    finalState: String(r.final_state),
    finalReason: (r.final_reason as string | null) ?? null,
    currentBid: parseCents(r.current_bid as string | null),
    startingBid: parseCents(r.starting_bid as string | null),
    leaderId: numeric(r.current_bidder_id),
    endAt: date(r.end_at),
    originalEndAt: date(r.original_end_at),
    extensions: Number(r.extensions_count ?? 0),
    stc: !!r.stc,
    rates:
      r.levy_rate !== null && r.vat_rate !== null
        ? {
            levy: Number(r.levy_rate),
            vat: Number(r.vat_rate),
            lotVat: Number(r.lot_vat_rate ?? 0),
            estimated: false,
          }
        : null,
    finalPrice: parseCents(r.final_price as string | null),
    myBidderId: numeric(r.abc_bidder_id),
    myBid: parseCents(r.my_bid as string | null),
    maxBid: null,
    everLed: !!r.ever_led,
  }));
}

// ---------------------------------------------------------------- writes (all owner-scoped)

export async function createProject(
  db: AnyDb,
  userId: string,
  p: { name: string; budget: number | null },
) {
  const [row] = await db
    .insert(projects)
    .values({ userId, name: p.name, budgetAllIn: centsToNumeric(p.budget) })
    .returning({ id: projects.id });
  return row.id;
}

export async function updateProject(
  db: AnyDb,
  userId: string,
  id: string,
  p: {
    name?: string;
    budget?: number | null;
    status?: "planning" | "live" | "done" | "archived";
    notes?: string | null;
  },
) {
  const res = await db
    .update(projects)
    .set({
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.budget !== undefined
        ? { budgetAllIn: centsToNumeric(p.budget) }
        : {}),
      ...(p.status !== undefined ? { status: p.status } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning({ id: projects.id });
  return res.length > 0;
}

export async function deleteProject(db: AnyDb, userId: string, id: string) {
  const res = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning({ id: projects.id });
  return res.length > 0;
}

const touch = (db: AnyDb, projectId: string) =>
  db
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, projectId));

/** The project a need belongs to, if this person owns it. */
async function ownedNeed(db: AnyDb, userId: string, needId: string) {
  const [r] = await db
    .select({ projectId: projectNeeds.projectId })
    .from(projectNeeds)
    .innerJoin(projects, eq(projects.id, projectNeeds.projectId))
    .where(and(eq(projectNeeds.id, needId), eq(projects.userId, userId)));
  return r?.projectId ?? null;
}

/** The need a candidate belongs to, if this person owns it. */
async function ownedCandidate(db: AnyDb, userId: string, candidateId: string) {
  const [r] = await db
    .select({
      needId: projectCandidates.needId,
      projectId: projectNeeds.projectId,
    })
    .from(projectCandidates)
    .innerJoin(projectNeeds, eq(projectNeeds.id, projectCandidates.needId))
    .innerJoin(projects, eq(projects.id, projectNeeds.projectId))
    .where(
      and(eq(projectCandidates.id, candidateId), eq(projects.userId, userId)),
    );
  return r ?? null;
}

export async function addNeed(
  db: AnyDb,
  userId: string,
  projectId: string,
  n: { title: string; quantity: number; slotMaxHammer: number | null },
) {
  if (!(await getProject(db, userId, projectId))) return null;
  const [{ next }] = (
    await db.execute(
      sql`select coalesce(max(sort), 0) + 1 as next from project_needs where project_id = ${projectId}`,
    )
  ).rows as { next: number }[];
  const [row] = await db
    .insert(projectNeeds)
    .values({
      projectId,
      title: n.title,
      quantity: n.quantity,
      slotMaxHammer: centsToNumeric(n.slotMaxHammer),
      sort: Number(next),
    })
    .returning({ id: projectNeeds.id });
  await touch(db, projectId);
  return row.id;
}

export async function updateNeed(
  db: AnyDb,
  userId: string,
  needId: string,
  n: {
    title?: string;
    quantity?: number;
    slotMaxHammer?: number | null;
    countsTowardBudget?: boolean;
  },
) {
  const projectId = await ownedNeed(db, userId, needId);
  if (!projectId) return false;
  await db
    .update(projectNeeds)
    .set({
      ...(n.title !== undefined ? { title: n.title } : {}),
      ...(n.quantity !== undefined ? { quantity: n.quantity } : {}),
      ...(n.slotMaxHammer !== undefined
        ? { slotMaxHammer: centsToNumeric(n.slotMaxHammer) }
        : {}),
      ...(n.countsTowardBudget !== undefined
        ? { countsTowardBudget: n.countsTowardBudget }
        : {}),
    })
    .where(eq(projectNeeds.id, needId));
  await touch(db, projectId);
  return true;
}

export async function deleteNeed(db: AnyDb, userId: string, needId: string) {
  const projectId = await ownedNeed(db, userId, needId);
  if (!projectId) return false;
  await db.delete(projectNeeds).where(eq(projectNeeds.id, needId));
  await touch(db, projectId);
  return true;
}

/**
 * Add lots to a need as backups, after the ones already there (in the order given). They go
 * on the person's watchlist too, so they're tracked live and alert like any watched lot.
 */
export async function addCandidates(
  db: AnyDb,
  userId: string,
  needId: string,
  lotIds: number[],
) {
  const projectId = await ownedNeed(db, userId, needId);
  if (!projectId || !lotIds.length) return 0;
  const existing = new Set(
    (
      await db
        .select({ lotId: projectCandidates.lotId })
        .from(projectCandidates)
        .where(eq(projectCandidates.needId, needId))
    ).map((r) => r.lotId),
  );
  const fresh = [...new Set(lotIds)].filter((id) => !existing.has(id));
  if (!fresh.length) return 0;
  const [{ next }] = (
    await db.execute(
      sql`select coalesce(max(rank), 0) + 1 as next from project_candidates where need_id = ${needId}`,
    )
  ).rows as { next: number }[];
  await db
    .insert(projectCandidates)
    .values(
      fresh.map((lotId, i) => ({ needId, lotId, rank: Number(next) + i })),
    );
  for (const lotId of fresh)
    await db
      .insert(userLots)
      .values({ userId, lotId, watching: true })
      .onConflictDoUpdate({
        target: [userLots.userId, userLots.lotId],
        set: { watching: true, archivedAt: null, updatedAt: new Date() },
      });
  await touch(db, projectId);
  return fresh.length;
}

export async function updateCandidate(
  db: AnyDb,
  userId: string,
  candidateId: string,
  c: {
    maxHammerOverride?: number | null;
    note?: string | null;
    state?: CandidateState;
  },
) {
  const owned = await ownedCandidate(db, userId, candidateId);
  if (!owned) return false;
  await db
    .update(projectCandidates)
    .set({
      ...(c.maxHammerOverride !== undefined
        ? { maxHammerOverride: centsToNumeric(c.maxHammerOverride) }
        : {}),
      ...(c.note !== undefined ? { note: c.note } : {}),
      ...(c.state !== undefined ? { state: c.state } : {}),
    })
    .where(eq(projectCandidates.id, candidateId));
  await touch(db, owned.projectId);
  return true;
}

/** Move a candidate up, down, or to the top (primary); ranks stay 1..n. */
export async function moveCandidate(
  db: AnyDb,
  userId: string,
  candidateId: string,
  to: "up" | "down" | "top",
) {
  const owned = await ownedCandidate(db, userId, candidateId);
  if (!owned) return false;
  const list = await db
    .select({ id: projectCandidates.id })
    .from(projectCandidates)
    .where(eq(projectCandidates.needId, owned.needId))
    .orderBy(asc(projectCandidates.rank), asc(projectCandidates.id));
  const ids = list.map((r) => r.id);
  const i = ids.indexOf(candidateId);
  const j =
    to === "top"
      ? 0
      : to === "up"
        ? Math.max(0, i - 1)
        : Math.min(ids.length - 1, i + 1);
  ids.splice(i, 1);
  ids.splice(j, 0, candidateId);
  for (const [k, id] of ids.entries())
    await db
      .update(projectCandidates)
      .set({ rank: k + 1 })
      .where(eq(projectCandidates.id, id));
  await touch(db, owned.projectId);
  return true;
}

export async function removeCandidate(
  db: AnyDb,
  userId: string,
  candidateId: string,
) {
  const owned = await ownedCandidate(db, userId, candidateId);
  if (!owned) return false;
  await db
    .delete(projectCandidates)
    .where(eq(projectCandidates.id, candidateId));
  await touch(db, owned.projectId);
  return true;
}
