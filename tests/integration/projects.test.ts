import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotListRow } from "@/lib/abc/normalize";
import { upsertListRows } from "@/lib/db/queries/lots";
import {
  addCandidates,
  addNeed,
  candidateRows,
  createProject,
  deleteProject,
  moveCandidate,
  needRows,
  removeCandidate,
  updateCandidate,
} from "@/lib/db/queries/projects";
import * as schema from "@/lib/db/schema";
import { allIn } from "@/lib/domain/fees";
import { buildProjectView } from "@/lib/projects/view";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });
const NOW = new Date(Date.now() + 60_000);

const lot = (
  id: number,
  next: number,
  over: Partial<LotListRow> = {},
): LotListRow => ({
  id,
  type: 1,
  title: `Proxmox node ${id}`,
  photoUrl: null,
  thumbUrl: null,
  lotNumber: null,
  location: "Harare",
  currency: "USD",
  startingBid: next,
  openingBid: next,
  currentBid: null,
  currentBidderId: null,
  startAt: null,
  endAt: new Date(NOW.getTime() + 3_600_000 + id * 20_000),
  status: 1,
  saleStatus: 1,
  stc: false,
  auctionLotId: null,
  ...over,
});

let project = "";
let need = "";
const view = async () => {
  const needs = await needRows(db, [project]);
  const rows = await candidateRows(db, "me", [project]);
  return buildProjectView(30000, needs, rows, NOW);
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.user).values([
    { id: "me", name: "Me", email: "me@lotline.test" },
    { id: "other", name: "Other", email: "other@lotline.test" },
  ]);
  await upsertListRows(
    db,
    [lot(1, 4000), lot(2, 4500), lot(3, 3500), lot(4, 9000)],
    new Set(),
  );
});
afterAll(async () => {
  await pg.close();
});

describe("projects", () => {
  it("builds a need with ranked candidates, in order, and watches them", async () => {
    project = await createProject(db, "me", { name: "Homelab", budget: 30000 });
    need = (await addNeed(db, "me", project, {
      title: "Proxmox node",
      quantity: 2,
      slotMaxHammer: 5000,
    })) as string;
    expect(await addCandidates(db, "me", need, [1, 2, 3, 2])).toBe(3);
    expect(await addCandidates(db, "me", need, [1])).toBe(0);
    const v = await view();
    expect(v.needs[0].candidates.map((c) => [c.lotId, c.rank])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const watched = await db
      .select()
      .from(schema.userLots)
      .where(eq(schema.userLots.userId, "me"));
    expect(watched.map((w) => w.lotId).sort()).toEqual([1, 2, 3]);
  });

  it("counts the first two backups within the max as the worst case, and suggests the next", async () => {
    const v = await view();
    const n = v.needs[0];
    expect(n.budget.plannedBackups).toEqual([1, 2]);
    expect(v.budget.worst).toBe(2 * allIn(5000));
    expect(v.budget.left).toBe(30000 - 2 * allIn(5000));
    expect(n.suggestion?.text).toMatch(
      /^Next up: Proxmox node 1 closes \d\d:\d\d at \$40 \(your max \$50\)\.$/,
    );
  });

  it("reorders: up, down, and make primary", async () => {
    const ids = (await view()).needs[0].candidates.map((c) => c.id);
    await moveCandidate(db, "me", ids[2], "top");
    expect((await view()).needs[0].candidates.map((c) => c.lotId)).toEqual([
      3, 1, 2,
    ]);
    await moveCandidate(db, "me", ids[2], "down");
    expect((await view()).needs[0].candidates.map((c) => c.lotId)).toEqual([
      1, 3, 2,
    ]);
  });

  it("rolls forward when a lot closes, skips what you skip, and respects each lot's own max", async () => {
    // Lot 1 closes (someone else won it): the next two viable backups fill the slots.
    await upsertListRows(
      db,
      [lot(1, 4000, { status: 2, currentBid: 6000 })],
      new Set(),
    );
    let n = (await view()).needs[0];
    expect(n.budget.plannedBackups).toEqual([3, 2]);
    // Skip lot 3, and add an expensive lot with its own higher max.
    const c3 = n.candidates.find((c) => c.lotId === 3);
    await updateCandidate(db, "me", c3?.id as string, { state: "skipped" });
    await addCandidates(db, "me", need, [4]);
    const c4 = (await view()).needs[0].candidates.find((c) => c.lotId === 4);
    expect(c4?.overMax).toBe(true); // $90 next bid over the $50 slot max
    await updateCandidate(db, "me", c4?.id as string, {
      maxHammerOverride: 10000,
    });
    n = (await view()).needs[0];
    expect(n.budget.plannedBackups).toEqual([2, 4]);
    expect(n.budget.unfilled).toBe(allIn(5000) + allIn(10000));
  });

  it("flags overcommit when you lead more lots than you need", async () => {
    for (const id of [2, 3, 4])
      await db
        .update(schema.userLots)
        .set({ myBid: "200.00" })
        .where(
          and(eq(schema.userLots.userId, "me"), eq(schema.userLots.lotId, id)),
        );
    await upsertListRows(
      db,
      [2, 3, 4].map((id) => lot(id, 9000, { currentBid: 8000 })),
      new Set(),
    );
    const v = await view();
    expect(v.needs[0].budget.flags.overcommit).toBe(true);
    expect(v.budget.flags.overcommit).toBe(true);
    expect(v.needs[0].suggestion?.text).toMatch(/Bids can't be withdrawn/);
  });

  it("only lets the owner change a project", async () => {
    const [c] = (await view()).needs[0].candidates;
    expect(
      await addNeed(db, "other", project, {
        title: "x",
        quantity: 1,
        slotMaxHammer: null,
      }),
    ).toBeNull();
    expect(await addCandidates(db, "other", need, [4])).toBe(0);
    expect(await moveCandidate(db, "other", c.id, "top")).toBe(false);
    expect(await updateCandidate(db, "other", c.id, { state: "skipped" })).toBe(
      false,
    );
    expect(await removeCandidate(db, "other", c.id)).toBe(false);
    expect(await candidateRows(db, "other", [project])).toEqual([]);
    expect(await deleteProject(db, "other", project)).toBe(false);
    expect(await removeCandidate(db, "me", c.id)).toBe(true);
    expect(await deleteProject(db, "me", project)).toBe(true);
  });
});
