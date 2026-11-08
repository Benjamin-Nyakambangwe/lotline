"use server";

import { z } from "zod";
import * as q from "@/lib/db/queries/projects";
import { requireUser } from "../dal";
import { getDb } from "../db";

const Id = z.uuid();
const Cents = z.number().int().min(0).max(100_000_000).nullable();
const Name = z.string().trim().min(1).max(80);

export async function createProjectAction(input: {
  name: string;
  budget: number | null;
}) {
  const user = await requireUser();
  const p = z.object({ name: Name, budget: Cents }).parse(input);
  return { id: await q.createProject(getDb(), user.id, p) };
}

export async function updateProjectAction(input: {
  id: string;
  name?: string;
  budget?: number | null;
  status?: "planning" | "live" | "done" | "archived";
  notes?: string | null;
}) {
  const user = await requireUser();
  const p = z
    .object({
      id: Id,
      name: Name.optional(),
      budget: Cents.optional(),
      status: z.enum(["planning", "live", "done", "archived"]).optional(),
      notes: z.string().max(2000).nullable().optional(),
    })
    .parse(input);
  return { ok: await q.updateProject(getDb(), user.id, p.id, p) };
}

export async function deleteProjectAction(input: { id: string }) {
  const user = await requireUser();
  return { ok: await q.deleteProject(getDb(), user.id, Id.parse(input.id)) };
}

export async function addNeedAction(input: {
  projectId: string;
  title: string;
  quantity: number;
  slotMaxHammer: number | null;
}) {
  const user = await requireUser();
  const p = z
    .object({
      projectId: Id,
      title: Name,
      quantity: z.number().int().min(1).max(99),
      slotMaxHammer: Cents,
    })
    .parse(input);
  return { id: await q.addNeed(getDb(), user.id, p.projectId, p) };
}

export async function updateNeedAction(input: {
  id: string;
  title?: string;
  quantity?: number;
  slotMaxHammer?: number | null;
  countsTowardBudget?: boolean;
}) {
  const user = await requireUser();
  const p = z
    .object({
      id: Id,
      title: Name.optional(),
      quantity: z.number().int().min(1).max(99).optional(),
      slotMaxHammer: Cents.optional(),
      countsTowardBudget: z.boolean().optional(),
    })
    .parse(input);
  return { ok: await q.updateNeed(getDb(), user.id, p.id, p) };
}

export async function deleteNeedAction(input: { id: string }) {
  const user = await requireUser();
  return { ok: await q.deleteNeed(getDb(), user.id, Id.parse(input.id)) };
}

export async function addCandidatesAction(input: {
  needId: string;
  lotIds: number[];
}) {
  const user = await requireUser();
  const p = z
    .object({
      needId: Id,
      lotIds: z.array(z.number().int().positive()).min(1).max(100),
    })
    .parse(input);
  return { added: await q.addCandidates(getDb(), user.id, p.needId, p.lotIds) };
}

export async function updateCandidateAction(input: {
  id: string;
  maxHammerOverride?: number | null;
  note?: string | null;
  state?: "active" | "skipped";
}) {
  const user = await requireUser();
  const p = z
    .object({
      id: Id,
      maxHammerOverride: Cents.optional(),
      note: z.string().max(300).nullable().optional(),
      state: z.enum(["active", "skipped"]).optional(),
    })
    .parse(input);
  return { ok: await q.updateCandidate(getDb(), user.id, p.id, p) };
}

export async function moveCandidateAction(input: {
  id: string;
  to: "up" | "down" | "top";
}) {
  const user = await requireUser();
  const p = z
    .object({ id: Id, to: z.enum(["up", "down", "top"]) })
    .parse(input);
  return { ok: await q.moveCandidate(getDb(), user.id, p.id, p.to) };
}

export async function removeCandidateAction(input: { id: string }) {
  const user = await requireUser();
  return { ok: await q.removeCandidate(getDb(), user.id, Id.parse(input.id)) };
}

/** This person's projects and their needs, for "Add to project" pickers. */
export async function myProjectNeeds() {
  const user = await requireUser();
  const db = getDb();
  const ps = (await q.listProjects(db, user.id)).filter(
    (p) => p.status !== "archived" && p.status !== "done",
  );
  const needs = await q.needRows(
    db,
    ps.map((p) => p.id),
  );
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    needs: needs
      .filter((n) => n.projectId === p.id)
      .map((n) => ({ id: n.id, title: n.title, quantity: n.quantity })),
  }));
}
